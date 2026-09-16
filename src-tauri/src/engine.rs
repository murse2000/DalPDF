use base64::{engine::general_purpose::STANDARD, Engine};
use pdfium_render::prelude::*;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    io::Cursor,
    path::{Path, PathBuf},
};

type Result<T> = std::result::Result<T, String>;
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Deserialize, Debug)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Request {
    Open {
        path: String,
        password: Option<String>,
    },
    Info,
    DocumentText { path: Option<String>, start: i32, count: i32 },
    TranslationBackground {
        page: i32,
        width: i32,
    },
    PageText {
        page: i32,
    },
    Render {
        page: i32,
        width: i32,
    },
    Objects {
        page: i32,
    },
    Annotations { page: i32 },
    AddHighlight { page: i32, boxes: Vec<[f32; 4]>, color: [u8; 3] },
    AddNote { page: i32, x: f32, y: f32, text: String },
    EditAnnotation { page: i32, index: usize, text: String },
    MoveAnnotation { page: i32, index: usize, x: f32, y: f32 },
    DeleteAnnotation { page: i32, index: usize },
    Text {
        page: i32,
        index: usize,
        text: String,
        font_path: Option<String>,
    },
    Image {
        page: i32,
        index: Option<usize>,
        path: String,
    },
    Transform {
        page: i32,
        index: usize,
        x: f32,
        y: f32,
        width: f32,
        height: f32,
    },
    RotateImage {
        page: i32,
        index: usize,
    },
    CropImage {
        page: i32,
        index: usize,
        left: u32,
        top: u32,
        width: u32,
        height: u32,
    },
    Delete {
        page: i32,
        index: usize,
    },
    Save {
        path: String,
    },
    PrintSnapshot { path: String },
    SaveTranslation {
        path: String,
        font: String,
        pages: Vec<TranslationPage>,
    },
    Extract {
        pages: String,
        path: String,
    },
    Merge {
        paths: Vec<String>,
    },
    Undo,
    Redo,
    Search {
        query: String,
        start: i32,
    },
}

#[derive(Deserialize, Debug)]
pub struct TranslationLine {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub size: f32,
    pub color: [u8; 3],
}
#[derive(Deserialize, Debug)]
pub struct TranslationPage {
    pub page: i32,
    pub whole_page: bool,
    pub masks: Vec<[f32; 4]>,
    pub lines: Vec<TranslationLine>,
}

pub struct Session<'a> {
    pub doc: PdfDocument<'a>,
    path: String,
    undo: Vec<tempfile::NamedTempFile>,
    redo: Vec<tempfile::NamedTempFile>,
    revision: u64,
    backing: Option<tempfile::NamedTempFile>,
}

pub fn bind(path: &Path) -> Result<Pdfium> {
    Ok(Pdfium::new(Pdfium::bind_to_library(path).map_err(err)?))
}

#[cfg(test)]
pub(crate) fn test_pdfium() -> Pdfium {
    static INITIALIZE: std::sync::Once = std::sync::Once::new();
    // 테스트 프로세스에서 실제 번들 라이브러리를 한 번 확인하고 기존 바인딩을 공유합니다.
    INITIALIZE.call_once(|| {
        bind(&library_path(Path::new(env!("CARGO_MANIFEST_DIR"))))
            .expect("테스트용 PDFium 라이브러리를 불러오지 못했습니다.");
    });
    Pdfium::default()
}

fn snapshot(doc: &PdfDocument) -> Result<tempfile::NamedTempFile> {
    let file = tempfile::NamedTempFile::new().map_err(err)?;
    doc.save_to_file(file.path()).map_err(err)?;
    Ok(file)
}

// 같은 디렉터리에 완성본을 쓰고 재열기를 검증한 후 교체합니다.
fn save_atomic(pdfium: &Pdfium, doc: &PdfDocument, path: &str) -> Result<()> {
    let target = Path::new(path);
    let dir = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let file = tempfile::NamedTempFile::new_in(dir).map_err(err)?;
    doc.save_to_file(file.path()).map_err(err)?;
    file.as_file().sync_all().map_err(err)?;
    {
        let check = pdfium.load_pdf_from_file(file.path(), None).map_err(err)?;
        if check.pages().len() != doc.pages().len() {
            return Err("저장 결과의 페이지 수가 일치하지 않습니다.".into());
        }
    }
    file.persist(target).map_err(err)?;
    Ok(())
}

pub fn page_range(input: &str, count: i32) -> Result<Vec<i32>> {
    let mut result = Vec::new();
    for part in input.split(',') {
        let parts: Vec<_> = part.trim().split('-').collect();
        if parts.is_empty() || parts.len() > 2 {
            return Err("페이지 범위를 확인하세요. 예: 1-3, 5".into());
        }
        let a: i32 = parts[0]
            .trim()
            .parse()
            .map_err(|_| "페이지 번호를 입력하세요.")?;
        let b: i32 = if parts.len() == 2 {
            parts[1]
                .trim()
                .parse()
                .map_err(|_| "페이지 범위를 확인하세요.")?
        } else {
            a
        };
        if a == 0 || b < a || b > count {
            return Err(format!("1~{count} 범위의 페이지를 입력하세요."));
        }
        for p in a..=b {
            if !result.contains(&(p - 1)) {
                result.push(p - 1);
            }
        }
    }
    if result.is_empty() {
        return Err("추출할 페이지가 없습니다.".into());
    }
    Ok(result)
}

fn info(s: &Session) -> Result<Value> {
    let sizes: Vec<_> = s
        .doc
        .pages()
        .page_sizes()
        .map_err(err)?
        .iter()
        .map(|r| json!({"width":r.width().value,"height":r.height().value}))
        .collect();
    Ok(
        json!({"path":s.path,"pages":sizes,"undo":!s.undo.is_empty(),"redo":!s.redo.is_empty(),"revision":s.revision,"editable":s.doc.permissions().can_modify_document_content().map_err(err)?}),
    )
}

fn hide_text(object: &mut PdfPageObject<'_>) -> Result<()> {
    if let Some(text) = object.as_text_object_mut() {
        let mode = match text.render_mode() {
            PdfPageTextRenderMode::FilledUnstrokedClipping
            | PdfPageTextRenderMode::StrokedUnfilledClipping
            | PdfPageTextRenderMode::FilledThenStrokedClipping
            | PdfPageTextRenderMode::InvisibleClipping => PdfPageTextRenderMode::InvisibleClipping,
            _ => PdfPageTextRenderMode::Invisible,
        };
        text.set_render_mode(mode).map_err(err)?;
    } else if let Some(group) = object.as_x_object_form_object() {
        for mut child in group.iter() {
            hide_text(&mut child)?;
        }
    }
    Ok(())
}

pub fn handle<'a>(
    pdfium: &'a Pdfium,
    state: &mut Option<Session<'a>>,
    req: Request,
) -> Result<Value> {
    if let Request::Open { path, password } = req {
        let doc = pdfium
            .load_pdf_from_file(&path, password.as_deref())
            .map_err(err)?;
        if doc.pages().is_empty() {
            return Err("페이지가 없는 PDF입니다.".into());
        }
        let next = Session {
            doc,
            path,
            undo: Vec::new(),
            redo: Vec::new(),
            revision: 0,
            backing: None,
        };
        let result = info(&next)?;
        *state = Some(next);
        return Ok(result);
    }
    let s = state.as_mut().ok_or("PDF를 먼저 열어 주세요.")?;
    match req {
        Request::Info => info(s),
        Request::DocumentText { path, start, count } => {
            let external = path.as_deref().map(|p| pdfium.load_pdf_from_file(p, None)).transpose().map_err(err)?;
            let document = external.as_ref().unwrap_or(&s.doc);
            if !document.permissions().can_extract_text_and_graphics().map_err(err)? { return Err("문서의 텍스트 추출 권한이 없습니다.".into()); }
            let total = document.pages().len();
            if start < 0 || start >= total || !(1..=8).contains(&count) { return Err("텍스트를 읽을 페이지 범위를 확인하세요.".into()); }
            let mut pages = Vec::new();
            for page in start..(start + count).min(total) {
                pages.push(json!({"page":page,"text":document.pages().get(page).map_err(err)?.text().map_err(err)?.all()}));
            }
            Ok(json!({"total":total,"pages":pages}))
        },
        Request::Render { page, width } => {
            let page = s.doc.pages().get(page).map_err(err)?;
            let bitmap = page
                .render_with_config(
                    &PdfRenderConfig::new()
                        .set_target_width(width.clamp(120, 2600))
                        .set_maximum_height(4000),
                )
                .map_err(err)?;
            let image = bitmap.as_image().map_err(err)?;
            let mut bytes = Cursor::new(Vec::new());
            image
                .write_to(&mut bytes, image::ImageFormat::Png)
                .map_err(err)?;
            Ok(json!(format!(
                "data:image/png;base64,{}",
                STANDARD.encode(bytes.into_inner())
            )))
        }
        Request::TranslationBackground { page, width } => {
            if !s
                .doc
                .permissions()
                .can_extract_text_and_graphics()
                .map_err(err)?
            {
                return Err("문서의 텍스트 추출 권한이 없습니다.".into());
            }
            // 표시용 한 페이지만 복제하므로 원본과 편집 이력은 바뀌지 않습니다.
            let mut copy = pdfium.create_new_pdf().map_err(err)?;
            copy.pages_mut()
                .copy_page_from_document(&s.doc, page, 0)
                .map_err(err)?;
            let mut page = copy.pages().get(0).map_err(err)?;
            for mut object in page.objects().iter() {
                hide_text(&mut object)?;
            }
            page.regenerate_content().map_err(err)?;
            let bitmap = page
                .render_with_config(
                    &PdfRenderConfig::new()
                        .set_target_width(width.clamp(120, 2600))
                        .set_maximum_height(4000),
                )
                .map_err(err)?;
            let mut bytes = Cursor::new(Vec::new());
            bitmap
                .as_image()
                .map_err(err)?
                .write_to(&mut bytes, image::ImageFormat::Png)
                .map_err(err)?;
            Ok(json!(format!(
                "data:image/png;base64,{}",
                STANDARD.encode(bytes.into_inner())
            )))
        }
        Request::PageText { page } => {
            if !s
                .doc
                .permissions()
                .can_extract_text_and_graphics()
                .map_err(err)?
            {
                return Err("문서의 텍스트 추출 권한이 없습니다.".into());
            }
            let page = s.doc.pages().get(page).map_err(err)?;
            let text = page.text().map_err(err)?;
            let config = PdfRenderConfig::new().set_target_width(10000);
            let pixel_height = (10000. * page.height().value / page.width().value).round();
            let mut chars = Vec::new();
            for c in text.chars().iter() {
                let Some(value) = c.unicode_string() else {
                    continue;
                };
                let bounds = c
                    .loose_bounds()
                    .or_else(|_| c.tight_bounds())
                    .map_err(err)?;
                let a = page
                    .points_to_pixels(bounds.left(), bounds.top(), &config)
                    .map_err(err)?;
                let b = page
                    .points_to_pixels(bounds.right(), bounds.bottom(), &config)
                    .map_err(err)?;
                let color = if c.is_generated().map_err(err)? {
                    None
                } else {
                    let color = c.fill_color().map_err(err)?;
                    Some(format!(
                        "rgb({},{},{})",
                        color.red(),
                        color.green(),
                        color.blue()
                    ))
                };
                chars.push(json!({"text":value,"color":color,"size":c.scaled_font_size().value,"box":[a.0.min(b.0) as f32 / 10000., a.1.min(b.1) as f32 / pixel_height,
                    (a.0-b.0).abs() as f32 / 10000., (a.1-b.1).abs() as f32 / pixel_height]}));
            }
            Ok(json!({"chars":chars}))
        }
        Request::Annotations { page } => {
            let page = s.doc.pages().get(page).map_err(err)?;
            let mut annotations = Vec::new();
            for index in page.annotations().as_range() {
                let annotation = page.annotations().get(index).map_err(err)?;
                let kind = match annotation.annotation_type() {
                    PdfPageAnnotationType::Highlight => "highlight",
                    PdfPageAnnotationType::Text => "note",
                    _ => continue,
                };
                let display = annotation_display(&page, annotation.bounds().map_err(err)?)?;
                let mut boxes = Vec::new();
                for quad in annotation.attachment_points().iter() {
                    boxes.push(annotation_display(&page, quad.to_rect())?);
                }
                annotations.push(json!({"index":index,"kind":kind,"text":annotation.contents().unwrap_or_default(),
                    "display":display,"boxes":boxes}));
            }
            Ok(json!({"annotations":annotations}))
        }
        Request::Objects { page } => {
            let page = s.doc.pages().get(page).map_err(err)?;
            let mut result = Vec::new();
            for (index, obj) in page.objects().iter().enumerate() {
                let kind = match obj.object_type() {
                    PdfPageObjectType::Text => "text",
                    PdfPageObjectType::Image => "image",
                    PdfPageObjectType::XObjectForm => "group",
                    _ => continue,
                };
                let bounds = obj.bounds().map_err(err)?;
                let config = PdfRenderConfig::new().set_target_width(10000);
                let a = page
                    .points_to_pixels(bounds.left(), bounds.top(), &config)
                    .map_err(err)?;
                let b = page
                    .points_to_pixels(bounds.right(), bounds.bottom(), &config)
                    .map_err(err)?;
                let pixel_height = (10000. * page.height().value / page.width().value).round();
                let display = [
                    a.0.min(b.0) as f32 / 10000.,
                    a.1.min(b.1) as f32 / pixel_height,
                    (a.0 - b.0).abs() as f32 / 10000.,
                    (a.1 - b.1).abs() as f32 / pixel_height,
                ];
                let text = obj.as_text_object().map(|t| t.text());
                let font = obj.as_text_object().map(|t| t.font().name());
                let pixels = obj
                    .as_image_object()
                    .and_then(|i| Some((i.width().ok()?, i.height().ok()?)));
                result.push(json!({"index":index,"kind":kind,"text":text,"font":font,"x":bounds.left().value,"y":bounds.bottom().value,"width":bounds.to_rect().width().value,"height":bounds.to_rect().height().value,"pixels":pixels,"display":display}));
            }
            Ok(json!({"objects":result,"rotation":format!("{:?}",page.rotation().map_err(err)?)}))
        }
        Request::SaveTranslation { path, font, pages } => {
            save_translation(pdfium, s, &path, &font, &pages)?;
            Ok(json!(true))
        }
        Request::PrintSnapshot { path } => {
            let permissions = s.doc.permissions();
            if !permissions.can_print_high_quality().map_err(err)? && !permissions.can_print_only_low_quality().map_err(err)? {
                return Err("이 PDF는 인쇄가 허용되지 않습니다.".into());
            }
            let target = Path::new(&path);
            if target == Path::new(&s.path) || target.canonicalize().ok().zip(Path::new(&s.path).canonicalize().ok()).is_some_and(|(a,b)| a==b) {
                return Err("인쇄용 사본은 원본과 다른 경로여야 합니다.".into());
            }
            save_atomic(pdfium, &s.doc, &path)?;
            Ok(json!({"saved":true}))
        }
        Request::Save { path } => {
            save_atomic(pdfium, &s.doc, &path)?;
            s.path = path;
            info(s)
        }
        Request::Extract { pages, path } => {
            if !s.doc.permissions().can_assemble_document().map_err(err)? {
                return Err("문서의 페이지 추출 권한이 없습니다.".into());
            }
            if Path::new(&path) == Path::new(&s.path) {
                return Err("쪼갠 PDF는 다른 이름으로 저장하세요.".into());
            }
            let indices = page_range(&pages, s.doc.pages().len())?;
            let mut out = pdfium.create_new_pdf().map_err(err)?;
            for p in indices {
                let end = out.pages().len();
                out.pages_mut()
                    .copy_page_from_document(&s.doc, p, end)
                    .map_err(err)?;
            }
            save_atomic(pdfium, &out, &path)?;
            Ok(json!(true))
        }
        Request::Undo | Request::Redo => {
            let undo = matches!(req, Request::Undo);
            let stack = if undo { &mut s.undo } else { &mut s.redo };
            let file = stack.last().ok_or("되돌릴 작업이 없습니다.")?;
            let doc = pdfium.load_pdf_from_file(file.path(), None).map_err(err)?;
            let current = snapshot(&s.doc)?;
            s.doc = doc;
            // 열린 파일을 이력에서 유지해 Windows에서도 수명을 보장합니다.
            let restored = stack.pop().unwrap();
            if undo {
                s.redo.push(current);
            } else {
                s.undo.push(current);
            }
            s.revision += 1;
            let result = info(s);
            s.backing = Some(restored);
            result
        }
        Request::Search { query, start } => {
            if query.trim().is_empty() {
                return Ok(Value::Null);
            }
            let q = query.to_lowercase();
            let count = s.doc.pages().len();
            for offset in 0..count {
                let n = ((start as u32 + offset as u32) % count as u32) as i32;
                let page = s.doc.pages().get(n).map_err(err)?;
                let text = page.text().map_err(err)?.all();
                if text.to_lowercase().contains(&q) {
                    return Ok(json!({"page":n}));
                }
            }
            Ok(Value::Null)
        }
        req => {
            let annotation_edit = matches!(&req, Request::AddHighlight { .. } | Request::AddNote { .. }
                | Request::EditAnnotation { .. } | Request::MoveAnnotation { .. } | Request::DeleteAnnotation { .. });
            let allowed = if annotation_edit {
                s.doc.permissions().can_add_or_modify_text_annotations()
            } else {
                s.doc.permissions().can_modify_document_content()
            }.map_err(err)?;
            if !allowed {
                return Err("문서의 내용 수정 권한이 없습니다.".into());
            }
            let before = snapshot(&s.doc)?;
            match mutate(pdfium, &mut s.doc, req) {
                Ok(()) => {
                    s.undo.push(before);
                    if s.undo.len() > 20 {
                        s.undo.remove(0);
                    }
                    s.redo.clear();
                    s.revision += 1;
                    info(s)
                }
                Err(e) => {
                    s.doc = pdfium
                        .load_pdf_from_file(before.path(), None)
                        .map_err(err)?;
                    s.backing = Some(before);
                    Err(e)
                }
            }
        }
    }
}

// UI 정규화 좌표와 PDF 좌표는 PDFium 변환을 사용하여 회전 페이지도 동일하게 처리합니다.
fn annotation_bounds(page: &PdfPage, display: [f32; 4]) -> Result<PdfRect> {
    let [x,y,w,h] = display;
    if !display.iter().all(|v| v.is_finite()) || x<0. || y<0. || w<=0. || h<=0. || x+w>1.001 || y+h>1.001 {
        return Err("주석 위치와 크기를 확인하세요.".into());
    }
    let config = PdfRenderConfig::new().set_target_width(10000);
    let height = (10000. * page.height().value / page.width().value).round();
    let a = page.pixels_to_points((x*10000.).round() as i32,(y*height).round() as i32,&config).map_err(err)?;
    let b = page.pixels_to_points(((x+w)*10000.).round() as i32,((y+h)*height).round() as i32,&config).map_err(err)?;
    Ok(PdfRect::new_from_values(a.1.value.min(b.1.value),a.0.value.min(b.0.value),a.1.value.max(b.1.value),a.0.value.max(b.0.value)))
}
fn annotation_display(page: &PdfPage, bounds: PdfRect) -> Result<[f32;4]> {
    let config = PdfRenderConfig::new().set_target_width(10000);
    let height = (10000. * page.height().value / page.width().value).round();
    let a = page.points_to_pixels(bounds.left(),bounds.top(),&config).map_err(err)?;
    let b = page.points_to_pixels(bounds.right(),bounds.bottom(),&config).map_err(err)?;
    Ok([a.0.min(b.0) as f32/10000.,a.1.min(b.1) as f32/height,(a.0-b.0).abs() as f32/10000.,(a.1-b.1).abs() as f32/height])
}
fn editable_annotation(annotation: &PdfPageAnnotation) -> Result<()> {
    if matches!(annotation.annotation_type(), PdfPageAnnotationType::Text | PdfPageAnnotationType::Highlight) { Ok(()) }
    else { Err("형광펜과 메모만 수정할 수 있습니다.".into()) }
}

fn save_translation(
    pdfium: &Pdfium,
    session: &Session,
    path: &str,
    font: &str,
    pages: &[TranslationPage],
) -> Result<()> {
    if Path::new(path) == Path::new(&session.path)
        || Path::new(path)
            .canonicalize()
            .ok()
            .zip(Path::new(&session.path).canonicalize().ok())
            .is_some_and(|(a, b)| a == b)
    {
        return Err("번역 PDF는 원본과 다른 이름으로 저장하세요.".into());
    }
    if !session
        .doc
        .permissions()
        .can_extract_text_and_graphics()
        .map_err(err)?
    {
        return Err("문서의 텍스트 추출 권한이 없습니다.".into());
    }
    let font_bytes: &[u8] = match font {
        "gothic" => include_bytes!("../../public/fonts/sans.ttf"),
        "serif" => include_bytes!("../../public/fonts/serif.ttf"),
        _ => return Err("지원하지 않는 번역 글꼴입니다.".into()),
    };
    let mut indices = std::collections::HashSet::new();
    if pages.is_empty() {
        return Err("저장할 번역문이 없습니다.".into());
    }
    for page in pages {
        if page.page < 0 || page.page >= session.doc.pages().len() || !indices.insert(page.page) {
            return Err("번역 페이지 번호가 올바르지 않습니다.".into());
        }
        if page.lines.iter().any(|l| {
            ![l.x, l.y, l.width, l.size].iter().all(|v| v.is_finite())
                || l.size <= 0.
                || l.size > 256.
                || l.width <= 0.
        }) || page.masks.iter().flatten().any(|v| !v.is_finite())
        {
            return Err("번역문 배치 값이 올바르지 않습니다.".into());
        }
    }
    let mut output = pdfium.create_new_pdf().map_err(err)?;
    let font = output
        .fonts_mut()
        .load_true_type_from_bytes(font_bytes, true)
        .map_err(err)?;
    for n in 0..session.doc.pages().len() {
        let Some(translation) = pages.iter().find(|p| p.page == n) else {
            let end = output.pages().len();
            output
                .pages_mut()
                .copy_page_from_document(&session.doc, n, end)
                .map_err(err)?;
            continue;
        };
        let source = session.doc.pages().get(n).map_err(err)?;
        let (width, height) = (source.width(), source.height());
        let config = PdfRenderConfig::new()
            .set_target_width(1800)
            .set_maximum_height(4000);
        let mut copy = pdfium.create_new_pdf().map_err(err)?;
        copy.pages_mut()
            .copy_page_from_document(&session.doc, n, 0)
            .map_err(err)?;
        let mut background_page = copy.pages().get(0).map_err(err)?;
        for mut object in background_page.objects().iter() {
            hide_text(&mut object)?;
        }
        background_page.regenerate_content().map_err(err)?;
        let background = background_page
            .render_with_config(&config)
            .map_err(err)?
            .as_image()
            .map_err(err)?
            .to_rgb8();
        let image = if translation.whole_page {
            background
        } else {
            let mut original = source
                .render_with_config(&config)
                .map_err(err)?
                .as_image()
                .map_err(err)?
                .to_rgb8();
            for mask in &translation.masks {
                let x = (mask[0] * original.width() as f32 - 1.)
                    .floor()
                    .clamp(0., original.width() as f32) as u32;
                let y = (mask[1] * original.height() as f32 - 1.)
                    .floor()
                    .clamp(0., original.height() as f32) as u32;
                let right = ((mask[0] + mask[2]) * original.width() as f32 + 1.)
                    .ceil()
                    .clamp(x as f32, original.width() as f32) as u32;
                let bottom = ((mask[1] + mask[3]) * original.height() as f32 + 1.)
                    .ceil()
                    .clamp(y as f32, original.height() as f32) as u32;
                if right > x && bottom > y {
                    let patch = image::imageops::crop_imm(&background, x, y, right - x, bottom - y);
                    image::imageops::replace(&mut original, &patch.to_image(), x as i64, y as i64);
                }
            }
            original
        };
        // 압축한 배경을 넣어 여러 페이지 저장 시 원시 비트맵이 누적되지 않도록 합니다.
        let mut jpeg = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 95)
            .encode_image(&image)
            .map_err(err)?;
        let mut background_object =
            PdfPageImageObject::new_from_jpeg_reader(&output, Cursor::new(jpeg)).map_err(err)?;
        background_object
            .scale(width.value, height.value)
            .map_err(err)?;
        let mut page = output
            .pages_mut()
            .create_page_at_end(PdfPagePaperSize::Custom(width, height))
            .map_err(err)?;
        page.objects_mut()
            .add_image_object(background_object)
            .map_err(err)?;
        for line in &translation.lines {
            if line.text.trim().is_empty() {
                continue;
            }
            let mut text =
                PdfPageTextObject::new(&output, &line.text, font, PdfPoints::new(line.size))
                    .map_err(err)?;
            text.set_fill_color(PdfColor::new(
                line.color[0],
                line.color[1],
                line.color[2],
                255,
            ))
            .map_err(err)?;
            let actual = text.bounds().map_err(err)?.to_rect().width().value;
            if actual > 0. {
                text.scale(line.width / actual, 1.).map_err(err)?;
            }
            text.translate(PdfPoints::new(line.x), height - PdfPoints::new(line.y))
                .map_err(err)?;
            let added = page.objects_mut().add_text_object(text).map_err(err)?;
            if added.as_text_object().unwrap().text() != line.text {
                return Err(format!(
                    "{}페이지의 번역문을 글꼴로 표현하지 못했습니다.",
                    n + 1
                ));
            }
        }
        page.regenerate_content().map_err(err)?;
    }
    save_atomic(pdfium, &output, path)
}

fn mutate(pdfium: &Pdfium, doc: &mut PdfDocument, req: Request) -> Result<()> {
    if let Request::Merge { paths } = req {
        if paths.is_empty() {
            return Err("합칠 파일을 선택하세요.".into());
        }
        for path in paths {
            let other = pdfium.load_pdf_from_file(&path, None).map_err(err)?;
            if !other.permissions().can_assemble_document().map_err(err)? {
                return Err("합칠 문서의 페이지 추출 권한이 없습니다.".into());
            }
            doc.pages_mut().append(&other).map_err(err)?;
        }
        return Ok(());
    }
    let p = match &req {
        Request::Text { page, .. }
        | Request::Image { page, .. }
        | Request::Transform { page, .. }
        | Request::RotateImage { page, .. }
        | Request::CropImage { page, .. }
        | Request::Delete { page, .. }
        | Request::AddHighlight { page, .. }
        | Request::AddNote { page, .. }
        | Request::EditAnnotation { page, .. }
        | Request::MoveAnnotation { page, .. }
        | Request::DeleteAnnotation { page, .. } => *page,
        _ => return Err("지원하지 않는 편집 명령입니다.".into()),
    };
    let replacement_font = if let Request::Text {
        font_path: Some(path),
        ..
    } = &req
    {
        Some(
            doc.fonts_mut()
                .load_true_type_from_file(path, true)
                .map_err(err)?,
        )
    } else {
        None
    };
    if let Request::DeleteAnnotation { index, .. } = &req {
        // 조회 페이지를 삭제 핸들보다 오래 유지하여 주석 핸들의 수명을 보장합니다.
        let source = doc.pages().get(p).map_err(err)?;
        let annotation = source.annotations().get(*index).map_err(err)?;
        editable_annotation(&annotation)?;
        let mut target = doc.pages().get(p).map_err(err)?;
        target.annotations_mut().delete_annotation(annotation).map_err(err)?;
        return Ok(());
    }
    let mut page = doc.pages().get(p).map_err(err)?;
    match req {
        Request::AddHighlight { boxes, color, .. } => {
            if boxes.is_empty() { return Err("형광펜을 표시할 텍스트를 선택하세요.".into()); }
            let bounds = boxes.into_iter().map(|b| annotation_bounds(&page, b)).collect::<Result<Vec<_>>>()?;
            let union = PdfRect::new_from_values(
                bounds.iter().map(|b| b.bottom().value).fold(f32::INFINITY, f32::min),
                bounds.iter().map(|b| b.left().value).fold(f32::INFINITY, f32::min),
                bounds.iter().map(|b| b.top().value).fold(f32::NEG_INFINITY, f32::max),
                bounds.iter().map(|b| b.right().value).fold(f32::NEG_INFINITY, f32::max));
            let mut annotation = page.annotations_mut().create_highlight_annotation().map_err(err)?;
            annotation.set_bounds(union).map_err(err)?;
            annotation.set_stroke_color(PdfColor::new(color[0],color[1],color[2],100)).map_err(err)?;
            annotation.set_is_printed(true).map_err(err)?;
            for bound in bounds {
                // 텍스트 마크업 QuadPoints는 위쪽 두 점, 아래쪽 두 점의 Z 순서입니다.
                let quad = PdfQuadPoints::new_from_values(bound.left().value,bound.top().value,
                    bound.right().value,bound.top().value,bound.left().value,bound.bottom().value,
                    bound.right().value,bound.bottom().value);
                annotation.attachment_points_mut().create_attachment_point_at_end(quad).map_err(err)?;
            }
        }
        Request::AddNote { x, y, text, .. } => {
            if !x.is_finite() || !y.is_finite() { return Err("메모 위치를 확인하세요.".into()); }
            if text.trim().is_empty() { return Err("메모 내용을 입력하세요.".into()); }
            let width = 20. / page.width().value;
            let height = 20. / page.height().value;
            let bounds = annotation_bounds(&page, [x.clamp(0.,1.-width),y.clamp(0.,1.-height),width,height])?;
            let mut annotation = page.annotations_mut().create_text_annotation(&text).map_err(err)?;
            annotation.set_bounds(bounds).map_err(err)?;
            annotation.set_stroke_color(PdfColor::YELLOW).map_err(err)?;
            annotation.set_is_printed(true).map_err(err)?;
        }
        Request::EditAnnotation { index, text, .. } => {
            // 기존 주석의 외관 스트림과 색상은 유지하고 내용만 변경합니다.
            let mut annotation = page.annotations().get(index).map_err(err)?;
            editable_annotation(&annotation)?;
            annotation.set_contents(&text).map_err(err)?;
        }
        Request::MoveAnnotation { index, x, y, .. } => {
            if !x.is_finite() || !y.is_finite() { return Err("메모 위치를 확인하세요.".into()); }
            let mut annotation = page.annotations().get(index).map_err(err)?;
            if annotation.annotation_type()!=PdfPageAnnotationType::Text { return Err("메모만 이동할 수 있습니다.".into()); }
            let display = annotation_display(&page, annotation.bounds().map_err(err)?)?;
            let bounds = annotation_bounds(&page, [x.clamp(0.,(1.-display[2]).max(0.)), y.clamp(0.,(1.-display[3]).max(0.)), display[2], display[3]])?;
            annotation.set_bounds(bounds).map_err(err)?;
        }

        Request::Text { index, text, .. } => {
            if text.trim().is_empty() {
                return Err("텍스트를 비우려면 개체 삭제를 사용하세요.".into());
            }
            let mut obj = page.objects().get(index).map_err(err)?;
            if let Some(font) = replacement_font {
                if obj.get_clip_path().is_some_and(|clip| !clip.is_empty()) {
                    return Err("클리핑된 텍스트는 원본 글꼴을 유지해 편집하세요.".into());
                }
                let original = obj.as_text_object().ok_or("텍스트 개체가 아닙니다.")?;
                let mut replacement =
                    PdfPageTextObject::new(doc, &text, font, original.unscaled_font_size())
                        .map_err(err)?;
                replacement
                    .set_fill_color(obj.fill_color().map_err(err)?)
                    .map_err(err)?;
                replacement
                    .set_render_mode(original.render_mode())
                    .map_err(err)?;
                replacement.transform_from(&obj).map_err(err)?;
                drop(obj);
                // 개체 순서를 보존해 다른 도형과의 앞뒤 관계가 바뀌지 않도록 합니다.
                let mut tail = Vec::new();
                while page.objects().len() > index + 1 {
                    tail.push(
                        page.objects_mut()
                            .remove_object_at_index(index + 1)
                            .map_err(err)?,
                    );
                }
                page.objects_mut()
                    .remove_object_at_index(index)
                    .map_err(err)?;
                page.objects_mut()
                    .add_text_object(replacement)
                    .map_err(err)?;
                for object in tail {
                    page.objects_mut().add_object(object).map_err(err)?;
                }
            } else {
                obj.as_text_object_mut()
                    .ok_or("텍스트 개체가 아닙니다.")?
                    .set_text(&text)
                    .map_err(err)?;
                drop(obj);
            }
            page.regenerate_content().map_err(err)?;
            let actual = page
                .objects()
                .get(index)
                .map_err(err)?
                .as_text_object()
                .ok_or("텍스트를 확인할 수 없습니다.")?
                .text();
            if actual != text {
                return Err(
                    "원본 글꼴에 입력한 문자가 없거나 매핑이 불완전합니다. 변경을 취소했습니다."
                        .into(),
                );
            }
        }
        Request::Image { index, path, .. } => {
            let image = image::ImageReader::open(path)
                .map_err(err)?
                .with_guessed_format()
                .map_err(err)?
                .decode()
                .map_err(err)?;
            if let Some(index) = index {
                let mut obj = page.objects().get(index).map_err(err)?;
                obj.as_image_object_mut()
                    .ok_or("이미지 개체가 아닙니다.")?
                    .set_image(&image)
                    .map_err(err)?;
            } else {
                let scale = (page.width().value * 0.5 / image.width() as f32)
                    .min(page.height().value * 0.7 / image.height() as f32);
                let width = image.width() as f32 * scale;
                let height = image.height() as f32 * scale;
                page.objects_mut()
                    .create_image_object(
                        PdfPoints::new(36.),
                        PdfPoints::new(36.),
                        &image,
                        Some(PdfPoints::new(width)),
                        Some(PdfPoints::new(height)),
                    )
                    .map_err(err)?;
            }
        }
        Request::Transform {
            index,
            x,
            y,
            width,
            height,
            ..
        } => {
            if ![x, y, width, height].iter().all(|v| v.is_finite()) || width <= 0. || height <= 0. {
                return Err("위치와 크기를 확인하세요.".into());
            }
            let mut obj = page.objects().get(index).map_err(err)?;
            let b = obj.bounds().map_err(err)?.to_rect();
            if b.width().value <= 0. || b.height().value <= 0. {
                return Err("크기가 없는 개체입니다.".into());
            }
            obj.translate(-b.left(), -b.bottom()).map_err(err)?;
            obj.scale(width / b.width().value, height / b.height().value)
                .map_err(err)?;
            obj.translate(PdfPoints::new(x), PdfPoints::new(y))
                .map_err(err)?;
        }
        Request::RotateImage { index, .. } => {
            let mut obj = page.objects().get(index).map_err(err)?;
            let image = obj.as_image_object_mut().ok_or("이미지 개체가 아닙니다.")?;
            let bounds = image.bounds().map_err(err)?.to_rect();
            let pixels = image.get_raw_image().map_err(err)?.rotate90();
            image.set_image(&pixels).map_err(err)?;
            image
                .translate(-bounds.left(), -bounds.bottom())
                .map_err(err)?;
            image
                .scale(
                    bounds.height().value / bounds.width().value,
                    bounds.width().value / bounds.height().value,
                )
                .map_err(err)?;
            image
                .translate(
                    bounds.left() + (bounds.width() - bounds.height()) / 2.,
                    bounds.bottom() + (bounds.height() - bounds.width()) / 2.,
                )
                .map_err(err)?;
        }
        Request::CropImage {
            index,
            left,
            top,
            width,
            height,
            ..
        } => {
            let mut obj = page.objects().get(index).map_err(err)?;
            let image = obj.as_image_object_mut().ok_or("이미지 개체가 아닙니다.")?;
            let pixels = image.get_raw_image().map_err(err)?;
            if width == 0
                || height == 0
                || left as u64 + width as u64 > pixels.width() as u64
                || top as u64 + height as u64 > pixels.height() as u64
            {
                return Err("자르기 범위가 이미지 밖입니다.".into());
            }
            image
                .set_image(&pixels.crop_imm(left, top, width, height))
                .map_err(err)?;
        }
        Request::Delete { index, .. } => {
            page.objects_mut()
                .remove_object_at_index(index)
                .map_err(err)?;
        }
        _ => unreachable!(),
    }
    page.regenerate_content().map_err(err)?;
    Ok(())
}

pub fn library_path(base: &Path) -> PathBuf {
    base.join(if cfg!(target_os = "windows") {
        "pdfium-win/bin"
    } else {
        "pdfium/lib"
    })
    .join(if cfg!(target_os = "windows") {
        "pdfium.dll"
    } else {
        "libpdfium.dylib"
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(pdfium: &Pdfium, path: &Path, count: i32) {
        let mut d = pdfium.create_new_pdf().unwrap();
        let font = d.fonts_mut().helvetica();
        for n in 0..count {
            let mut p = d
                .pages_mut()
                .create_page_at_end(PdfPagePaperSize::a4())
                .unwrap();
            p.objects_mut()
                .create_text_object(
                    PdfPoints::new(55.),
                    PdfPoints::new(760.),
                    format!("DalPDF original page {}", n + 1),
                    font,
                    PdfPoints::new(22.),
                )
                .unwrap();
            let image = image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
                100,
                60,
                image::Rgb([20, 100, 210]),
            ));
            p.objects_mut()
                .create_image_object(
                    PdfPoints::new(55.),
                    PdfPoints::new(500.),
                    &image,
                    Some(PdfPoints::new(200.)),
                    Some(PdfPoints::new(120.)),
                )
                .unwrap();
        }
        d.save_to_file(path).unwrap();
    }
    #[test]
    #[ignore = "실제 문서는 DALPDF_TEST_PDF로 지정합니다."]
    fn real_document_translation() {
        let path = std::env::var("DALPDF_TEST_PDF").unwrap();
        let pdfium = test_pdfium();
        let mut state = None;
        handle(
            &pdfium,
            &mut state,
            Request::Open {
                path,
                password: None,
            },
        )
        .unwrap();
        if let Ok(output) = std::env::var("DALPDF_ALL_TEXT_FIXTURE") {
            let mut pages = Vec::new();
            for page in 0..state.as_ref().unwrap().doc.pages().len() {
                pages.push(handle(&pdfium, &mut state, Request::PageText { page }).unwrap());
            }
            std::fs::write(output, serde_json::to_vec(&pages).unwrap()).unwrap();
        }
        let page = std::env::var("DALPDF_TEST_PAGE").ok().map(|s| s.parse().unwrap()).unwrap_or(0);
        let result = handle(&pdfium, &mut state, Request::PageText { page }).unwrap();
        if let Ok(output) = std::env::var("DALPDF_TEXT_FIXTURE") {
            std::fs::write(output, serde_json::to_vec(&result).unwrap()).unwrap();
        }
        assert!(!result["chars"].as_array().unwrap().is_empty());
        if let Ok(input) = std::env::var("DALPDF_TRANSLATION_PAGES_FIXTURE") {
            let pages = serde_json::from_slice(&std::fs::read(input).unwrap()).unwrap();
            let output = std::env::var("DALPDF_EXPORT_FIXTURE").unwrap();
            handle(
                &pdfium,
                &mut state,
                Request::SaveTranslation {
                    path: output,
                    font: "gothic".into(),
                    pages,
                },
            )
            .unwrap();
        }
        handle(
            &pdfium,
            &mut state,
            Request::TranslationBackground {
                page,
                width: 600,
            },
        )
        .unwrap();
    }
    fn translation_export_round_trip(pdfium: &Pdfium, session: &Session, dir: &Path) {
        for family in ["gothic", "serif"] {
            let output = dir.join(format!("translated-{family}.pdf"));
            let pages = vec![
                TranslationPage {
                    page: 0,
                    whole_page: true,
                    masks: vec![],
                    lines: vec![TranslationLine {
                        text: "한국어 번역문 · English · 日本語".into(),
                        x: 55.,
                        y: 100.,
                        width: 300.,
                        size: 16.,
                        color: [20, 40, 80],
                    }],
                },
                TranslationPage {
                    page: 1,
                    whole_page: false,
                    masks: vec![[0.09, 0.07, 0.12, 0.04]],
                    lines: vec![TranslationLine {
                        text: "선택 번역".into(),
                        x: 55.,
                        y: 100.,
                        width: 100.,
                        size: 12.,
                        color: [0, 0, 0],
                    }],
                },
            ];
            save_translation(pdfium, session, output.to_str().unwrap(), family, &pages).unwrap();
            let saved = pdfium.load_pdf_from_file(&output, None).unwrap();
            assert_eq!(saved.pages().len(), session.doc.pages().len());
            let first = saved.pages().get(0).unwrap();
            let text = first.text().unwrap().all();
            assert!(text.contains("한국어 번역문"));
            assert!(!text.contains("DalPDF original"));
            assert!(saved
                .pages()
                .get(1)
                .unwrap()
                .text()
                .unwrap()
                .all()
                .contains("선택 번역"));
            assert!(saved
                .pages()
                .get(2)
                .unwrap()
                .text()
                .unwrap()
                .all()
                .contains("DalPDF original page 3"));
            assert!(session
                .doc
                .pages()
                .get(0)
                .unwrap()
                .text()
                .unwrap()
                .all()
                .contains("DalPDF original page 1"));
            assert!(save_translation(pdfium, session, &session.path, family, &pages).is_err());
            assert!(
                save_translation(pdfium, session, output.to_str().unwrap(), "unknown", &pages)
                    .is_err()
            );
            if let Ok(destination) = std::env::var("DALPDF_EXPORT_FIXTURE") {
                std::fs::copy(&output, format!("{destination}-{family}.pdf")).unwrap();
                first
                    .render_with_config(&PdfRenderConfig::new().set_target_width(1000))
                    .unwrap()
                    .as_image()
                    .unwrap()
                    .save(format!("{destination}-{family}.png"))
                    .unwrap();
            }
        }
    }
    fn generated_line_breaks_keep_text_without_requesting_color(pdfium: &Pdfium) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("paragraphs.pdf");
        let mut document = pdfium.create_new_pdf().unwrap();
        let font = document.fonts_mut().helvetica();
        let mut page = document
            .pages_mut()
            .create_page_at_end(PdfPagePaperSize::a4())
            .unwrap();
        for (y, text) in [
            (760., "First sentence. Another sentence."),
            (735., "This is the next line."),
            (670., "A separate paragraph begins here."),
        ] {
            page.objects_mut()
                .create_text_object(
                    PdfPoints::new(55.),
                    PdfPoints::new(y),
                    text,
                    font,
                    PdfPoints::new(16.),
                )
                .unwrap();
        }
        drop(page);
        document.save_to_file(&path).unwrap();
        let mut state = None;
        handle(
            pdfium,
            &mut state,
            Request::Open {
                path: path.to_string_lossy().into(),
                password: None,
            },
        )
        .unwrap();
        let result = handle(pdfium, &mut state, Request::PageText { page: 0 }).unwrap();
        let chars = result["chars"].as_array().unwrap();
        assert!(chars
            .iter()
            .any(|c| c["text"] == "\r" && c["color"].is_null()));
        let text: String = chars.iter().map(|c| c["text"].as_str().unwrap()).collect();
        assert!(text.contains("First sentence.") && text.contains("separate paragraph"));
        if let Ok(destination) = std::env::var("DALPDF_TRANSLATION_FIXTURE") {
            std::fs::copy(path, destination).unwrap();
        }
    }
    #[test]
    fn ranges_reject_invalid_and_preserve_order() {
        assert_eq!(page_range("3,1-2,2", 3).unwrap(), vec![2, 0, 1]);
        for input in ["", "0", "4", "3-1", "1-2-3", "1,", "-1"] {
            assert!(page_range(input, 3).is_err(), "{input}");
        }
    }
    #[test]
    fn annotations_save_move_undo_and_rotated_coordinates() {
        let dir = tempfile::tempdir().unwrap();
        let pdfium = test_pdfium();
        for rotation in [PdfPageRenderRotation::None, PdfPageRenderRotation::Degrees90,
            PdfPageRenderRotation::Degrees180, PdfPageRenderRotation::Degrees270] {
            let input = dir.path().join("annotations-source.pdf");
            fixture(&pdfium, &input, 1);
            {
                let document = pdfium.load_pdf_from_file(&input, None).unwrap();
                document.pages().get(0).unwrap().set_rotation(rotation);
                document.save_to_file(&dir.path().join("rotated.pdf")).unwrap();
            }
            let mut state = None;
            handle(&pdfium, &mut state, Request::Open {path:dir.path().join("rotated.pdf").to_string_lossy().into(),password:None}).unwrap();
            let before = handle(&pdfium, &mut state, Request::Render {page:0,width:600}).unwrap();
            let original_objects = handle(&pdfium, &mut state, Request::Objects {page:0}).unwrap();
            let boxes = vec![[0.1,0.2,0.3,0.025],[0.1,0.24,0.2,0.025]];
            handle(&pdfium, &mut state, Request::AddHighlight {page:0,boxes:boxes.clone(),color:[255,220,0]}).unwrap();
            let highlighted = handle(&pdfium, &mut state, Request::Render {page:0,width:600}).unwrap();
            let image = image::load_from_memory(&STANDARD.decode(highlighted.as_str().unwrap().split(',').nth(1).unwrap()).unwrap()).unwrap().to_rgb8();
            assert!(image.pixels().filter(|p| p[0]>150 && p[1]>120 && p[2]<p[0]-20).count()>500);
            handle(&pdfium, &mut state, Request::AddNote {page:0,x:0.6,y:0.4,text:"첫 메모".into()}).unwrap();
            let result = handle(&pdfium, &mut state, Request::Annotations {page:0}).unwrap();
            assert_eq!(result["annotations"][0]["kind"], "highlight");
            assert_eq!(result["annotations"][1]["text"], "첫 메모");
            for (n, expected) in boxes.iter().enumerate() {
                for (axis, value) in expected.iter().enumerate() {
                    assert!((result["annotations"][0]["boxes"][n][axis].as_f64().unwrap()-*value as f64).abs()<0.0003);
                }
            }
            let rendered = handle(&pdfium, &mut state, Request::Render {page:0,width:600}).unwrap();
            assert_ne!(rendered,before);
            handle(&pdfium, &mut state, Request::EditAnnotation {page:0,index:1,text:"수정한 메모".into()}).unwrap();
            assert_eq!(handle(&pdfium, &mut state, Request::Render {page:0,width:600}).unwrap(),rendered);
            let undo_count = state.as_ref().unwrap().undo.len();
            handle(&pdfium, &mut state, Request::MoveAnnotation {page:0,index:1,x:0.3,y:0.7}).unwrap();
            assert_eq!(state.as_ref().unwrap().undo.len(),undo_count+1);
            let moved = handle(&pdfium, &mut state, Request::Annotations {page:0}).unwrap();
            assert_eq!(moved["annotations"][1]["text"],"수정한 메모");
            assert!((moved["annotations"][1]["display"][0].as_f64().unwrap()-0.3).abs()<0.0003);
            assert!((moved["annotations"][1]["display"][1].as_f64().unwrap()-0.7).abs()<0.0003);
            handle(&pdfium, &mut state, Request::Undo).unwrap();
            let undone = handle(&pdfium, &mut state, Request::Annotations {page:0}).unwrap();
            assert!((undone["annotations"][1]["display"][0].as_f64().unwrap()-0.6).abs()<0.0003);
            handle(&pdfium, &mut state, Request::Redo).unwrap();
            let session_before = info(state.as_ref().unwrap()).unwrap();
            let print_path = dir.path().join("print-snapshot.pdf");
            handle(&pdfium, &mut state, Request::PrintSnapshot {path:print_path.to_string_lossy().into()}).unwrap();
            assert_eq!(info(state.as_ref().unwrap()).unwrap(),session_before);
            let printed = pdfium.load_pdf_from_file(&print_path,None).unwrap();
            assert_eq!(printed.pages().get(0).unwrap().annotations().len(),2);
            let source_path = state.as_ref().unwrap().path.clone();
            assert!(handle(&pdfium,&mut state,Request::PrintSnapshot {path:source_path}).is_err());
            let output = dir.path().join("annotations-saved.pdf");
            handle(&pdfium, &mut state, Request::Save {path:output.to_string_lossy().into()}).unwrap();
            handle(&pdfium, &mut state, Request::Open {path:output.to_string_lossy().into(),password:None}).unwrap();
            let reopened = handle(&pdfium, &mut state, Request::Annotations {page:0}).unwrap();
            assert_eq!(reopened,moved);
            assert_eq!(handle(&pdfium, &mut state, Request::Objects {page:0}).unwrap(),original_objects);
            let before_edit = handle(&pdfium, &mut state, Request::Render {page:0,width:600}).unwrap();
            handle(&pdfium, &mut state, Request::EditAnnotation {page:0,index:0,text:"선택한 내용".into()}).unwrap();
            assert_eq!(handle(&pdfium, &mut state, Request::Render {page:0,width:600}).unwrap(),before_edit);
            handle(&pdfium, &mut state, Request::DeleteAnnotation {page:0,index:1}).unwrap();
            let remaining = handle(&pdfium, &mut state, Request::Annotations {page:0}).unwrap();
            assert_eq!(remaining["annotations"].as_array().unwrap().len(),1);
            assert_eq!(remaining["annotations"][0]["text"],"선택한 내용");
            assert!(handle(&pdfium,&mut state,Request::AddHighlight {page:0,boxes:vec![],color:[0,0,0]}).is_err());

        }
    }
    #[test]
    fn original_objects_save_undo_merge_extract_and_render() {
        let pdfium = test_pdfium();
        generated_line_breaks_keep_text_without_requesting_color(&pdfium);
        let dir = tempfile::tempdir().unwrap();
        let input = dir.path().join("input.pdf");
        fixture(&pdfium, &input, 3);
        let mut state = None;
        handle(
            &pdfium,
            &mut state,
            Request::Open {
                path: input.to_string_lossy().into(),
                password: None,
            },
        )
        .unwrap();
        translation_export_round_trip(&pdfium, state.as_ref().unwrap(), dir.path());
        let batch = handle(&pdfium, &mut state, Request::DocumentText { path: None, start: 1, count: 8 }).unwrap();
        assert_eq!(batch["total"], 3);
        assert_eq!(batch["pages"].as_array().unwrap().len(), 2);
        assert!(batch["pages"][0]["text"].as_str().unwrap().contains("original page 2"));
        let other = dir.path().join("compare.pdf");
        fixture(&pdfium, &other, 2);
        let external = handle(&pdfium, &mut state, Request::DocumentText { path: Some(other.to_string_lossy().into()), start: 0, count: 8 }).unwrap();
        assert_eq!(external["total"], 2);
        assert_eq!(state.as_ref().unwrap().doc.pages().len(), 3);
        assert_eq!(state.as_ref().unwrap().path, input.to_string_lossy());
        assert!(handle(&pdfium, &mut state, Request::DocumentText { path: None, start: -1, count: 8 }).is_err());

        let extracted = handle(&pdfium, &mut state, Request::PageText { page: 0 }).unwrap();
        let chars = extracted["chars"].as_array().unwrap();
        let text: String = chars.iter().map(|c| c["text"].as_str().unwrap()).collect();
        assert!(text.contains("DalPDF original page 1"));
        assert!(chars
            .iter()
            .filter(|c| !c["text"].as_str().unwrap().trim().is_empty())
            .all(|c| {
                let bounds = c["box"].as_array().unwrap();
                bounds.iter().all(|v| v.as_f64().unwrap().is_finite())
                    && bounds[2].as_f64().unwrap() > 0.
            }));
        let before = handle(
            &pdfium,
            &mut state,
            Request::Render {
                page: 0,
                width: 600,
            },
        )
        .unwrap();
        let background = handle(
            &pdfium,
            &mut state,
            Request::TranslationBackground {
                page: 0,
                width: 600,
            },
        )
        .unwrap();
        assert_ne!(background, before);
        let unchanged = handle(
            &pdfium,
            &mut state,
            Request::Render {
                page: 0,
                width: 600,
            },
        )
        .unwrap();
        assert_eq!(
            unchanged, before,
            "번역 표시가 원본 렌더링을 바꾸면 안 됩니다."
        );
        let decode = |value: &Value| {
            image::load_from_memory(
                &STANDARD
                    .decode(value.as_str().unwrap().split(',').nth(1).unwrap())
                    .unwrap(),
            )
            .unwrap()
            .to_rgba8()
        };
        let original_image = decode(&before);
        let background_image = decode(&background);
        assert_eq!(original_image.dimensions(), background_image.dimensions());
        for (x, y, pixel) in original_image.enumerate_pixels() {
            if pixel[2] > pixel[0].saturating_add(40) {
                assert_eq!(
                    pixel,
                    background_image.get_pixel(x, y),
                    "그림의 색상을 보존해야 합니다."
                );
            }
        }
        handle(
            &pdfium,
            &mut state,
            Request::Text {
                page: 0,
                index: 0,
                text: "Actual replacement text".into(),
                font_path: None,
            },
        )
        .unwrap();
        let text = state
            .as_ref()
            .unwrap()
            .doc
            .pages()
            .get(0)
            .unwrap()
            .text()
            .unwrap()
            .all();
        assert!(text.contains("Actual replacement text"));
        assert!(!text.contains("original"));
        handle(&pdfium, &mut state, Request::Undo).unwrap();
        assert!(state
            .as_ref()
            .unwrap()
            .doc
            .pages()
            .get(0)
            .unwrap()
            .text()
            .unwrap()
            .all()
            .contains("original"));
        handle(&pdfium, &mut state, Request::Redo).unwrap();
        let replacement = dir.path().join("image.png");
        image::RgbImage::from_pixel(80, 40, image::Rgb([220u8, 30, 10]))
            .save(&replacement)
            .unwrap();
        handle(
            &pdfium,
            &mut state,
            Request::Image {
                page: 0,
                index: Some(1),
                path: replacement.to_string_lossy().into(),
            },
        )
        .unwrap();
        handle(
            &pdfium,
            &mut state,
            Request::Transform {
                page: 0,
                index: 1,
                x: 80.,
                y: 400.,
                width: 160.,
                height: 80.,
            },
        )
        .unwrap();
        handle(
            &pdfium,
            &mut state,
            Request::CropImage {
                page: 0,
                index: 1,
                left: 10,
                top: 5,
                width: 50,
                height: 20,
            },
        )
        .unwrap();
        handle(
            &pdfium,
            &mut state,
            Request::RotateImage { page: 0, index: 1 },
        )
        .unwrap();
        let invalid = handle(
            &pdfium,
            &mut state,
            Request::CropImage {
                page: 0,
                index: 1,
                left: 1000,
                top: 0,
                width: 2,
                height: 2,
            },
        );
        assert!(invalid.is_err());
        let out = dir.path().join("edited.pdf");
        handle(
            &pdfium,
            &mut state,
            Request::Save {
                path: out.to_string_lossy().into(),
            },
        )
        .unwrap();
        let reopened = pdfium.load_pdf_from_file(&out, None).unwrap();
        let p = reopened.pages().get(0).unwrap();
        assert_eq!(p.objects().len(), 2);
        assert!(p.text().unwrap().all().contains("Actual replacement text"));
        assert!(!p.text().unwrap().all().contains("original"));
        let obj = p.objects().get(1).unwrap();
        let img = obj.as_image_object().unwrap().get_raw_image().unwrap();
        assert_eq!((img.width(), img.height()), (20, 50));
        assert_ne!(
            before,
            handle(
                &pdfium,
                &mut state,
                Request::Render {
                    page: 0,
                    width: 600
                }
            )
            .unwrap()
        );
        let split = dir.path().join("split.pdf");
        handle(
            &pdfium,
            &mut state,
            Request::Extract {
                pages: "3,1".into(),
                path: split.to_string_lossy().into(),
            },
        )
        .unwrap();
        let extracted = pdfium.load_pdf_from_file(&split, None).unwrap();
        assert_eq!(extracted.pages().len(), 2);
        assert!(extracted
            .pages()
            .get(0)
            .unwrap()
            .text()
            .unwrap()
            .all()
            .contains("page 3"));
        handle(
            &pdfium,
            &mut state,
            Request::Merge {
                paths: vec![split.to_string_lossy().into()],
            },
        )
        .unwrap();
        assert_eq!(state.as_ref().unwrap().doc.pages().len(), 5);
        handle(
            &pdfium,
            &mut state,
            Request::Image {
                page: 0,
                index: None,
                path: replacement.to_string_lossy().into(),
            },
        )
        .unwrap();
        assert_eq!(
            state
                .as_ref()
                .unwrap()
                .doc
                .pages()
                .get(0)
                .unwrap()
                .objects()
                .len(),
            3
        );
        handle(&pdfium, &mut state, Request::Delete { page: 0, index: 2 }).unwrap();
        assert_eq!(
            state
                .as_ref()
                .unwrap()
                .doc
                .pages()
                .get(0)
                .unwrap()
                .objects()
                .len(),
            2
        );
        assert!(pdfium
            .load_pdf_from_file(&input, None)
            .unwrap()
            .pages()
            .get(0)
            .unwrap()
            .text()
            .unwrap()
            .all()
            .contains("original"));
        #[cfg(target_os = "macos")]
        {
            handle(
                &pdfium,
                &mut state,
                Request::Text {
                    page: 0,
                    index: 0,
                    text: "달베어 원본 텍스트 편집".into(),
                    font_path: Some("/System/Library/Fonts/Supplemental/Arial Unicode.ttf".into()),
                },
            )
            .unwrap();
            let text = state
                .as_ref()
                .unwrap()
                .doc
                .pages()
                .get(0)
                .unwrap()
                .text()
                .unwrap()
                .all();
            assert!(text.contains("달베어 원본 텍스트 편집"));
            assert!(!text.contains("Actual replacement"));
            assert_eq!(
                state
                    .as_ref()
                    .unwrap()
                    .doc
                    .pages()
                    .get(0)
                    .unwrap()
                    .objects()
                    .len(),
                2
            );
        }
        let sample = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/sample.pdf");
        fixture(&pdfium, &sample, 12);
    }
    #[test]
    #[ignore = "대용량 성능 측정은 release 모드에서 별도로 실행합니다."]
    fn large_document_measurement() {
        let pdfium = test_pdfium();
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/large.pdf");
        if !path.exists() {
            let mut d = pdfium.create_new_pdf().unwrap();
            let font = d.fonts_mut().helvetica();
            let mut seed = 7u32;
            for n in 0..120 {
                let mut p = d
                    .pages_mut()
                    .create_page_at_end(PdfPagePaperSize::a4())
                    .unwrap();
                p.objects_mut()
                    .create_text_object(
                        PdfPoints::new(40.),
                        PdfPoints::new(790.),
                        format!("DalPDF large document {}", n + 1),
                        font,
                        PdfPoints::new(18.),
                    )
                    .unwrap();
                let pixels = image::RgbImage::from_fn(1024, 768, |_, _| {
                    let mut rgb = [0u8; 3];
                    for c in &mut rgb {
                        seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                        *c = (seed >> 24) as u8;
                    }
                    image::Rgb(rgb)
                });
                p.objects_mut()
                    .create_image_object(
                        PdfPoints::new(40.),
                        PdfPoints::new(250.),
                        &image::DynamicImage::ImageRgb8(pixels),
                        Some(PdfPoints::new(510.)),
                        Some(PdfPoints::new(382.5)),
                    )
                    .unwrap();
            }
            d.save_to_file(&path).unwrap();
        }
        let mut state = None;
        let now = std::time::Instant::now();
        handle(
            &pdfium,
            &mut state,
            Request::Open {
                path: path.to_string_lossy().into(),
                password: None,
            },
        )
        .unwrap();
        let open_ms = now.elapsed().as_secs_f64() * 1000.;
        let now = std::time::Instant::now();
        handle(
            &pdfium,
            &mut state,
            Request::Render {
                page: 0,
                width: 1500,
            },
        )
        .unwrap();
        let first_ms = now.elapsed().as_secs_f64() * 1000.;
        let mut samples = Vec::new();
        for page in [1, 2, 3, 30, 60, 90, 119] {
            let now = std::time::Instant::now();
            handle(&pdfium, &mut state, Request::Render { page, width: 1500 }).unwrap();
            samples.push(now.elapsed().as_secs_f64() * 1000.);
        }
        let report = json!({"bytes":std::fs::metadata(&path).unwrap().len(),"pages":120,"open_ms":open_ms,"first_render_png_ms":first_ms,"sample_render_png_ms":samples});
        println!("{report}");
        std::fs::write(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/performance.json"),
            serde_json::to_string_pretty(&report).unwrap(),
        )
        .unwrap();
    }
}
