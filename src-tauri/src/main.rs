#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod engine;
mod acceleration;
mod translation;
mod updater;
use std::sync::{mpsc, Mutex};
#[cfg(target_os = "macos")]
use tauri::Emitter;
use tauri::Manager;
type Reply = std::result::Result<serde_json::Value, String>;
struct Job(engine::Request, mpsc::Sender<Reply>);
struct Worker(mpsc::Sender<Job>);
struct PendingFile(Mutex<Option<String>>);
#[tauri::command]
fn pending_file(state: tauri::State<'_, PendingFile>) -> Option<String> {
    state.0.lock().ok()?.take()
}
#[tauri::command]
async fn pdf(app:tauri::AppHandle, request: engine::Request, state: tauri::State<'_, Worker>) -> Reply {
    let _guard=updater::begin_work(&app)?;
    let sender = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (tx, rx) = mpsc::channel();
        sender
            .send(Job(request, tx))
            .map_err(|_| "PDF 작업기가 종료되었습니다.".to_string())?;
        rx.recv()
            .map_err(|_| "PDF 응답을 받지 못했습니다.".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::Gate::default())
        .manage(updater::PendingUpdate::default())
        .setup(|app| {
            let base = if cfg!(debug_assertions) {
                std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            } else {
                app.path().resource_dir()?
            };
            let translator = translation::Translator::new(base.clone());
            if cfg!(target_os = "windows") {
                let gpu = std::fs::read(app.path().app_config_dir()?.join("gpu-acceleration.json")).ok()
                    .and_then(|bytes| serde_json::from_slice::<bool>(&bytes).ok()).unwrap_or(false);
                translator.gpu.store(gpu, std::sync::atomic::Ordering::SeqCst);
            }
            app.manage(translator);
            let (tx, rx) = mpsc::channel::<Job>();
            std::thread::Builder::new()
                .name("dalpdf-engine".into())
                .spawn(move || {
                    let engine = engine::bind(&engine::library_path(&base));
                    let mut session = None;
                    for Job(request, reply) in rx {
                        let result = match &engine {
                            Ok(pdfium) => engine::handle(pdfium, &mut session, request),
                            Err(e) => Err(format!("PDF 엔진을 불러오지 못했습니다: {e}")),
                        };
                        let _ = reply.send(result);
                    }
                })?;
            app.manage(Worker(tx));
            app.manage(PendingFile(Mutex::new(
                std::env::args()
                    .skip(1)
                    .find(|p| p.to_lowercase().ends_with(".pdf")),
            )));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            pdf,
            pending_file,
            updater::check_update,
            updater::install_update,
            translation::translate,
            translation::assist,
            translation::get_acceleration,
            translation::set_acceleration,
            translation::cancel_translation
        ])
        .build(tauri::generate_context!())
        .expect("DalPDF 실행 실패")
        .run(|_app, _event| {
            if matches!(_event, tauri::RunEvent::Exit) {
                _app.state::<translation::Translator>().stop();
            }
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                if let Some(path) = urls.first().and_then(|url| url.to_file_path().ok()) {
                    if let Ok(mut pending) = _app.state::<PendingFile>().0.lock() {
                        *pending = Some(path.to_string_lossy().into_owned());
                    }
                    let _ = _app.emit("open-document", ());
                }
            }
        });
}
