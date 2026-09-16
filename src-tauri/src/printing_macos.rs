use objc2::{rc::autoreleasepool, AnyThread, MainThreadMarker};
use objc2_app_kit::NSPrintInfo;
use objc2_foundation::{NSCopying, NSURL};
use objc2_pdf_kit::{PDFDocument, PDFPrintScalingMode};
use std::path::Path;

pub fn print(path: &Path) -> Result<bool, String> {
    let main_thread = MainThreadMarker::new()
        .ok_or("인쇄 대화상자는 앱의 메인 스레드에서 열어야 합니다.")?;
    // 시스템 대화상자가 끝날 때까지 문서와 인쇄 작업의 소유권을 유지합니다.
    objc2::exception::catch(|| autoreleasepool(|_| unsafe {
        let url = NSURL::from_path(path, false, None)
            .ok_or("인쇄할 PDF 경로를 읽지 못했습니다.")?;
        let document = PDFDocument::initWithURL(PDFDocument::alloc(), &url)
            .ok_or("인쇄할 PDF를 열지 못했습니다.")?;
        if !document.allowsPrinting() {
            return Err("이 PDF는 인쇄가 허용되지 않습니다.".to_string());
        }
        if document.pageCount() == 0 {
            return Err("인쇄할 페이지가 없습니다.".to_string());
        }
        let info = NSPrintInfo::sharedPrintInfo().copy();
        let operation = document.printOperationForPrintInfo_scalingMode_autoRotate(
            Some(&info), PDFPrintScalingMode::PageScaleDownToFit, true, main_thread,
        ).ok_or("macOS 인쇄 작업을 만들지 못했습니다.")?;
        operation.setShowsPrintPanel(true);
        operation.setShowsProgressPanel(true);
        Ok(operation.runOperation())
    })).map_err(|_| "macOS 인쇄 대화상자를 처리하지 못했습니다.".to_string())?
}

#[cfg(test)]
mod tests {
    #[test]
    fn rejects_background_thread_without_opening_print_dialog() {
        let result = std::thread::spawn(|| super::print(std::path::Path::new("unused.pdf"))).join().unwrap();
        assert!(result.unwrap_err().contains("메인 스레드"));
    }
}
