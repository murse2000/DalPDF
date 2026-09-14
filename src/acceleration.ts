import {invoke} from '@tauri-apps/api/core';

type Status={windows:boolean;gpu:boolean;busy:boolean;active:string|null};

export function accelerationPanel(panel:HTMLElement){
 const section=document.createElement('details');
 section.innerHTML='<summary>AI 가속</summary><label hidden>번역 처리 장치<select aria-label="번역 처리 장치"><option value="cpu">CPU · 기본</option><option value="gpu">GPU · 빠른 번역</option></select></label><p role="status" class="hint">가속 설정 확인 중…</p>';
 panel.querySelector('.inspector-head')!.after(section);
 const label=section.querySelector('label')!,select=section.querySelector('select')!,status=section.querySelector('p')!;
 let changing=false,reading=false,last:Status|null=null,error='';
 function render(value:Status){
  last=value;label.hidden=!value.windows;select.value=value.gpu?'gpu':'cpu';select.disabled=changing||value.busy;
  status.textContent=error||(changing?'GPU와 설정을 확인하는 중…':value.active?`${value.active} · 모델 준비 완료`:value.windows?`${value.gpu?'GPU':'CPU'} 선택됨 · 다음 AI 작업에 적용`:'Mac · Metal 가속 사용');
 }
 async function refresh(){
  if(reading||changing)return;reading=true;
  try{const value=await invoke<Status>('get_acceleration');if(!changing)render(value);}catch(e){status.textContent=String(e);}finally{reading=false;}
 }
 select.onchange=async()=>{
  const gpu=select.value==='gpu';changing=true;error='';if(last)render(last);
  try{render(await invoke<Status>('set_acceleration',{gpu}));}
  catch(e){error=String(e);}
  finally{changing=false;await refresh();}
 };
 section.ontoggle=()=>{if(section.open)void refresh();};
 // 패널이 보이는 동안만 준비 완료 상태와 작업 중 잠금을 갱신합니다.
 window.setInterval(()=>{if(section.open&&!panel.hidden&&!document.hidden)void refresh();},1500);
 void refresh();
}
