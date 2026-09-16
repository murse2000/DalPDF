// 화면의 오른쪽·아래쪽 이동량을 회전 전 PDF 좌표계로 변환합니다.
export function imageDragPosition(x:number,y:number,dx:number,dy:number,rotation:string){
 switch(rotation){
  case 'Degrees90':return {x:x+dy,y:y+dx};
  case 'Degrees180':return {x:x-dx,y:y+dy};
  case 'Degrees270':return {x:x-dy,y:y-dx};
  default:return {x:x+dx,y:y-dy};
 }
}
export function bindImageDrag(button:HTMLElement,page:HTMLElement,start:()=>boolean,commit:(dx:number,dy:number)=>void){
 let drag:{id:number;x:number;y:number;clientX:number;clientY:number;moved:boolean}|null=null;
 let suppressClick=false;
 button.style.touchAction='none';button.style.cursor='grab';
 const delta=(e:PointerEvent)=>{
  const rect=page.getBoundingClientRect();
  return {x:(e.clientX-rect.left)/rect.width-drag!.x,y:(e.clientY-rect.top)/rect.height-drag!.y,rect};
 };
 const cancel=()=>{drag=null;button.style.transform='';button.style.cursor='grab';};
 button.addEventListener('pointerdown',e=>{
  if(e.button!==0||!e.isPrimary||!start())return;
  const rect=page.getBoundingClientRect();
  drag={id:e.pointerId,x:(e.clientX-rect.left)/rect.width,y:(e.clientY-rect.top)/rect.height,clientX:e.clientX,clientY:e.clientY,moved:false};
  suppressClick=false;button.setPointerCapture(e.pointerId);e.preventDefault();
 });
 button.addEventListener('pointermove',e=>{
  if(!drag||drag.id!==e.pointerId)return;
  if(!drag.moved&&Math.hypot(e.clientX-drag.clientX,e.clientY-drag.clientY)<3)return;
  drag.moved=true;const d=delta(e);button.style.cursor='grabbing';
  button.style.transform=`translate(${d.x*d.rect.width}px,${d.y*d.rect.height}px)`;
 });
 button.addEventListener('pointerup',e=>{
  if(!drag||drag.id!==e.pointerId)return;
  const moved=drag.moved,d=delta(e);suppressClick=moved;
  cancel();button.releasePointerCapture(e.pointerId);
  // 이동이 끝난 시점에만 기록하여 드래그 한 번을 실행 취소 한 번으로 처리합니다.
  if(moved&&(Math.abs(d.x)>1e-9||Math.abs(d.y)>1e-9))commit(d.x,d.y);
 });
 button.addEventListener('pointercancel',cancel);
 button.addEventListener('lostpointercapture',cancel);
 button.addEventListener('click',e=>{if(suppressClick){e.preventDefault();e.stopImmediatePropagation();suppressClick=false;}},true);
}
