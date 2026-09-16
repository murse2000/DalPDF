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

fn lightweight(raw: &serde_json::Value) -> Option<(reqwest::Url, String)> {
    let data = &raw["lightweight"];
    if data["model_sha256"].as_str()? != crate::model_store::MODEL_SHA256.trim() { return None; }
    let platform = if cfg!(target_os="macos") { "darwin-aarch64" } else if cfg!(target_os="windows") { "windows-x86_64" } else { return None; };
    let asset = &data["platforms"][platform];
    let url = reqwest::Url::parse(asset["url"].as_str()?).ok()?;
    if url.scheme() != "https" { return None; }
    let signature = asset["signature"].as_str()?.to_string();
    if signature.is_empty() { return None; }
    Some((url, signature))
}

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
    if let Some((url, signature)) = lightweight(&update.raw_json) {
        let store = app.state::<crate::model_store::Store>();
        let (base, cache) = (store.base.clone(), store.cache.clone());
        // 모델 보존 실패 시 기존 전체 설치 파일로 복구하며 경량 파일은 받지 않습니다.
        let preserved = tauri::async_runtime::spawn_blocking(move ||
            crate::model_store::preserve(&base, &cache, crate::model_store::MODEL_SHA256.trim())
        ).await.map_err(|e| e.to_string())?;
        if preserved.is_ok() { update.download_url = url; update.signature = signature; }
    }
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
    #[cfg(any(target_os="macos", target_os="windows"))]
    fn lightweight_requires_matching_model_and_signed_https_asset(){
        let platform=if cfg!(target_os="macos") {"darwin-aarch64"} else {"windows-x86_64"};
        let mut raw=serde_json::json!({"lightweight":{"model_sha256":crate::model_store::MODEL_SHA256.trim(),"platforms":{platform:{"url":"https://example.com/light","signature":"signed"}}}});
        assert!(lightweight(&raw).is_some());
        raw["lightweight"]["model_sha256"]=serde_json::json!("changed-model");
        assert!(lightweight(&raw).is_none());
        raw["lightweight"]["model_sha256"]=serde_json::json!(crate::model_store::MODEL_SHA256.trim());
        raw["lightweight"]["platforms"][platform]["signature"]=serde_json::json!("");
        assert!(lightweight(&raw).is_none());
        assert!(lightweight(&serde_json::json!({})).is_none());
    }
    #[test]
    fn update_excludes_active_work_and_releases_after_failure(){
        let gate=Gate::default();let work=gate.enter(false).unwrap();
        assert!(gate.enter(true).is_err());drop(work);
        let install=gate.enter(true).unwrap();
        assert!(gate.enter(false).is_err());assert!(gate.enter(true).is_err());drop(install);
        assert!(gate.enter(false).is_ok());assert!(gate.enter(true).is_ok());
    }
    #[test]
    #[ignore="DALPDF_UPDATE_ARTIFACT로 실제 배포 파일을 지정합니다."]
    fn signed_release_accepts_original_and_rejects_tampering(){
        use base64::Engine;
        use minisign_verify::{PublicKey,Signature};
        let config:serde_json::Value=serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let decode=|text:&str|String::from_utf8(base64::engine::general_purpose::STANDARD.decode(text.trim()).unwrap()).unwrap();
        let public=PublicKey::decode(&decode(config["plugins"]["updater"]["pubkey"].as_str().unwrap())).unwrap();
        let path=std::env::var("DALPDF_UPDATE_ARTIFACT").unwrap();
        let signature=Signature::decode(&decode(&std::fs::read_to_string(format!("{path}.sig")).unwrap())).unwrap();
        let mut bytes=std::fs::read(path).unwrap();
        public.verify(&bytes,&signature,true).unwrap();
        bytes[0]^=1;
        assert!(public.verify(&bytes,&signature,true).is_err());
    }
}
