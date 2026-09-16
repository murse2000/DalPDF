use pdfium_render::prelude::*;
use serde::Deserialize;
use std::{io::Write, path::Path};

#[derive(Clone, Deserialize)]
pub struct Citation { pub page: usize, pub quote: String }
#[derive(Clone, Deserialize)]
pub struct Card { pub title: String, pub answer: String, pub citations: Vec<Citation> }
#[derive(Clone, Deserialize)]
pub struct Report {
    pub source_path: String, pub page_count: usize, pub processed: usize,
    pub total: usize, pub complete: bool, pub cards: Vec<Card>,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Format { Pdf, Md }
#[derive(Deserialize)]
pub struct Request { pub path: String, pub format: Format, pub report: Report }

fn error(e: impl std::fmt::Display) -> String { e.to_string() }
fn source_name(report: &Report) -> &str { report.source_path.rsplit(['/', '\\']).next().unwrap_or(&report.source_path) }
fn progress(report: &Report) -> String {
    if report.complete { format!("전체 {}페이지 검토 완료", report.page_count) }
    else { format!("일부 결과 - {} / {}구간 검토 완료 (전체 {}페이지)", report.processed, report.total, report.page_count) }
}
fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").chars()
        .map(|c| if matches!(c, '\\'|'*'|'_'|'['|']'|'`'|'#') { format!("\\{c}") } else { c.to_string() }).collect()
}
pub fn markdown(report: &Report) -> String {
    let mut output = format!("# 핵심 안내\n\n원문: {}\n\n{}\n", escape(source_name(report)), progress(report));
    for (i, card) in report.cards.iter().enumerate() {
        output.push_str(&format!("\n## {}. {}\n\n{}\n", i+1, escape(&card.title.replace(['\r','\n'], " ")), escape(&card.answer)));
        for citation in &card.citations {
            output.push_str(&format!("\n근거: 원문 {}페이지\n\n", citation.page));
            for line in escape(&citation.quote).lines() { output.push_str(&format!("> {line}\n")); }
        }
    }
    output
}

// PDFium의 실제 글자 폭으로 줄을 나누며 공백 없는 긴 문자열도 문자 경계에서 넘깁니다.
fn wrap(text: &str, width: f32, measure: impl Fn(&str) -> Result<f32, String>) -> Result<Vec<String>, String> {
    let mut lines = Vec::new();
    for paragraph in text.lines() {
        let mut remaining = paragraph.trim();
        while !remaining.is_empty() {
            let boundaries: Vec<usize> = remaining.char_indices().map(|(i,_)| i).chain([remaining.len()]).collect();
            let mut low = 1; let mut high = boundaries.len()-1;
            while low < high {
                let middle = (low + high).div_ceil(2);
                if measure(&remaining[..boundaries[middle]])? <= width { low = middle; } else { high = middle-1; }
            }
            let mut end = boundaries[low];
            if end < remaining.len() {
                if let Some((position,_)) = remaining[..end].char_indices().rev().find(|(i,c)| *i > end/2 && c.is_whitespace()) { end = position; }
            }
            let line = remaining[..end].trim_end();
            if measure(line)? > width + 0.1 { return Err("내보낼 글자가 페이지 너비보다 큽니다.".into()); }
            lines.push(line.to_string()); remaining = remaining[end..].trim_start();
        }
    }
    Ok(lines)
}

fn pdf(pdfium: &Pdfium, report: &Report, path: &Path) -> Result<(), String> {
    let mut document = pdfium.create_new_pdf().map_err(error)?;
    let font = document.fonts_mut().load_true_type_from_bytes(include_bytes!("../../public/fonts/sans.ttf"), true).map_err(error)?;
    let mut paragraphs = vec![("핵심 안내".to_string(),22.,true), (format!("원문: {}", source_name(report)),10.,false), (progress(report),10.,false)];
    for (i, card) in report.cards.iter().enumerate() {
        paragraphs.push((format!("{}. {}", i+1, card.title),14.,true));
        paragraphs.push((card.answer.clone(),11.,false));
        for citation in &card.citations {
            paragraphs.push((format!("근거: 원문 {}페이지", citation.page),9.,true));
            paragraphs.push((citation.quote.clone(),9.,false));
        }
    }
    let mut pages: Vec<Vec<(String,f32,f32)>> = vec![Vec::new()];
    let mut y = 790_f32;
    for (paragraph,size,heading) in paragraphs {
        let gap = if heading { 14. } else { 7. };
        y -= gap;
        if heading && y < 105. { pages.push(Vec::new()); y = 790.; }
        let lines = wrap(&paragraph,499.,|text| {
            Ok(PdfPageTextObject::new(&document,text,font,PdfPoints::new(size)).map_err(error)?.bounds().map_err(error)?.to_rect().width().value)
        })?;
        for line in lines {
            if y < 55. { pages.push(Vec::new()); y = 790.; }
            pages.last_mut().unwrap().push((line,size,y)); y -= size*1.5;
        }
    }
    let total = pages.len();
    for (number, lines) in pages.into_iter().enumerate() {
        let mut page = document.pages_mut().create_page_at_end(PdfPagePaperSize::a4()).map_err(error)?;
        for (line,size,y) in lines.into_iter().chain([(format!("{} / {}",number+1,total),9.,28.)]) {
            let mut object = PdfPageTextObject::new(&document,&line,font,PdfPoints::new(size)).map_err(error)?;
            object.set_fill_color(if size < 10. { PdfColor::new(75,85,100,255) } else { PdfColor::new(24,36,53,255) }).map_err(error)?;
            object.translate(PdfPoints::new(48.),PdfPoints::new(y)).map_err(error)?;
            page.objects_mut().add_text_object(object).map_err(error)?;
        }
    }
    document.save_to_file(path).map_err(error)?;
    let check = pdfium.load_pdf_from_file(path,None).map_err(error)?;
    if check.pages().len() as usize != total { return Err("핵심 안내 PDF 저장 검증에 실패했습니다.".into()); }
    Ok(())
}

pub fn export(pdfium: &Pdfium, request: Request) -> Result<serde_json::Value,String> {
    let report = &request.report;
    if report.cards.is_empty() { return Err("저장할 핵심 안내가 없습니다.".into()); }
    if report.cards.iter().any(|c| c.citations.is_empty() || c.citations.iter().any(|s| s.page == 0 || s.page > report.page_count)) {
        return Err("핵심 안내의 근거 페이지가 올바르지 않습니다.".into());
    }
    let target = Path::new(&request.path);
    if target == Path::new(&report.source_path) || target.canonicalize().ok().zip(Path::new(&report.source_path).canonicalize().ok()).is_some_and(|(a,b)| a==b) {
        return Err("핵심 안내는 원본 PDF와 다른 파일로 저장해 주세요.".into());
    }
    let parent = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let mut temporary = tempfile::NamedTempFile::new_in(parent).map_err(error)?;
    match request.format {
        Format::Md => temporary.write_all(markdown(report).as_bytes()).map_err(error)?,
        Format::Pdf => pdf(pdfium,report,temporary.path())?,
    }
    temporary.as_file().sync_all().map_err(error)?;
    temporary.persist(target).map_err(error)?;
    Ok(serde_json::json!({"saved":true}))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Report {
        Report { source_path:"DS_stm32g041f6.pdf".into(),page_count:128,processed:3,total:77,complete:false,
            cards:(0..9).map(|n|Card {title:format!("한글 핵심 안내 {} - 동작 전압과 사용 조건",n+1),
                answer:"소자의 동작 전압은 1.7 V에서 3.6 V입니다. 전원 공급 조건과 각 주변장치의 허용 범위를 원문에서 함께 확인해야 합니다. ".repeat(4),
                citations:vec![Citation {page:17,quote:"The STM32G041x6/x8 devices require a 1.7 V to 3.6 V operating supply voltage (VDD). 긴 원문 인용문도 페이지 끝에서 잘리지 않고 다음 페이지에 이어집니다. ".repeat(3)}]}).collect() }
    }
    #[test]
    fn markdown_preserves_partial_status_and_source_pages() {
        let mut report=fixture();report.cards[0].title="<script> [링크] #제목".into();
        let value=markdown(&report);
        assert!(value.contains("일부 결과 - 3 / 77구간"));assert!(value.contains("원문 17페이지"));
        assert!(!value.contains("<script>"));assert!(value.contains("&lt;script&gt;"));
        assert!(value.contains("1.7 V에서 3.6 V"));
    }
    #[test]
    fn long_korean_pdf_embeds_text_and_keeps_every_line_inside_pages() {
        let pdfium=crate::engine::test_pdfium();
        let report=fixture();let directory=tempfile::tempdir().unwrap();let path=directory.path().join("overview.pdf");
        export(&pdfium,Request {path:path.to_string_lossy().into(),format:Format::Pdf,report:report.clone()}).unwrap();
        let document=pdfium.load_pdf_from_file(&path,None).unwrap();assert!(document.pages().len()>2);
        let mut text=String::new();
        for page in document.pages().iter() {
            text.push_str(&page.text().unwrap().all());
            for object in page.objects().iter() {
                let bounds=object.bounds().unwrap().to_rect();
                assert!(bounds.left().value>=47. && bounds.right().value<=549. && bounds.bottom().value>=20. && bounds.top().value<=815.,"{bounds:?}");
            }
        }
        let compact=|s:&str|s.chars().filter(|c|!c.is_whitespace()).collect::<String>();
        assert!(compact(&text).contains(&compact(&report.cards[0].answer)));
        assert!(text.contains("일부 결과"));assert!(text.contains("원문 17페이지"));assert!(text.contains("한글 핵심 안내 9"));
        if let Ok(target)=std::env::var("DALPDF_EXPORT_FIXTURE") {
            std::fs::create_dir_all(Path::new(&target).parent().unwrap()).unwrap();
            std::fs::copy(&path,&target).unwrap();std::fs::write(Path::new(&target).with_extension("md"),markdown(&report)).unwrap();
        }
        let bad=export(&pdfium,Request {path:report.source_path.clone(),format:Format::Pdf,report});assert!(bad.is_err());
    }
    #[test]
    fn wrapping_does_not_drop_unspaced_unicode_text() {
        let text="가나다라마바사".repeat(40);let lines=wrap(&text,10.,|s|Ok(s.chars().count() as f32)).unwrap();
        assert_eq!(lines.concat(),text);assert!(lines.iter().all(|s|s.chars().count()<=10));
    }
}
