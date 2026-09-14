use std::{path::Path, process::{Command, Stdio}, time::{Duration, Instant}};

#[derive(Clone, Debug, PartialEq)]
pub struct Device {
    pub id: String,
    pub name: String,
    pub free_mib: u64,
}

// 고정 버전 llama.cpp의 --list-devices 출력에서 실제 Vulkan 장치만 읽습니다.
fn devices(output: &str) -> Vec<Device> {
    output.lines().filter_map(|line| {
        let (id, details) = line.trim().split_once(": ")?;
        let number = id.strip_prefix("Vulkan")?;
        if number.is_empty() || !number.bytes().all(|c| c.is_ascii_digit()) { return None; }
        let (name, memory) = details.rsplit_once(" (")?;
        let (_, free) = memory.split_once(" MiB, ")?;
        Some(Device { id:id.into(), name:name.into(), free_mib:free.strip_suffix(" MiB free)")?.parse().ok()? })
    }).collect()
}

pub fn command(path: &Path) -> Command {
    let mut command = Command::new(path);
    command.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

pub fn detect(base: &Path) -> Result<Device, String> {
    let mut child = command(&base.join("translation/windows-vulkan/llama-server.exe"))
        .args(["--list-devices", "--offline"]).stdout(Stdio::piped()).spawn()
        .map_err(|_| "GPU 엔진을 실행하지 못했습니다. 그래픽 드라이버와 설치 파일을 확인하거나 CPU를 선택해 주세요.".to_string())?;
    let started = Instant::now();
    // 드라이버 검사에서 멈춰도 설정 화면이 무한 대기하지 않도록 제한합니다.
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < Duration::from_secs(15) => std::thread::sleep(Duration::from_millis(100)),
            _ => { let _ = child.kill(); let _ = child.wait(); return Err("GPU 확인을 완료하지 못했습니다. 그래픽 드라이버를 확인하거나 CPU를 선택해 주세요.".into()); }
        }
    }
    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err("GPU 엔진이 장치를 확인하지 못했습니다. 그래픽 드라이버를 확인하거나 CPU를 선택해 주세요.".into()); }
    devices(&String::from_utf8_lossy(&output.stdout)).into_iter().max_by_key(|d| d.free_mib)
        .ok_or_else(|| "호환 GPU를 찾지 못했습니다. 최신 Vulkan 지원 그래픽 드라이버를 설치하거나 CPU를 선택해 주세요.".into())
}

pub fn engine(windows: bool, gpu: bool) -> &'static str {
    if !windows { "translation/mac/llama-b10809/llama-server" }
    else if gpu { "translation/windows-vulkan/llama-server.exe" }
    else { "translation/windows/llama-server.exe" }
}

pub fn args(windows: bool, device: Option<&Device>) -> Vec<String> {
    if !windows { return vec![]; }
    if let Some(device) = device {
        // GPU 모드가 CPU 실행으로 조용히 바뀌지 않도록 전체 레이어를 명시합니다.
        ["--device", &device.id, "--gpu-layers", "all", "--fit", "off", "--split-mode", "none"].into_iter().map(String::from).collect()
    } else { ["--device", "none", "--gpu-layers", "0"].into_iter().map(String::from).collect() }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn vulkan_devices_and_engine_arguments() {
        let found = devices("ggml_vulkan: Found 2 devices\nAvailable devices:\n  Vulkan0: Intel Graphics (2048 MiB, 1024 MiB free)\n  Vulkan1: NVIDIA GeForce RTX (16384 MiB, 14000 MiB free)\n  CPU: CPU (32000 MiB, 12000 MiB free)\n  Vulkanbad: invalid (2 MiB, 1 MiB free)");
        assert_eq!(found.len(), 2);
        let best = found.iter().max_by_key(|d| d.free_mib).unwrap();
        assert_eq!(best.id, "Vulkan1");
        assert!(devices("Available devices:\n  (none)").is_empty());
        assert_eq!(args(true, Some(best)), ["--device", "Vulkan1", "--gpu-layers", "all", "--fit", "off", "--split-mode", "none"]);
        assert_eq!(args(true, None), ["--device", "none", "--gpu-layers", "0"]);
        assert!(args(false, None).is_empty());
        assert!(engine(true, true).contains("windows-vulkan"));
        assert!(engine(true, false).contains("windows/"));
        assert!(engine(false, false).contains("mac/"));
    }
}
