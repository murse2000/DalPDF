import {bindImageDrag} from './object-drag';
import type {TextChar} from './text-selection';
type Box=[number,number,number,number];
type Annotation={index:number;kind:'highlight'|'note';text:string;display:Box;boxes:Box[]};
export type AnnotationMode='highlight'|'note'|null;

export function highlightBoxes(chars:TextChar[]):Box[]{
 const boxes:Box[]=[];
 for(const char of chars){
  if(!char.text.trim()||char.box[2]<=0||char.box[3]<=0)continue;
  const [x,y,w,h]=char.box,last=boxes.at(-1);
  // 줄·표의 다른 셀을 하나의 큰 사각형으로 합치지 않습니다.
  if(last&&Math.abs(y-last[1])<Math.min(h,last[3])*.5&&x>=last[0]&&x-(last[0]+last[2])<Math.max(h,last[3])*.6){
   const right=Math.max(last[0]+last[2],x+w),bottom=Math.max(last[1]+last[3],y+h);
   last[1]=Math.min(last[1],y);last[2]=right-last[0];last[3]=bottom-last[1];
  }else boxes.push([...char.box]);
 }
 return boxes;
}

type Host={api:<T>(request:Record<string,unknown>)=>Promise<T>;identity:()=>unknown;editable:()=>boolean;occupied:()=>boolean;enter:(mode:AnnotationMode)=>Promise<void>;mutate:(request:Record<string,unknown>)=>Promise<boolean>;selection:()=>Promise<{page:number;chars:TextChar[]}|null>;toast:(text:string)=>void};
export function annotationTools(host:Host){
 let mode:AnnotationMode=null,identity:unknown;
 const cache=new Map<number,Annotation[]>(),expanded=new Set<string>();
 let addedNotePage:number|null=null;
 const highlight=document.getElementById('highlight') as HTMLButtonElement,note=document.getElementById('add-note') as HTMLButtonElement;
 const dialog=document.createElement('dialog');dialog.className='annotation-dialog';
 dialog.innerHTML='<form><strong class="annotation-title">메모</strong><textarea aria-label="메모 내용" rows="5" maxlength="10000"></textarea><div><button type="button" class="annotation-delete">삭제</button><button type="button" class="annotation-cancel">취소</button><button type="submit" class="primary">저장</button></div></form>';
 document.body.append(dialog);
 const text=dialog.querySelector('textarea')!,remove=dialog.querySelector<HTMLButtonElement>('.annotation-delete')!;
 dialog.querySelector('.annotation-cancel')!.addEventListener('click',()=>dialog.close());
 const reset=()=>{mode=null;highlight.setAttribute('aria-pressed','false');note.setAttribute('aria-pressed','false');};
 async function enter(next:AnnotationMode){await host.enter(next);mode=next;highlight.setAttribute('aria-pressed',String(next==='highlight'));note.setAttribute('aria-pressed',String(next==='note'));}
 function popup(page:number,annotation:Annotation|null,x=0,y=0){
  if(host.occupied()||!host.editable())return;
  const source=host.identity();
  dialog.querySelector('.annotation-title')!.textContent=annotation?.kind==='highlight'?'형광펜 메모':'메모';
  text.value=annotation?.text??'';text.required=annotation?.kind!=='highlight';remove.hidden=!annotation;
  const commit=async(request:Record<string,unknown>)=>{
   if(host.identity()!==source){dialog.close();return;}
   if(request.op==='add_note')addedNotePage=page;
   const buttons=dialog.querySelectorAll<HTMLButtonElement>('button');buttons.forEach(button=>button.disabled=true);
   try{if(await host.mutate(request)){if(request.op==='delete_annotation')expanded.clear();dialog.close();}else addedNotePage=null;}finally{buttons.forEach(button=>button.disabled=false);}
  };
  dialog.querySelector('form')!.onsubmit=e=>{e.preventDefault();void commit(annotation?{op:'edit_annotation',page,index:annotation.index,text:text.value}:{op:'add_note',page,x,y,text:text.value});};
  remove.onclick=()=>{if(annotation)void commit({op:'delete_annotation',page,index:annotation.index});};
  dialog.showModal();text.focus();
 }
 highlight.onmousedown=e=>e.preventDefault();
 highlight.onclick=async()=>{
  if(host.occupied()||!host.editable())return;
  const selected=await host.selection(),boxes=selected?highlightBoxes(selected.chars):[];
  if(selected&&boxes.length){await host.mutate({op:'add_highlight',page:selected.page,boxes,color:[255,225,70]});window.getSelection()?.removeAllRanges();return;}
  await enter(mode==='highlight'?null:'highlight');
  if(mode==='highlight')host.toast('텍스트를 드래그한 뒤 형광펜 버튼을 누르세요.');
 };
 note.onclick=async()=>{if(host.occupied()||!host.editable())return;await enter(mode==='note'?null:'note');if(mode==='note')host.toast('메모를 붙일 문서 위치를 누르세요.');};
 async function layer(page:number,element:HTMLElement,valid:()=>boolean){
  if(identity!==host.identity()){identity=host.identity();cache.clear();}
  const source=identity;
  const items=cache.get(page)??(await host.api<{annotations:Annotation[]}>({op:'annotations',page})).annotations;
  if(source!==host.identity()||!valid())return;
  if(addedNotePage===page){const latest=items.filter(item=>item.kind==='note').at(-1);if(latest)expanded.add(`${page}:${latest.index}`);addedNotePage=null;}
  cache.set(page,items);while(cache.size>12)cache.delete(cache.keys().next().value!);
  const pageElement=element.closest<HTMLElement>('.pdf-page')??element;
  const overlay=document.createElement('div');overlay.className='annotation-layer';
  if(mode==='note'){
   overlay.classList.add('note-placement');overlay.onclick=e=>{if(e.target!==overlay)return;const bounds=pageElement.getBoundingClientRect();popup(page,null,(e.clientX-bounds.left)/bounds.width,(e.clientY-bounds.top)/bounds.height);};
  }
  if(mode!=='highlight')for(const annotation of items){
   if(annotation.kind==='note'){
    const box=annotation.display,card=document.createElement('div');card.className='pdf-note';
    card.style.cssText=`left:clamp(0px,${box[0]*100}%,calc(100% - var(--note-width)));top:clamp(0px,${box[1]*100}%,calc(100% - var(--note-height)))`;
    const header=document.createElement('div');header.className='pdf-note-head';
    const handle=document.createElement('button');handle.className='pdf-note-handle';handle.textContent='메모';handle.title='드래그하여 메모 이동';
    const fold=document.createElement('button');fold.className='pdf-note-fold';fold.textContent='−';fold.title='메모 접기';fold.setAttribute('aria-expanded','true');
    const content=document.createElement('button');content.className='pdf-note-content';content.textContent=annotation.text||'메모 입력';content.title='메모 편집';content.onclick=e=>{e.stopPropagation();popup(page,annotation);};
    const key=`${page}:${annotation.index}`;
    const show=()=>{content.hidden=!expanded.has(key);card.classList.toggle('collapsed',content.hidden);fold.textContent=content.hidden?'+':'−';fold.title=content.hidden?'메모 펼치기':'메모 접기';fold.setAttribute('aria-expanded',String(!content.hidden));};
    const toggle=()=>{if(expanded.has(key))expanded.delete(key);else expanded.add(key);show();};
    fold.onclick=e=>{e.stopPropagation();toggle();};show();
    let origin={x:0,y:0,width:0,height:0};
    bindImageDrag(handle,pageElement,()=>{
     if(host.occupied()||!host.editable()||source!==host.identity())return false;
     const bounds=pageElement.getBoundingClientRect(),position=card.getBoundingClientRect();
     origin={x:(position.left-bounds.left)/bounds.width,y:(position.top-bounds.top)/bounds.height,width:position.width/bounds.width,height:position.height/bounds.height};return true;
    },(dx,dy)=>{if(source!==host.identity())return;void host.mutate({op:'move_annotation',page,index:annotation.index,x:Math.max(0,Math.min(1-origin.width,origin.x+dx)),y:Math.max(0,Math.min(1-origin.height,origin.y+dy))});},card);
    handle.onclick=e=>{e.stopPropagation();if(content.hidden)toggle();};header.append(handle,fold);card.append(header,content);overlay.append(card);
   }else for(const box of annotation.boxes){
    const button=document.createElement('button');button.className='annotation-hit highlight';button.title=annotation.text||'형광펜 메모';button.setAttribute('aria-label',button.title);
    button.style.cssText=`left:${box[0]*100}%;top:${box[1]*100}%;width:${box[2]*100}%;height:${box[3]*100}%`;
    button.onclick=e=>{e.stopPropagation();popup(page,annotation);};overlay.append(button);
   }
  }
  element.append(overlay);
 }
 return {get mode(){return mode;},reset,resetDocument:()=>{reset();expanded.clear();addedNotePage=null;},layer};
}
