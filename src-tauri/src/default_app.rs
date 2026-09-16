#[tauri::command]
pub fn is_default_pdf_app() -> Result<bool, String> { platform::is_default() }

#[tauri::command]
pub fn set_default_pdf_app() -> Result<bool, String> {
    // 이 명령은 기본 앱 지정 확인창의 동의 버튼에서만 호출합니다.
    platform::set_default()?;
    let selected = platform::is_default()?;
    #[cfg(target_os = "macos")]
    if !selected { return Err("기본 PDF 앱 설정을 확인하지 못했습니다. 다시 시도해 주세요.".into()); }
    Ok(selected)
}

#[cfg(target_os = "macos")]
mod platform {
    use std::ffi::{c_char, c_void};
    type CFString = *const c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    unsafe extern "C" {
        fn CFStringCreateWithCString(allocator: *const c_void, text: *const c_char, encoding: u32) -> CFString;
        fn CFEqual(left: CFString, right: CFString) -> u8;
        fn CFRelease(value: CFString);
    }
    #[link(name = "CoreServices", kind = "framework")]
    unsafe extern "C" {
        fn LSCopyDefaultRoleHandlerForContentType(content_type: CFString, roles: u32) -> CFString;
        fn LSSetDefaultRoleHandlerForContentType(content_type: CFString, roles: u32, handler: CFString) -> i32;
    }
    fn with_identifiers<T>(action: impl FnOnce(CFString, CFString) -> T) -> T {
        unsafe {
            let pdf = CFStringCreateWithCString(std::ptr::null(), c"com.adobe.pdf".as_ptr(), 0x08000100);
            let app = CFStringCreateWithCString(std::ptr::null(), c"com.dalbear.dalpdf".as_ptr(), 0x08000100);
            let result = action(pdf, app);
            CFRelease(app); CFRelease(pdf);
            result
        }
    }
    pub fn is_default() -> Result<bool, String> {
        Ok(with_identifiers(|pdf, app| unsafe {
            let current = LSCopyDefaultRoleHandlerForContentType(pdf, u32::MAX);
            if current.is_null() { return false; }
            let matches = CFEqual(current, app) != 0;
            CFRelease(current);
            matches
        }))
    }
    pub fn set_default() -> Result<(), String> {
        let status = with_identifiers(|pdf, app| unsafe { LSSetDefaultRoleHandlerForContentType(pdf, u32::MAX, app) });
        if status == 0 { Ok(()) } else { Err(format!("기본 PDF 앱을 설정하지 못했습니다. macOS 오류 {status}")) }
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::{ffi::c_void, path::Path};
    #[link(name = "shlwapi")]
    unsafe extern "system" {
        fn AssocQueryStringW(flags: u32, kind: u32, association: *const u16, extra: *const u16, output: *mut u16, length: *mut u32) -> i32;
    }
    #[link(name = "shell32")]
    unsafe extern "system" {
        fn ShellExecuteW(window: *mut c_void, operation: *const u16, file: *const u16, parameters: *const u16, directory: *const u16, show: i32) -> isize;
    }
    fn wide(value: &str) -> Vec<u16> { value.encode_utf16().chain([0]).collect() }
    pub fn is_default() -> Result<bool, String> {
        let extension = wide(".pdf"); let verb = wide("open"); let mut length = 0;
        unsafe {
            // UserChoice를 포함한 실제 연결 앱을 조회하며 레지스트리 기본값으로 추측하지 않습니다.
            let status = AssocQueryStringW(0, 2, extension.as_ptr(), verb.as_ptr(), std::ptr::null_mut(), &mut length);
            if status as u32 == 0x80070483 || status as u32 == 0x80070002 { return Ok(false); }
            if length == 0 { return Err(format!("기본 PDF 앱 조회 실패: {status:#x}")); }
            let mut executable = vec![0_u16; length as usize];
            let status = AssocQueryStringW(0, 2, extension.as_ptr(), verb.as_ptr(), executable.as_mut_ptr(), &mut length);
            if status != 0 { return Err(format!("기본 PDF 앱 조회 실패: {status:#x}")); }
            let end = executable.iter().position(|c| *c == 0).unwrap_or(executable.len());
            let handler = String::from_utf16_lossy(&executable[..end]);
            let current = std::env::current_exe().map_err(|e| e.to_string())?;
            let normalize = |path: &Path| path.canonicalize().unwrap_or_else(|_| path.to_path_buf()).to_string_lossy().to_lowercase();
            Ok(normalize(Path::new(&handler)) == normalize(&current))
        }
    }
    pub fn set_default() -> Result<(), String> {
        // Windows 10/11에서는 보호된 UserChoice를 변경하지 않고 사용자가 설정 화면에서 선택합니다.
        let uri = wide("ms-settings:defaultapps?registeredAppUser=DalPDF");
        let operation = wide("open");
        let result = unsafe { ShellExecuteW(std::ptr::null_mut(), operation.as_ptr(), uri.as_ptr(), std::ptr::null(), std::ptr::null(), 1) };
        if result > 32 { Ok(()) } else { Err(format!("Windows 기본 앱 설정을 열지 못했습니다. 오류 {result}")) }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    pub fn is_default() -> Result<bool, String> { Err("지원하지 않는 운영체제입니다.".into()) }
    pub fn set_default() -> Result<(), String> { Err("지원하지 않는 운영체제입니다.".into()) }
}

#[cfg(test)]
mod tests {
    #[test]
    #[ignore = "사용자 설정을 바꾸지 않고 현재 운영체제의 PDF 연결만 조회합니다."]
    fn reads_current_pdf_handler() { assert!(super::is_default_pdf_app().is_ok()); }
}
