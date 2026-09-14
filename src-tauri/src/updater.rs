use serde::Serialize;
use std::{sync::{Arc, Mutex}, time::Duration};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

#[derive(Default)]
struct Activity { jobs: usize, installing: bool }
#[derive(Default)]
pub struct Gate(Arc<Mutex<Activity>>);
pub struct Guard { state: Arc<Mutex<Activity>>, installing: bool }
impl Gate {
    fn enter(&self, installing: bool) -> Result<Guard, String> {
        let mut state=self.0.lock().map_err(|e|e.to_string())?;
        if state.installing || installing && state.jobs>0 { return Err("진행 중인 작업을 마친 뒤 다시 시도해 주세요.".into()); }
        if installing {state.installing=true;} else {state.jobs+=1;}
        Ok(Guard{state:self.0.clone(),installing})
    }
}
impl Drop for Guard {
    fn drop(&mut self) {
        if let Ok(mut state)=self.state.lock(){if self.installing {state.installing=false;} else {state.jobs-=1;}}
    }
}
pub fn begin_work(app:&tauri::AppHandle)->Result<Guard,String>{app.state::<Gate>().enter(false)}

#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);
#[derive(Serialize)]
pub struct AvailableUpdate { version:String, notes:String }

#[tauri::command]
pub async fn check_update(app:tauri::AppHandle)->Result<Option<AvailableUpdate>,String>{
    let update=app.updater_builder().timeout(Duration::from_secs(20)).build().map_err(|e|e.to_string())?
        .check().await.map_err(|e|e.to_string())?;
    let info=update.as_ref().map(|u|AvailableUpdate{version:u.version.clone(),notes:u.body.clone().unwrap_or_default()});
    *app.state::<PendingUpdate>().0.lock().map_err(|e|e.to_string())?=update;
    Ok(info)
}

#[tauri::command]
pub async fn install_update(app:tauri::AppHandle,version:String)->Result<(),String>{
    // 사용자가 확인한 버전만 설치하며 PDF/AI 작업과 설치를 겹치지 않습니다.
    let _guard=app.state::<Gate>().enter(true)?;
    let mut update=app.state::<PendingUpdate>().0.lock().map_err(|e|e.to_string())?.as_ref()
        .filter(|u|u.version==version).cloned().ok_or("업데이트 정보를 다시 확인해 주세요.")?;
    app.state::<crate::translation::Translator>().stop();
    update.timeout=Some(Duration::from_secs(1800));
    let mut downloaded=0_u64;
    let bytes=update.download(|chunk,total|{downloaded+=chunk as u64;let _=app.emit("update-progress",(downloaded,total));},||{})
        .await.map_err(|e|e.to_string())?;
    let _=app.emit("update-installing",());
    tauri::async_runtime::spawn_blocking(move||update.install(bytes)).await.map_err(|e|e.to_string())?.map_err(|e|e.to_string())?;
    app.restart();
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn update_excludes_active_work_and_releases_after_failure(){
        let gate=Gate::default();let work=gate.enter(false).unwrap();
        assert!(gate.enter(true).is_err());drop(work);
        let install=gate.enter(true).unwrap();
        assert!(gate.enter(false).is_err());assert!(gate.enter(true).is_err());drop(install);
        assert!(gate.enter(false).is_ok());assert!(gate.enter(true).is_ok());
    }
}
