use pdfium_render::prelude::*;
use std::{path::Path,mem::size_of};
use windows_sys::Win32::{Foundation::{GlobalFree,GetLastError},Graphics::Gdi::*,Storage::Xps::*,UI::Controls::Dialogs::*};

// OS 핸들의 소유권을 대화상자 스레드에서 PDF 작업기로 한 번만 이동합니다.
pub struct Settings {dc:usize,mode:usize,names:usize,pages:Vec<usize>,file:bool}
impl Drop for Settings {
    fn drop(&mut self){unsafe{
        if self.dc!=0 {DeleteDC(self.dc as _);}
        if self.mode!=0 {GlobalFree(self.mode as _);}
        if self.names!=0 {GlobalFree(self.names as _);}
    }}
}
fn error(context:&str)->String{format!("{context} (Windows 오류 {})",unsafe{GetLastError()})}
fn wide(text:&str)->Vec<u16>{text.encode_utf16().chain([0]).collect()}

pub fn dialog(owner:usize,total:usize,current:usize)->Result<Option<Settings>,String>{
    if total==0||owner==0{return Err("인쇄할 문서 창을 확인하지 못했습니다.".into());}
    let mut ranges=[PRINTPAGERANGE::default();32];
    let mut options=PRINTDLGEXW {
        lStructSize:size_of::<PRINTDLGEXW>() as u32,hwndOwner:owner as _,
        Flags:PD_RETURNDC|PD_NOSELECTION|PD_USEDEVMODECOPIESANDCOLLATE,
        nMaxPageRanges:ranges.len() as u32,lpPageRanges:ranges.as_mut_ptr(),nMinPage:1,nMaxPage:total as u32,nCopies:1,nStartPage:START_PAGE_GENERAL,
        ..Default::default()
    };
    let result=unsafe{PrintDlgExW(&mut options)};
    let mut settings=Settings {dc:options.hDC as usize,mode:options.hDevMode as usize,names:options.hDevNames as usize,pages:Vec::new(),file:options.Flags&PD_PRINTTOFILE!=0};
    if result<0{return Err(format!("인쇄 창을 열지 못했습니다. HRESULT {result:#x}"));}
    if options.dwResultAction!=PD_RESULT_PRINT{return Ok(None);}
    if settings.dc==0{return Err("선택한 프린터에 연결하지 못했습니다.".into());}
    let selected:Vec<_>=ranges.iter().take(options.nPageRanges as usize).map(|r|(r.nFromPage as usize,r.nToPage as usize)).collect();
    settings.pages=crate::printing::selected_pages(total,current,if options.Flags&PD_PAGENUMS!=0{Some(&selected)}else{None},options.Flags&PD_CURRENTPAGE!=0)?;
    Ok(Some(settings))
}

pub fn inspect(pdfium:&Pdfium,path:&Path)->Result<serde_json::Value,String>{
    let document=pdfium.load_pdf_from_file(path,None).map_err(|e|e.to_string())?;
    Ok(serde_json::json!(document.pages().len()))
}

pub fn print(pdfium:&Pdfium,path:&Path,settings:Settings)->Result<serde_json::Value,String>{
    let document=pdfium.load_pdf_from_file(path,None).map_err(|e|e.to_string())?;
    let dc=settings.dc as HDC;
    let area=unsafe{(GetDeviceCaps(dc,HORZRES as i32),GetDeviceCaps(dc,VERTRES as i32))};
    let dpi=unsafe{(GetDeviceCaps(dc,LOGPIXELSX as i32),GetDeviceCaps(dc,LOGPIXELSY as i32))};
    let name=wide("DalPDF 문서");let output=wide("FILE:");
    let info=DOCINFOW {cbSize:size_of::<DOCINFOW>() as i32,lpszDocName:name.as_ptr(),lpszOutput:if settings.file{output.as_ptr()}else{std::ptr::null()},..Default::default()};
    // PrintDlgEx에서 인쇄를 선택한 경우에만 스풀 작업을 시작합니다. 부수/모아찍기는 반환된 드라이버 DC가 처리합니다.
    if unsafe{StartDocW(dc,&info)}<=0{return Err(error("인쇄 작업을 시작하지 못했습니다."));}
    struct Job(HDC,bool);
    impl Drop for Job{fn drop(&mut self){if !self.1{unsafe{AbortDoc(self.0);}}}}
    let mut job=Job(dc,false);
    for number in &settings.pages {
        let page=document.pages().get(*number as i32).map_err(|e|e.to_string())?;
        let position=crate::printing::placement((f64::from(page.width().value),f64::from(page.height().value)),area,dpi)?;
        let bytes=crate::printing::raster(&page,&position)?;
        let bitmap_info=BITMAPINFO {bmiHeader:BITMAPINFOHEADER {biSize:size_of::<BITMAPINFOHEADER>() as u32,biWidth:position.raster_width,biHeight:-position.raster_height,biPlanes:1,biBitCount:32,biCompression:BI_RGB,..Default::default()},..Default::default()};
        if unsafe{StartPage(dc)}<=0{return Err(error("인쇄 페이지를 시작하지 못했습니다."));}
        unsafe{SetStretchBltMode(dc,HALFTONE);SetBrushOrgEx(dc,0,0,std::ptr::null_mut());}
        let copied=unsafe{StretchDIBits(dc,position.x,position.y,position.width,position.height,0,0,position.raster_width,position.raster_height,bytes.as_ptr().cast(),&bitmap_info,DIB_RGB_COLORS,SRCCOPY)};
        if copied==0||copied==-1{return Err(error("프린터로 페이지를 전송하지 못했습니다."));}
        if unsafe{EndPage(dc)}<=0{return Err(error("인쇄 페이지를 완료하지 못했습니다."));}
    }
    if unsafe{EndDoc(dc)}<=0{return Err(error("인쇄 작업을 완료하지 못했습니다."));}
    job.1=true;
    Ok(serde_json::json!(true))
}
