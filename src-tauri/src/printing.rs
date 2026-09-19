use serde::Deserialize;
use std::{path::PathBuf,sync::mpsc};
#[cfg(target_os="windows")]
use tauri::Manager;

#[derive(Deserialize)]
pub struct Translation { font:String,pages:Vec<crate::engine::TranslationPage> }
#[derive(Deserialize)]
pub struct Request { pub current_page:usize,translation:Option<Translation> }

#[tauri::command]
pub async fn print_document(app:tauri::AppHandle,request:Request,state:tauri::State<'_,crate::Worker>)->Result<bool,String> {
    let _guard=crate::updater::begin_work(&app)?;
    let sender=state.0.clone();
    tauri::async_runtime::spawn_blocking(move||{
        // 저장 경로와 미저장 편집 상태를 바꾸지 않는 인쇄 전용 사본을 유지합니다.
        let temporary=temporary_pdf()?;
        let path=temporary.to_path_buf();
        let snapshot=match request.translation {
            Some(value)=>crate::engine::Request::SaveTranslation {path:path.to_string_lossy().into(),font:value.font,pages:value.pages},
            None=>crate::engine::Request::PrintSnapshot {path:path.to_string_lossy().into()},
        };
        let (tx,rx)=mpsc::channel();
        sender.send(crate::Job::Pdf(snapshot,tx)).map_err(|_|"PDF 작업기가 종료되었습니다.".to_string())?;
        rx.recv().map_err(|_|"인쇄 사본 응답을 받지 못했습니다.".to_string())??;
        platform_print(app,sender,path,request.current_page)
    }).await.map_err(|e|e.to_string())?
}

fn temporary_pdf()->Result<tempfile::TempPath,String>{
    // Windows에서 완성된 PDF로 교체할 수 있도록 핸들은 닫고, 인쇄가 끝날 때까지 경로만 유지합니다.
    Ok(tempfile::Builder::new().prefix("dalpdf-print-").suffix(".pdf").tempfile().map_err(|e|e.to_string())?.into_temp_path())
}

#[cfg(target_os="macos")]
fn platform_print(app:tauri::AppHandle,_sender:mpsc::Sender<crate::Job>,path:PathBuf,_current:usize)->Result<bool,String>{
    let (tx,rx)=mpsc::channel();
    app.run_on_main_thread(move||{let _=tx.send(crate::printing_macos::print(&path));}).map_err(|e|e.to_string())?;
    rx.recv().map_err(|_|"인쇄 창 응답을 받지 못했습니다.".to_string())?
}
#[cfg(target_os="windows")]
fn platform_print(app:tauri::AppHandle,sender:mpsc::Sender<crate::Job>,path:PathBuf,current:usize)->Result<bool,String>{
    let (tx,rx)=mpsc::channel();
    sender.send(crate::Job::PrintInfo(path.clone(),tx)).map_err(|_|"PDF 작업기가 종료되었습니다.".to_string())?;
    let info=rx.recv().map_err(|_|"인쇄 페이지 정보를 받지 못했습니다.".to_string())??;
    let total=info.as_u64().ok_or("인쇄 페이지 수가 올바르지 않습니다.")? as usize;
    let window=app.get_webview_window("main").ok_or("문서 창을 찾지 못했습니다.")?;
    let owner=window.hwnd().map_err(|e|e.to_string())?.0 as usize;
    let (tx,rx)=mpsc::channel();
    app.run_on_main_thread(move||{let _=tx.send(crate::printing_windows::dialog(owner,total,current));}).map_err(|e|e.to_string())?;
    let Some(settings)=rx.recv().map_err(|_|"인쇄 창 응답을 받지 못했습니다.".to_string())?? else {return Ok(false);};
    let (tx,rx)=mpsc::channel();
    sender.send(crate::Job::Print(path,settings,tx)).map_err(|_|"PDF 작업기가 종료되었습니다.".to_string())?;
    rx.recv().map_err(|_|"인쇄 응답을 받지 못했습니다.".to_string())??;
    Ok(true)
}
#[cfg(not(any(target_os="macos",target_os="windows")))]
fn platform_print(_app:tauri::AppHandle,_sender:mpsc::Sender<crate::Job>,_path:PathBuf,_current:usize)->Result<bool,String>{Err("지원하지 않는 운영체제입니다.".into())}

#[cfg(any(target_os="windows",test))]
pub fn selected_pages(total:usize,current:usize,ranges:Option<&[(usize,usize)]>,current_only:bool)->Result<Vec<usize>,String>{
    if total==0 {return Err("인쇄할 페이지가 없습니다.".into());}
    if current_only {return if current<total {Ok(vec![current])} else {Err("현재 페이지가 올바르지 않습니다.".into())};}
    let Some(ranges)=ranges else {return Ok((0..total).collect());};
    let mut pages=Vec::new();
    for &(first,last) in ranges {
        if first==0 || last<first || last>total {return Err("인쇄 페이지 범위가 올바르지 않습니다.".into());}
        for page in first-1..last {if !pages.contains(&page){pages.push(page);}}
    }
    if pages.is_empty(){return Err("인쇄할 페이지를 선택해 주세요.".into());}Ok(pages)
}

#[cfg(any(target_os="windows",test))]
pub struct Placement {pub x:i32,pub y:i32,pub width:i32,pub height:i32,pub raster_width:i32,pub raster_height:i32,pub rotate:bool}
#[cfg(any(target_os="windows",test))]
pub fn placement(page:(f64,f64),area:(i32,i32),dpi:(i32,i32))->Result<Placement,String>{
    if !page.0.is_finite()||!page.1.is_finite()||page.0<=0.||page.1<=0.||area.0<=0||area.1<=0||dpi.0<=0||dpi.1<=0 {return Err("프린터 용지 크기를 확인하지 못했습니다.".into());}
    let inches=(f64::from(area.0)/f64::from(dpi.0),f64::from(area.1)/f64::from(dpi.1));
    let normal=(inches.0/page.0).min(inches.1/page.1);let rotated=(inches.0/page.1).min(inches.1/page.0);
    let rotate=rotated>normal;let (w,h,scale)=if rotate {(page.1,page.0,rotated)} else {(page.0,page.1,normal)};
    let width=(w*scale*f64::from(dpi.0)).round().clamp(1.,f64::from(area.0)) as i32;
    let height=(h*scale*f64::from(dpi.1)).round().clamp(1.,f64::from(area.1)) as i32;
    // 한 페이지씩 300dpi로 처리하며 큰 용지는 1,600만 픽셀 이내로 제한합니다.
    let rw=f64::from(width)/f64::from(dpi.0)*300.;let rh=f64::from(height)/f64::from(dpi.1)*300.;
    let reduce=(16_000_000./(rw*rh)).sqrt().min(1.);
    Ok(Placement{x:(area.0-width)/2,y:(area.1-height)/2,width,height,raster_width:(rw*reduce).round().max(1.) as i32,raster_height:(rh*reduce).round().max(1.) as i32,rotate})
}

#[cfg(any(target_os="windows",test))]
pub fn raster(page:&pdfium_render::prelude::PdfPage,position:&Placement)->Result<Vec<u8>,String>{
    use pdfium_render::prelude::*;
    // GDI의 32비트 DIB는 BGRA 순서입니다. PDFium 기본 RGBA 변환을 사용하지 않습니다.
    let bitmap=page.render_with_config(&PdfRenderConfig::new().set_fixed_size(position.raster_width,position.raster_height)
        .rotate(if position.rotate{PdfPageRenderRotation::Degrees90}else{PdfPageRenderRotation::None},false)
        .set_format(PdfBitmapFormat::BGRA).set_reverse_byte_order(false).set_clear_color(PdfColor::WHITE)
        .use_print_quality(true).render_annotations(true).render_form_data(true)).map_err(|e|e.to_string())?;
    let bytes=bitmap.as_raw_bytes();
    if bytes.len()!=position.raster_width as usize*position.raster_height as usize*4{return Err("인쇄 이미지 크기가 올바르지 않습니다.".into());}
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn print_temporary_pdf_supports_atomic_original_and_translation_save(){
        use crate::engine::{self,Request,TranslationPage,TranslationLine};
        let pdfium=engine::test_pdfium();
        let directory=tempfile::tempdir().unwrap();
        let source=directory.path().join("source.pdf");
        std::fs::copy(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../tests/assistant-before.pdf"),&source).unwrap();
        let original=std::fs::read(&source).unwrap();
        let mut session=None;
        engine::handle(&pdfium,&mut session,Request::Open{path:source.to_string_lossy().into(),password:None}).unwrap();
        engine::handle(&pdfium,&mut session,Request::AddNote{page:0,x:0.2,y:0.2,text:"인쇄 메모".into()}).unwrap();
        let before=engine::handle(&pdfium,&mut session,Request::Info).unwrap();
        #[cfg(target_os="windows")]
        {
            // 수정 전처럼 대상 파일을 열어 두면 실제 Windows에서 교체가 거부됩니다.
            let locked=tempfile::NamedTempFile::new().unwrap();
            let error=engine::handle(&pdfium,&mut session,Request::PrintSnapshot{path:locked.path().to_string_lossy().into()}).unwrap_err();
            assert!(error.contains("failed to persist temporary file")&&error.contains("os error 5"),"{error}");
        }
        for translated in [false,true]{
            let temporary=temporary_pdf().unwrap();let path=temporary.to_path_buf();
            let request=if translated {Request::SaveTranslation{path:path.to_string_lossy().into(),font:"gothic".into(),pages:vec![TranslationPage{
                page:0,whole_page:true,masks:vec![],lines:vec![TranslationLine{text:"인쇄 번역문".into(),x:55.,y:100.,width:300.,size:16.,color:[0,0,0]}],
            }]}} else {Request::PrintSnapshot{path:path.to_string_lossy().into()}};
            engine::handle(&pdfium,&mut session,request).unwrap();
            {
                let saved=pdfium.load_pdf_from_file(&path,None).unwrap();
                assert_eq!(saved.pages().len(),session.as_ref().unwrap().doc.pages().len());
                if translated {assert!(saved.pages().get(0).unwrap().text().unwrap().all().contains("인쇄 번역문"));}
            }
            assert_eq!(engine::handle(&pdfium,&mut session,Request::Info).unwrap(),before);
            drop(temporary);assert!(!path.exists());
        }
        let temporary=temporary_pdf().unwrap();let path=temporary.to_path_buf();
        let mut empty=None;
        assert!(engine::handle(&pdfium,&mut empty,Request::PrintSnapshot{path:path.to_string_lossy().into()}).is_err());
        drop(temporary);assert!(!path.exists());
        assert_eq!(std::fs::read(source).unwrap(),original);
    }
    #[test]
    fn page_selection_matches_all_current_and_multiple_ranges(){
        assert_eq!(selected_pages(8,3,None,false).unwrap(),(0..8).collect::<Vec<_>>());
        assert_eq!(selected_pages(8,3,None,true).unwrap(),vec![3]);
        assert_eq!(selected_pages(8,0,Some(&[(2,4),(4,5),(8,8)]),false).unwrap(),vec![1,2,3,4,7]);
        assert!(selected_pages(8,0,Some(&[(0,3)]),false).is_err());assert!(selected_pages(8,0,Some(&[(9,9)]),false).is_err());
    }
    #[test]
    fn print_fit_centers_rotated_pages_and_limits_memory(){
        let p=placement((842.,595.),(2400,3300),(300,300)).unwrap();assert!(p.rotate);assert!(p.width<=2400&&p.height<=3300&&p.x>=0&&p.y>=0);
        let p=placement((595.,842.),(30000,40000),(600,600)).unwrap();assert!(!p.rotate);assert!(i64::from(p.raster_width)*i64::from(p.raster_height)<=16_010_000);
        assert!(placement((0.,842.),(2400,3300),(300,300)).is_err());
    }
    #[test]
    fn printer_raster_preserves_bgra_colors_and_rotated_dimensions(){
        use pdfium_render::prelude::*;
        let pdfium=crate::engine::test_pdfium();let mut document=pdfium.create_new_pdf().unwrap();
        let mut page=document.pages_mut().create_page_at_end(PdfPagePaperSize::Custom(PdfPoints::new(100.),PdfPoints::new(60.))).unwrap();
        page.objects_mut().add_path_object(PdfPagePathObject::new_rect(&document,PdfRect::new_from_values(0.,0.,60.,50.),None,None,Some(PdfColor::new(255,0,0,255))).unwrap()).unwrap();
        for area in [(100,60),(60,100)]{
            let position=placement((100.,60.),area,(72,72)).unwrap();let bytes=raster(&page,&position).unwrap();
            let red=bytes.as_chunks::<4>().0.iter().filter(|p|p[0]<10&&p[1]<10&&p[2]>245).count();
            let fraction=red as f64/(bytes.len()/4) as f64;assert!((0.45..0.55).contains(&fraction));
            assert_eq!(position.rotate,area.0<area.1);
        }
    }
}
