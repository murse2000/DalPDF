import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open, save, ask, message } from '@tauri-apps/plugin-dialog';
import { createIcons, icons } from 'lucide';
import './style.css';
import {createAssistant} from './assistant';
import {accelerationPanel} from './acceleration';
import {initializeUpdater} from './updater';
import {offerDefaultPdfApp} from './default-app';
import { activePage, wheelZoom, documentLayout } from './geometry';
import { resizePage } from './page-view';
import { bindImageDrag, imageDragPosition } from './object-drag';
import { Thumbnails } from './thumbnails';
import { layoutTranslation, type TranslationLine } from './translation-layout';
import { textOf, translationText, unitRange, paragraphRanges, rangeBox, type TextChar, type PageText } from './text-selection';

type PageSize = { width: number; height: number };
type Doc = { path: string; pages: PageSize[]; undo: boolean; redo: boolean; revision: number; editable: boolean };
type Obj = { display: [number,number,number,number]; index: number; kind: string; text: string | null; font: string | null; x: number; y: number; width: number; height: number; pixels: [number, number] | null };
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const icon = (name: string) => `<i data-lucide="${name}"></i>`;
const tool = (id: string, name: string, label: string, extra = '') => `<button id="${id}" title="${label}" ${extra}>${icon(name)}<span>${label}</span></button>`;
let doc: Doc | null = null, current = 0, zoom = 1, fit = true, editing = false, dirty = false, busy = false, generation = 0;
let selected: Obj | null = null, objects: Obj[] = [], objectPage = -1, objectRotation = 'None';
let offsets: number[] = [], widths: number[] = [], heights: number[] = [];
const mounted = new Map<number, HTMLElement>();
const cache = new Map<string, string>();
let drawing = false, scheduled = false, redraw = false;
let translationOpen=false, translationJob=0, translating=false, activeTranslationJob=0;
let chosenText='', chosenPage=-1, chosenRange:[number,number]=[0,0], translatedView=false;
type TranslationBlock={chars:TextChar[];text:string};
let translationRevision=0,savedTranslationRevision=0;
const translations=new Map<number,{wholePage:boolean;language:string;blocks:TranslationBlock[]}>();
const textCache=new Map<number,PageText>();
const skippedTranslationPages=new Set<number>();
const translationErrors=new Map<number,string>();
const translationFonts:Record<string,string>={gothic:'"DalPDFSans"',serif:'"DalPDFSerif"'};
let translationProgressPrefix='';
let evidence:{page:number;chars:TextChar[]}|null=null;
let translationFont='gothic',translationSize=12,translationAutoSize=true;



$('app').innerHTML = `
<aside id="sidebar" class="sidebar">
 <div class="brand"><img src="/dalpdf-icon.png" alt="DalPDF 아이콘"><div>DalPDF<small>BY DALBEAR</small></div></div>
 ${tool('open', 'folder-open', 'PDF 열기', 'class="primary"')}
 <div class="side-label">작업 공간</div>
 ${tool('read', 'book-open', '문서 읽기', 'class="nav active"')}
 ${tool('edit', 'mouse-pointer-2', '내용 편집', 'class="nav" disabled')}
 <div class="side-label">페이지 도구</div>
 ${tool('split', 'scissors', 'PDF 쪼개기', 'class="nav" disabled')}
 ${tool('merge', 'combine', 'PDF 합치기', 'class="nav" disabled')}
 <div class="side-label">페이지 미리보기</div>
 <div id="page-list" aria-label="원문 페이지 미리보기"></div>

</aside>
<main>
 <header>${tool('sidebar-toggle','panel-left-close','사이드바 숨기기','class="icon-only" aria-expanded="true" aria-controls="sidebar"')}<div class="document-name"><span id="filename"></span><small id="filemeta"></small></div><div class="header-actions">${tool('undo','undo-2','실행 취소','disabled class="icon-only"')}${tool('redo','redo-2','다시 실행','disabled class="icon-only"')}${tool('save','save','다른 이름으로 저장','disabled class="save"')}</div></header>
 <section id="welcome"><div class="eyebrow">A LITTLE BEAR. A BETTER WORKFLOW.</div><h1>문서를 읽고,<br><em>생각을 이어가세요.</em></h1><p>가볍게 펼치고, 필요한 만큼 편집하세요.<br>PDF를 위한 조용하고 편안한 작업 공간.</p><img class="hero" src="/dalpdf-icon.png" alt="달베어 PDF"><button id="welcome-open" class="primary">${icon('plus')} PDF 열기</button><small>또는 PDF 파일을 이곳에 놓아 주세요</small><div class="features"><article>${icon('scroll-text')}<strong>자연스러운 읽기</strong><span>페이지를 이어 보는 연속 스크롤</span></article><article>${icon('text-cursor-input')}<strong>원본 내용 편집</strong><span>텍스트와 이미지 개체 수정</span></article><article>${icon('layers-2')}<strong>간편한 페이지 정리</strong><span>필요한 부분만 쪼개고 합치기</span></article></div></section>
 <div id="toolbar" hidden><form id="search-form">${icon('search')}<input id="search" placeholder="문서에서 찾기" aria-label="문서에서 찾기"><button title="다음 검색 결과">${icon('arrow-down')}</button></form><div class="zoom">${tool('zoom-out','minus','축소','class="icon-only"')}<button id="zoom-value">100%</button>${tool('zoom-in','plus','확대','class="icon-only"')}${tool('fit','scan','너비 맞춤','class="icon-only"')}</div>${tool('translate-panel','languages','번역')}${tool('assistant-panel','sparkles','문서 도우미')}<div id="translation-views" hidden><button id="show-original" aria-pressed="true">원문 보기</button><button id="show-translated" aria-pressed="false">번역문 보기</button></div><span id="mode-label">연속 스크롤</span></div>
 <div id="workspace" hidden><div id="viewport" tabindex="0" aria-label="PDF 문서"><div id="pages"></div></div><aside id="inspector" hidden><div class="inspector-head"><strong>내용 편집</strong>${tool('close-edit','x','편집 닫기','class="icon-only"')}</div><p class="hint">문서의 텍스트나 이미지를 선택하세요.</p>${tool('add-image','image-plus','이미지 추가')}<div id="object-list"></div><div id="properties"></div></aside><aside id="translation" hidden><div class="inspector-head"><strong>기기 내 번역</strong>${tool('close-translation','x','번역 닫기','class="icon-only"')}</div><p class="hint">문서에서 드래그하거나 문장·문단을 눌러 선택하세요.</p><label>선택 단위<select id="selection-unit"><option value="drag">드래그</option><option value="sentence">문장</option><option value="paragraph">문단</option></select></label><label>번역 언어<select id="translation-language"><option>한국어</option><option>English</option><option>日本語</option><option>简体中文</option></select></label>${tool('translate-selected','text-select','선택 내용 번역','disabled')}${tool('explain-selected','sparkles','선택 내용 쉽게 설명','disabled')}${tool('open-glossary','book-a','번역 용어집·교정')}${tool('translate-page','languages','현재 페이지 번역')}${tool('translate-document','files','문서 전체 번역')}${tool('translate-remaining','play','남은 페이지 이어서 번역','hidden')}${tool('save-translation','download','번역 PDF 저장','disabled')}<details id="translation-typography"><summary>번역문 글꼴·크기</summary><label>글꼴<select id="translation-font"><option value="gothic">Noto Sans KR · 고딕체</option><option value="serif">Noto Serif KR · 명조체</option></select></label><label>글자 크기<select id="translation-size-mode"><option value="auto">문단에 자동 맞춤</option><option value="manual">직접 지정</option></select></label><label>크기 (pt)<input id="translation-font-size" type="number" min="6" max="72" step="1" value="12" disabled></label></details><p id="translation-source-label" class="hint">선택한 내용이 없습니다.</p><details><summary>번역 원문</summary><pre id="translation-source"></pre></details><p id="translation-status" role="status"></p><button id="cancel-translation" hidden>번역 취소</button><details id="translation-errors" hidden><summary>번역하지 못한 페이지</summary><pre id="translation-error-list"></pre></details><pre id="translation-result" aria-label="번역 결과"></pre></aside></div>
 <footer id="statusbar"><div class="status-left"><button id="check-update">업데이트 확인</button><span id="status">문서를 열어 시작하세요.</span></div><form id="jump-form" aria-label="페이지 이동"><button id="previous-page" type="button" title="이전 페이지" disabled>${icon('chevron-left')}</button><input id="jump" type="number" min="1" value="1" aria-label="이동할 페이지" disabled><span id="count">/ —</span><button id="next-page" type="button" title="다음 페이지" disabled>${icon('chevron-right')}</button></form><span id="page-status">DalPDF · 0.1.3</span></footer>
</main>
<div id="toast" role="status"></div><div id="busy" hidden><div class="spinner"></div><span id="busy-label">처리 중…</span></div><div id="drop" hidden>${icon('file-plus-2')}PDF를 놓아 주세요</div>
<dialog id="split-dialog"><form method="dialog"><h2>PDF 쪼개기</h2><p>새 PDF로 저장할 페이지를 입력하세요.</p><label>페이지 범위<input id="range" placeholder="예: 1-3, 5, 8-10" required></label><small>입력한 순서대로 추출합니다. 원본은 유지됩니다.</small><div class="dialog-actions"><button value="cancel">취소</button><button id="extract" type="button" class="primary">추출하여 저장</button></div></form></dialog>`;
createIcons({ icons });
accelerationPanel(document.getElementById('translation')!);
const api = <T>(request: Record<string, unknown>): Promise<T> => invoke<T>('pdf', { request });
const thumbnails=new Thumbnails($('page-list'),page=>api<string>({op:'render',page,width:120}),go,()=>!drawing&&!scheduled&&!busy&&!$('app').classList.contains('sidebar-collapsed'));
const assistant=createAssistant({
 api,document:()=>doc,selection:()=>({page:chosenPage,text:chosenText}),
 show:async()=>{if(editing)await mode(false);closeTranslation();layout();go(current);},
 hide:()=>{layout();go(current);},
 select:()=>{translatedView=false;viewControls();void mode(false).then(()=>{translationOpen=true;$('translation').hidden=false;layout();go(current);});},
 evidence:showEvidence,
 external:async(path,page)=>{await pickPDF(path);if(doc?.path===path)go(page);},
 occupied:()=>translating||busy,controls:translationControls,
 blocks:()=>[...translations].flatMap(([page,t])=>t.blocks.map((b,index)=>({page,index,source:textOf(b.chars),text:b.text,language:t.language}))),
 correct:changes=>{if(changes.length)translationRevision++;for(const c of changes){const block=translations.get(c.page)?.blocks[c.index];if(block)block.text=c.after;}setTranslationView(true);$('translation-result').textContent=translations.get(current)?.blocks.map(b=>b.text).join('\n\n')??'';},
 toast,
});
const checkForUpdates=initializeUpdater({isBusy:()=>busy||translating||assistant.running,hasUnsaved:()=>dirty||translationRevision!==savedTranslationRevision,setInstalling:value=>{busy=value;$('app').inert=value;},notify:message=>toast(message)});
$('check-update').onclick=()=>void checkForUpdates(true);
window.setTimeout(()=>void checkForUpdates().then(()=>offerDefaultPdfApp({isBusy:()=>busy||translating||assistant.running,notify:toast})),5000);
window.setInterval(()=>void checkForUpdates(),6*60*60*1000);
$('assistant-panel').onclick=()=>void assistant.show();
$('explain-selected').onmousedown=e=>e.preventDefault();
$('explain-selected').onclick=()=>void assistant.explain();
$('open-glossary').onclick=()=>void assistant.show('glossary');
async function showEvidence(page:number,quote:string){
 const identity=doc;const data=await pageText(page);if(doc!==identity)return;
 let value='';const indices:number[]=[];
 for(const [i,c] of data.chars.entries())for(const char of c.text){
  if(/\s/u.test(char)){if(value.endsWith(' '))continue;value+=' ';}else value+=char;
  for(let n=0;n<char.length;n++)indices.push(i);
 }
 const needle=quote.replace(/\s+/gu,' ').trim(),start=value.indexOf(needle);
 evidence=start<0?null:{page,chars:data.chars.slice(indices[start],indices[start+needle.length-1]+1)};
 translatedView=false;viewControls();layout();go(page);
 if(start<0)toast('해당 페이지로 이동했습니다. 인용문은 도우미 패널에서 확인하세요.');
}
function evidenceLayer(page:number,el:HTMLElement){
 if(evidence?.page!==page||translatedView)return;
 const layer=document.createElement('div');layer.className='evidence-overlay';layer.setAttribute('aria-label','답변 근거 강조');
 for(const c of evidence.chars){if(!c.text.trim())continue;const mark=document.createElement('span');mark.style.cssText=`left:${c.box[0]*100}%;top:${c.box[1]*100}%;width:${c.box[2]*100}%;height:${c.box[3]*100}%`;layer.append(mark);}
 el.append(layer);
}
function toast(text: string) { $('toast').textContent = text; $('toast').classList.add('visible'); window.setTimeout(() => $('toast').classList.remove('visible'), 5000); }
async function task<T>(label: string, work: () => Promise<T>): Promise<T | undefined> {
 if (busy) return;
 busy = true; $('busy').hidden = false; $('busy-label').textContent = label;
 try { return await work(); } catch (e) { toast(String(e)); return undefined; }
 finally { busy = false; $('busy').hidden = true; thumbnails.schedule(); }
}
async function discard() { return !dirty || await ask('저장하지 않은 변경 사항이 있습니다. 변경 사항을 버리고 다른 문서를 열까요?', { title:'DalPDF', kind:'warning' }); }
async function pickPDF(path?: string) {
 if (busy || !await discard()) return;
 const choice = path ?? await open({ filters:[{name:'PDF',extensions:['pdf']}],multiple:false });
 if (typeof choice !== 'string') return;
 await task('PDF를 여는 중…', async () => {
  const result = await api<Doc>({op:'open',path:choice});
  resetTranslation(); doc = result; current = 0; dirty = false; editing = false; selected = null; objectPage = -1; objectRotation = 'None'; cache.clear();
  $('welcome').hidden = true; $('workspace').hidden = false; $('toolbar').hidden = false; $('inspector').hidden = true;
  $('viewport').scrollTop = 0; update(); layout(); await draw();
 });
}
function update() {
 if (!doc) return;
 $('filename').textContent = doc.path.split(/[\\/]/).pop()! + (dirty ? ' •' : '');
 $('filemeta').textContent = `${doc.pages.length.toLocaleString()}페이지 · ${doc.editable ? '원본 개체 편집 가능' : '읽기 전용'}`;
 getCurrentWindow().setTitle(`${dirty ? '• ' : ''}${doc.path.split(/[\\/]/).pop()} — DalPDF`).catch(()=>{});
 for (const id of ['save','split','merge','jump']) ($<HTMLButtonElement>(id)).disabled = false;
 $<HTMLButtonElement>('edit').disabled = !doc.editable;
 $<HTMLButtonElement>('undo').disabled = !doc.undo; $<HTMLButtonElement>('redo').disabled = !doc.redo;
 $('count').textContent = `/ ${doc.pages.length}`; $<HTMLInputElement>('jump').max = String(doc.pages.length);
 $('edit').classList.toggle('active',editing); $('read').classList.toggle('active',!editing);
 $('mode-label').textContent = editing ? '개체 선택 · 원본 편집' : '연속 스크롤';
 $('status').textContent = dirty ? '변경 사항이 있습니다. 저장하면 PDF 원본 개체에 반영됩니다.' : '';
 pageStatus();
}
function pageStatus() {
 if (!doc) return;
 if(document.activeElement!==$('jump'))$<HTMLInputElement>('jump').value=String(current+1);
 $<HTMLButtonElement>('previous-page').disabled=current===0;$<HTMLButtonElement>('next-page').disabled=current===doc.pages.length-1;
 $('page-status').textContent='';
 if(widths[current])$('zoom-value').textContent=`${Math.round(widths[current]/doc.pages[current].width*100)}%`;
 thumbnails.update(doc,current);
}
function layout(preserve=false) {
 if (!doc) return;
 generation++;
 if(!preserve){mounted.clear();$('pages').replaceChildren();}
 const dimensions = documentLayout(doc.pages, $('viewport').clientWidth, fit ? null : zoom);
 ({offsets, widths, heights} = dimensions);
 $('zoom-value').textContent=`${Math.round(widths[current]/doc.pages[current].width*100)}%`;
 $('pages').style.height=`${dimensions.height}px`; $('pages').style.width=`${dimensions.width}px`;
 if(fit)$('viewport').scrollLeft=0;
 if(preserve)for(const [n,el] of mounted)resizePage(el,offsets[n],widths[n],heights[n]);
 schedule();
}
function visibleRange() {
 const top=$('viewport').scrollTop, bottom=top+$('viewport').clientHeight;
 let low=0,high=offsets.length;
 while(low<high) {const mid=(low+high)>>1;if(offsets[mid]+heights[mid]<top)low=mid+1;else high=mid;}
 const first=Math.min(low,offsets.length-1); let last=first;
 while(last+1<offsets.length && offsets[last+1]<bottom)last++;
 return {first,last};
}
function schedule() { if(!scheduled){scheduled=true;requestAnimationFrame(()=>{scheduled=false;void draw();});} }
async function draw() {
 if (!doc) return;
 if (drawing) { redraw=true; return; }
 drawing=true;const gen=generation;
 try {
  const {first,last}=visibleRange();
  const active=activePage(offsets,heights,$('viewport').scrollTop,$('viewport').clientHeight,first,last);
  if(current!==active){current=active;pageStatus();if(editing)void loadObjects();}
  const from=Math.max(0,first-1),to=Math.min(doc.pages.length-1,last+1);
  for(const [n,el] of mounted) if(n<from||n>to){el.remove();mounted.delete(n);}
  const order=Array.from({length:to-from+1},(_,i)=>i+from).sort((a,b)=>Math.abs(a-current)-Math.abs(b-current));
  for(const n of order){
   if(gen!==generation)break;
   let el=mounted.get(n);
   if(!el){el=document.createElement('div');el.className='pdf-page';el.dataset.page=String(n);el.style.cssText=`top:${offsets[n]}px;width:${widths[n]}px;height:${heights[n]}px`;el.innerHTML=`<span class="page-loading">${n+1}</span>`;mounted.set(n,el);$('pages').append(el);}
   const width=Math.min(2600,Math.round(widths[n]*Math.min(devicePixelRatio,2)));
   const key=`${doc.revision}:${n}:${width}`;
   if(el.dataset.key===key)continue;
   const data=cache.get(key)??await api<string>({op:'render',page:n,width});
   if(gen!==generation)break;
   cache.set(key,data);while(cache.size>8 || (cache.size>1 && [...cache.values()].reduce((n,s)=>n+s.length*2,0)>64*1024*1024))cache.delete(cache.keys().next().value!);
   const img=document.createElement('img');img.alt=`${n+1}페이지`;img.draggable=false;img.src=data;
   const surface=document.createElement('div');surface.className='page-render';surface.append(img);el.append(surface);
   try{
    await img.decode();
    if(gen!==generation)break;
    if(translatedView&&translations.has(n))await translatedLayer(n,surface,img,width,gen);
    else if(translationOpen)await textLayer(n,surface,gen);
    await img.decode();
    if(gen!==generation)break;
    el.replaceChildren(...surface.childNodes);el.dataset.key=key;
   }finally{surface.remove();}
   if(editing&&n===objectPage)overlay();
   evidenceLayer(n,el);
   const range=visibleRange();if(n<range.first-1||n>range.last+1){schedule();break;}
  }
 }catch(e){toast(String(e));}finally{drawing=false;if(gen!==generation||redraw){redraw=false;schedule();}else thumbnails.schedule();}
}
function go(n:number){if(!doc)return;current=Math.max(0,Math.min(doc.pages.length-1,n));$('viewport').scrollTop=offsets[current]-20;pageStatus();schedule();if(editing)void loadObjects();}
function escapeHTML(s:string){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}
async function loadObjects() {
 if(!doc||!editing)return;
 const n=current,gen=generation;
 try{
  const result=await api<{objects:Obj[];rotation:string}>({op:'objects',page:n});
  if(n!==current||gen!==generation||!editing)return;
  objects=result.objects;objectPage=n;objectRotation=result.rotation;selected=null;
  $('properties').replaceChildren();
  $('object-list').innerHTML=`<div class="side-label">${n+1}페이지 · ${objects.length}개 개체</div>`;
  for(const o of objects){const b=document.createElement('button');b.className='object-item';b.textContent=o.kind==='text'?o.text||'텍스트':o.kind==='image'?'이미지':'그룹 개체 (읽기 전용)';b.title=o.font??o.kind;b.disabled=o.kind==='group';b.onclick=()=>select(o);$('object-list').append(b);}
  if(!objects.length)$('object-list').innerHTML+='<p class="hint">직접 편집할 텍스트·이미지 개체가 없습니다. 스캔 문서의 글자는 이미지에 포함되어 있습니다.</p>';
  overlay();
 }catch(e){toast(String(e));}
}
function overlay(){
 for(const el of mounted.values())el.querySelector('.object-overlay')?.remove();
 const el=mounted.get(objectPage);if(!el||!editing||!doc)return;
 const layer=document.createElement('div');layer.className='object-overlay';
 for(const o of objects){if(o.kind==='group')continue;const b=document.createElement('button');b.className=`object-box ${selected?.index===o.index?'selected':''}`;b.title=o.kind==='text'?o.text??'텍스트':'이미지';b.style.cssText=`left:${100*o.display[0]}%;top:${100*o.display[1]}%;width:${100*o.display[2]}%;height:${100*o.display[3]}%`;b.onclick=()=>select(o);
  if(o.kind==='image'){
   const page=objectPage,gen=generation,rotation=objectRotation,size=doc.pages[page];
   bindImageDrag(b,el,()=>{
    if(busy||gen!==generation||!editing)return false;
    select(o,false);for(const button of layer.children)button.classList.toggle('selected',button===b);return true;
   },(dx,dy)=>{
    if(gen!==generation||!editing)return;
    const position=imageDragPosition(o.x,o.y,dx*size.width,dy*size.height,rotation);
    void mutate({op:'transform',page,index:o.index,...position,width:o.width,height:o.height});
   });
  }
  layer.append(b);}
 el.append(layer);
}
function select(o:Obj,refreshOverlay=true){
 let fontPath: string | null = null;
 selected=o;if(refreshOverlay)overlay();
 $('properties').innerHTML=`<div class="side-label">${o.kind==='text'?'텍스트':'이미지'} 편집</div>${o.kind==='text'?`<label>내용<textarea id="text-value" rows="5">${escapeHTML(o.text??'')}</textarea></label><small class="hint">${escapeHTML(o.font??'원본 글꼴')} · 원본 글꼴 유지</small>${tool('font-file','type','대체 글꼴 선택 (TTF)')}${tool('apply-text','check','텍스트 적용')}`:`${tool('replace-image','image','이미지 교체')}${tool('rotate-image','rotate-cw','이미지 90° 회전')}`}
 <div class="property-grid">${[['x','X',o.x],['y','Y',o.y],['width','너비',o.width],['height','높이',o.height]].map(([id,label,value])=>`<label>${label} (pt)<input id="obj-${id}" type="number" step="0.1" value="${Number(value).toFixed(1)}"></label>`).join('')}</div>${tool('apply-bounds','move','위치·크기 적용')}
 ${o.kind==='image'&&o.pixels?`<details><summary>이미지 자르기</summary><small>원본 ${o.pixels[0]} × ${o.pixels[1]} px</small><div class="property-grid">${[['left',0],['top',0],['width',o.pixels[0]],['height',o.pixels[1]]].map(([k,v])=>`<label>${({left:"왼쪽",top:"위쪽",width:"너비",height:"높이"} as Record<string,string>)[k]} (px)<input id="crop-${k}" type="number" min="0" value="${v}"></label>`).join('')}</div>${tool('crop-image','crop','자르기 적용')}</details>`:''}
 ${tool('delete-object','trash-2','개체 삭제','class="danger"')}`;
 createIcons({icons});
 const number=(id:string)=>Number($<HTMLInputElement>(id).value);
 $('apply-text')?.addEventListener('click',()=>mutate({op:'text',page:objectPage,index:o.index,text:$<HTMLTextAreaElement>('text-value').value,font_path:fontPath}));
 $('font-file')?.addEventListener('click',async()=>{const path=await open({filters:[{name:'TrueType 글꼴',extensions:['ttf']}],multiple:false});if(typeof path==='string'){fontPath=path;$('font-file').textContent=path.split(/[\\/]/).pop()!;}});
 $('replace-image')?.addEventListener('click',()=>chooseImage(o.index));
 $('rotate-image')?.addEventListener('click',()=>mutate({op:'rotate_image',page:objectPage,index:o.index}));
 $('crop-image')?.addEventListener('click',()=>mutate({op:'crop_image',page:objectPage,index:o.index,left:number('crop-left'),top:number('crop-top'),width:number('crop-width'),height:number('crop-height')}));
 $('apply-bounds').onclick=()=>mutate({op:'transform',page:objectPage,index:o.index,x:number('obj-x'),y:number('obj-y'),width:number('obj-width'),height:number('obj-height')});
 $('delete-object').onclick=()=>mutate({op:'delete',page:objectPage,index:o.index});
}
async function mutate(request:Record<string,unknown>){
 await task('PDF 내용을 적용하는 중…',async()=>{
  const updated=await api<Doc>(request);resetTranslation();doc=updated;dirty=true;cache.clear();update();const scroll=$('viewport').scrollTop;layout();$('viewport').scrollTop=scroll;await draw();if(editing)await loadObjects();
 });
}
async function chooseImage(index?:number){const path=await open({filters:[{name:'이미지',extensions:['png','jpg','jpeg','webp']}],multiple:false});if(typeof path==='string')await mutate({op:'image',page:current,index:index??null,path});}
async function mode(value:boolean){if(value){assistant.close();closeTranslation();translatedView=false;viewControls();}editing=value;selected=null;$('inspector').hidden=!value;update();layout();go(current);if(value)await loadObjects();}
async function savePDF(){if(!doc)return;const path=await save({defaultPath:doc.path.replace(/\.pdf$/i,'-편집.pdf'),filters:[{name:'PDF',extensions:['pdf']}]});if(path)await task('PDF를 저장하고 확인하는 중…',async()=>{doc=await api<Doc>({op:'save',path});dirty=false;update();toast('PDF를 저장했습니다.');});}
$('sidebar-toggle').onclick=()=>{
 const hidden=$('app').classList.toggle('sidebar-collapsed');
 const button=$('sidebar-toggle');
 const label=hidden?'사이드바 펼치기':'사이드바 숨기기';
 button.setAttribute('aria-expanded',String(!hidden));button.title=label;
 button.innerHTML=icon(hidden?'panel-left-open':'panel-left-close')+`<span>${label}</span>`;
 createIcons({icons});if(!hidden)thumbnails.schedule();
};
$('open').onclick=()=>pickPDF();$('welcome-open').onclick=()=>pickPDF();$('read').onclick=()=>mode(false);$('edit').onclick=()=>mode(true);$('close-edit').onclick=()=>mode(false);
$('save').onclick=savePDF;$('undo').onclick=()=>mutate({op:'undo'});$('redo').onclick=()=>mutate({op:'redo'});
$('add-image').onclick=()=>chooseImage();
$('split').onclick=()=>{$<HTMLInputElement>('range').value=String(current+1);$<HTMLDialogElement>('split-dialog').showModal();};
$('extract').onclick=async()=>{if(!doc)return;const pages=$<HTMLInputElement>('range').value;const path=await save({defaultPath:'추출.pdf',filters:[{name:'PDF',extensions:['pdf']}]});if(path){$<HTMLDialogElement>('split-dialog').close();await task('페이지를 추출하는 중…',async()=>{await api({op:'extract',pages,path});toast('선택한 페이지를 새 PDF로 저장했습니다.');});}};
$('merge').onclick=async()=>{const paths=await open({multiple:true,filters:[{name:'PDF',extensions:['pdf']}]});if(Array.isArray(paths)&&paths.length)await mutate({op:'merge',paths});};
$('jump-form').onsubmit=e=>{e.preventDefault();const value=Number($<HTMLInputElement>('jump').value);if(Number.isInteger(value)&&value>0){go(value-1);$<HTMLInputElement>('jump').value=String(current+1);}};
$('previous-page').onclick=()=>go(current-1);$('next-page').onclick=()=>go(current+1);
$('search-form').onsubmit=async e=>{e.preventDefault();await task('문서에서 찾는 중…',async()=>{const result=await api<{page:number}|null>({op:'search',query:$<HTMLInputElement>('search').value,start:current+1});if(result)go(result.page);else toast('검색 결과가 없습니다.');});};
function scale(delta:number){if(!doc)return;const viewport=$('viewport');zoomAt(Math.max(.25,Math.min(3,widths[current]/doc.pages[current].width+delta)),viewport.clientWidth/2,viewport.clientHeight/2);}
$('zoom-in').onclick=()=>scale(.15);$('zoom-out').onclick=()=>scale(-.15);$('fit').onclick=()=>{fit=true;layout(true);go(current);};
$('viewport').onscroll=schedule;
function zoomAt(next:number,x:number,y:number){
 if(!doc)return;
 const viewport=$('viewport'),pages=$('pages'),documentY=viewport.scrollTop+y;
 let page=offsets.findIndex((top,n)=>top+heights[n]>=documentY);
 if(page<0)page=offsets.length-1;
 const previous=widths[page]/doc.pages[page].width;
 if(next===previous)return;
 // 마우스 아래의 PDF 좌표를 확대 전후 같은 화면 위치에 유지합니다.
 const anchorX=(viewport.scrollLeft+x-pages.clientWidth/2)/previous;
 const anchorY=(documentY-offsets[page])/previous;
 fit=false;zoom=next;layout(true);
 viewport.scrollLeft=pages.clientWidth/2+anchorX*next-x;
 viewport.scrollTop=offsets[page]+anchorY*next-y;
 schedule();
}
$('viewport').addEventListener('wheel',e=>{
 if(!e.ctrlKey||!doc)return;
 e.preventDefault();
 if(busy||!e.deltaY)return;
 const viewport=$('viewport'),rect=viewport.getBoundingClientRect();
 zoomAt(wheelZoom(widths[current]/doc.pages[current].width,e.deltaY,e.deltaMode,viewport.clientHeight),e.clientX-rect.left,e.clientY-rect.top);
},{passive:false});
new ResizeObserver(()=>{
 if(!doc||!heights[current])return;
 const relative=($('viewport').scrollTop-offsets[current])/heights[current];
 layout(true);$('viewport').scrollTop=offsets[current]+relative*heights[current];schedule();
}).observe($('viewport'));
window.addEventListener('keydown',e=>{if(e.metaKey||e.ctrlKey){if(e.key==='o'){e.preventDefault();void pickPDF();}if(e.key==='s'){e.preventDefault();void savePDF();}if(e.key==='f'&&doc){e.preventDefault();$('search').focus();}if(e.key==='z'&&doc&&!(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)){e.preventDefault();void mutate({op:e.shiftKey?'redo':'undo'});}}});
getCurrentWindow().onDragDropEvent(e=>{if(e.payload.type==='over'||e.payload.type==='enter')$('drop').hidden=false;else $('drop').hidden=true;if(e.payload.type==='drop'){const path=e.payload.paths.find(p=>p.toLowerCase().endsWith('.pdf'));if(path)void pickPDF(path);}});
getCurrentWindow().onCloseRequested(async e=>{if(busy){e.preventDefault();return;}if(dirty){e.preventDefault();if(await ask('저장하지 않은 변경 사항을 버리고 종료할까요?',{title:'DalPDF',kind:'warning'}))await getCurrentWindow().destroy();}});
window.addEventListener('unhandledrejection',e=>{e.preventDefault();void message(String(e.reason),{title:'DalPDF',kind:'error'});});

async function openPending(){const path=await invoke<string|null>('pending_file');if(path)await pickPDF(path);}
void listen('open-document',()=>{void openPending();}).then(openPending);

function resetTranslation(){
 assistant.reset();evidence=null;
 translationJob++; if(translating)void invoke('cancel_translation');
 translationRevision=0;savedTranslationRevision=0;textCache.clear();translations.clear();skippedTranslationPages.clear();translationErrors.clear();translatedView=false;viewControls();chosenText='';chosenPage=-1;
 $('translation-source').textContent='';$('translation-result').textContent='';
 $('translation-source-label').textContent='선택한 내용이 없습니다.';
 $('translation-status').textContent='';
 translationControls();
}
function translationControls(){
 const occupied=translating||assistant.running;
 $<HTMLButtonElement>('translate-selected').disabled=occupied||!chosenText.trim();
 $<HTMLButtonElement>('explain-selected').disabled=occupied||!chosenText.trim();
 $<HTMLButtonElement>('assistant-panel').disabled=translating;
 $<HTMLButtonElement>('open-glossary').disabled=translating;
 $<HTMLButtonElement>('translate-page').disabled=occupied;
 $<HTMLButtonElement>('translate-document').disabled=occupied;
 $<HTMLButtonElement>('translate-remaining').disabled=occupied;
 $('translate-remaining').hidden=!doc||translations.size===0||doc.pages.every((_,page)=>skippedTranslationPages.has(page)||(translations.get(page)?.wholePage&&translations.get(page)?.language===$<HTMLSelectElement>('translation-language').value));
 $<HTMLButtonElement>('save-translation').disabled=translating||translations.size===0;
 $<HTMLSelectElement>('translation-language').disabled=translating;
 $('cancel-translation').hidden=!translating;
 $('translation-errors').hidden=translationErrors.size===0;
 $('translation-error-list').textContent=[...translationErrors].map(([page,error])=>`${page+1}페이지: ${error}`).join('\n\n');
}
function closeTranslation(){
 if(translating){translationJob++;void invoke('cancel_translation');}translationOpen=false;$('translation').hidden=true;
 for(const el of mounted.values())el.querySelector('.text-layer')?.remove();
}
async function pageText(page:number){
 const cached=textCache.get(page);if(cached)return cached;
 const identity=doc,revision=doc?.revision;
 const data=await api<PageText>({op:'page_text',page});
 if(doc!==identity||doc?.revision!==revision)throw new Error('문서가 변경되었습니다. 다시 선택해 주세요.');
 textCache.set(page,data);while(textCache.size>8)textCache.delete(textCache.keys().next().value!);
 return data;
}
async function textLayer(page:number,el:HTMLElement,gen:number){
 try{
  const data=await pageText(page);
  if(gen!==generation||!translationOpen||!el.isConnected)return;
  const layer=document.createElement('div');layer.className='text-layer';layer.dataset.page=String(page);
  data.chars.forEach((c,i)=>{
   const span=document.createElement('span');span.textContent=c.text;span.dataset.char=String(i);
   span.style.cssText=`left:${c.box[0]*100}%;top:${c.box[1]*100}%;width:${Math.max(c.box[2]*100,.05)}%;height:${c.box[3]*100}%;font-size:${c.box[3]*heights[page]}px`;
   layer.append(span);
  });
  layer.onclick=e=>{
   const unit=$<HTMLSelectElement>('selection-unit').value;
   const span=(e.target as HTMLElement).closest<HTMLElement>('[data-char]');
   if(unit==='drag'||!span)return;
   const [start,end]=unitRange(data.chars,Number(span.dataset.char),unit as 'sentence'|'paragraph');
   const range=document.createRange();range.setStartBefore(layer.children[start]);range.setEndAfter(layer.children[end-1]);
   const selection=window.getSelection();selection?.removeAllRanges();selection?.addRange(range);
   rememberSelection(page,textOf(data.chars.slice(start,end)),[start,end]);
  };
  el.append(layer);
 }catch(e){if(gen===generation&&translationOpen)$('translation-status').textContent=String(e);}
}
function rememberSelection(page:number,text:string,range:[number,number]){
 chosenText=text;chosenPage=page;chosenRange=range;
 if(!translating){$('translation-source-label').textContent=`${page+1}페이지 · ${text.trim().length.toLocaleString()}자 선택`;}
 translationControls();
}
document.addEventListener('selectionchange',()=>{
 if(!translationOpen)return;
 const selection=window.getSelection();if(!selection||selection.isCollapsed)return;
 const node=selection.anchorNode;const el=node instanceof Element?node:node?.parentElement;
 const layer=el?.closest<HTMLElement>('.text-layer');
 const focus=selection.focusNode instanceof Element?selection.focusNode:selection.focusNode?.parentElement;
 if(layer&&focus?.closest('.text-layer')===layer){
  const page=Number(layer.dataset.page),data=textCache.get(page);
  const spans=Array.from(layer.children).filter(span=>selection.containsNode(span,true)) as HTMLElement[];
  if(data&&spans.length)rememberSelection(page,textOf(data.chars.slice(Number(spans[0].dataset.char),Number(spans.at(-1)!.dataset.char)+1)),[Number(spans[0].dataset.char),Number(spans.at(-1)!.dataset.char)+1]);
 }
 else if(layer){chosenText='';translationControls();$('translation-source-label').textContent='한 페이지 안에서 번역할 내용을 선택해 주세요.';}
});
$('translate-panel').onclick=async()=>{
 if(translationOpen){closeTranslation();return;}
 assistant.close();await mode(false);translationOpen=true;$('translation').hidden=false;
 $('translation-status').textContent='';layout();go(current);
};
$('close-translation').onclick=closeTranslation;
$('translate-selected').onmousedown=e=>e.preventDefault();
$('translate-selected').onclick=()=>startTranslation(false);
$('translate-page').onclick=()=>startTranslation(true);
$('translate-document').onclick=()=>startTranslation('all');
$('translate-remaining').onclick=()=>startTranslation('remaining');
$('translation-language').onchange=translationControls;
$('save-translation').onclick=saveTranslatedPDF;
$('cancel-translation').onclick=async()=>{
 translationJob++;$('translation-status').textContent='번역을 취소하는 중…';
 await invoke('cancel_translation');
};
async function startTranslation(scope:boolean|'all'|'remaining'){
 if(!doc||translating||busy)return;
 if(assistant.running){toast('진행 중인 AI 작업을 먼저 완료하거나 취소해 주세요.');return;}
 translating=true;translationControls();
 const job=++translationJob,selectionRange=chosenRange;activeTranslationJob=job;
 const language=$<HTMLSelectElement>('translation-language').value;
 const entire=scope==='all'||scope==='remaining';
 const pages=entire?doc.pages.map((_,i)=>i).filter(page=>scope!=='remaining'||(!skippedTranslationPages.has(page)&&(!translations.get(page)?.wholePage||translations.get(page)?.language!==language))):[scope?current:chosenPage];
 let completed=0,skipped=0;const failed:number[]=[];
 $('translation-result').textContent='';
 try{
  for(const page of pages){
   translationProgressPrefix=entire?`${page+1} / ${doc.pages.length}페이지 · `:'';
   try{
   $('translation-status').textContent=translationProgressPrefix+'내장 번역 모델 준비 중…';
   const data=await pageText(page);
   if(job!==translationJob)return;
   const ranges=scope?paragraphRanges(data.chars):paragraphRanges(data.chars.slice(...selectionRange)).map(([a,b])=>[a+selectionRange[0],b+selectionRange[0]] as [number,number]);
   const blocks=ranges.map(([start,end])=>({chars:data.chars.slice(start,end),text:''}));
   const sources=blocks.map(b=>translationText(b.chars));
   const source=sources.join('\n\n');
   if(!source.trim()){
    if(entire){skipped++;skippedTranslationPages.add(page);continue;}
    throw new Error('추출할 텍스트가 없습니다. 스캔 이미지의 글자는 번역할 수 없습니다.');
   }
   $('translation-source').textContent=source;
   $('translation-source-label').textContent=`${page+1}페이지 ${scope?'전체':'선택 내용'} → ${language}`;
   const result=await invoke<string[]>('translate',{texts:sources,target:language,job,glossary:assistant.glossary(language)});
   if(job!==translationJob)return;
   if(result.length!==blocks.length)throw new Error('번역 결과의 문단 수가 일치하지 않습니다.');
   blocks.forEach((b,i)=>b.text=result[i]);translationRevision++;translations.set(page,{wholePage:!!scope,language,blocks});translationErrors.delete(page);completed++;
   $('translation-result').textContent=result.join('\n\n');
   setTranslationView(true);
   }catch(e){
    if(job!==translationJob)return;
    if(!entire)throw e;
    translationErrors.set(page,String(e));failed.push(page+1);$('translation-status').textContent=`${page+1}페이지 번역 실패 · 다음 페이지를 계속합니다. ${String(e)}`;
   }
  }
  $('translation-status').textContent=`번역 처리 완료 · ${completed}페이지${skipped?` · 텍스트 없는 ${skipped}페이지는 원문 유지`:''}${failed.length?` · 실패 ${failed.join(', ')}페이지는 기존 내용 유지. 남은 페이지 이어서 번역으로 다시 시도하세요.`:''}`;
 }catch(e){if(job===translationJob)$('translation-status').textContent=translationProgressPrefix+String(e);}
 finally{if(activeTranslationJob===job){translating=false;translationControls();if(job!==translationJob)$('translation-status').textContent=translations.size?'번역을 취소했습니다. 완료된 페이지는 유지됩니다.':'번역을 취소했습니다.';}}
}
void listen<{job:number,done:number,total:number,text?:string}>('translation-progress',({payload:p})=>{
 if(p.job!==translationJob||!translating)return;
 $('translation-status').textContent=`${translationProgressPrefix}번역 중 · ${p.done} / ${p.total} 구간`;
 if(p.text)$('translation-result').textContent=p.text;
});

function viewControls(){
 $('translation-views').hidden=translations.size===0;
 $('show-original').setAttribute('aria-pressed',String(!translatedView));
 $('show-translated').setAttribute('aria-pressed',String(translatedView));
}
function setTranslationView(value:boolean){
 translatedView=value;viewControls();
 const top=$('viewport').scrollTop;layout();$('viewport').scrollTop=top;schedule();
}
$('show-original').onclick=()=>setTranslationView(false);
$('show-translated').onclick=()=>setTranslationView(true);
async function translatedLayer(page:number,el:HTMLElement,img:HTMLImageElement,width:number,gen:number){
 const translated=translations.get(page);if(!translated||!doc)return;
 const key=`background:${doc.revision}:${page}:${width}`;
 const data=cache.get(key)??await api<string>({op:'translation_background',page,width});
 if(gen!==generation||!translatedView||!el.isConnected)return;
 cache.set(key,data);while(cache.size>8 || (cache.size>1 && [...cache.values()].reduce((n,s)=>n+s.length*2,0)>64*1024*1024))cache.delete(cache.keys().next().value!);
 const background=new Image();background.src=data;await background.decode();
 if(gen!==generation)return;
 if(translated.wholePage)img.src=data;
 else{
  await img.decode();if(gen!==generation)return;
  const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
  const ctx=canvas.getContext('2d')!;ctx.drawImage(img,0,0);
  for(const b of translated.blocks)for(const c of b.chars){
   if(!c.text.trim())continue;
   const x=Math.max(0,Math.floor(c.box[0]*canvas.width)-1),y=Math.max(0,Math.floor(c.box[1]*canvas.height)-1);
   const w=Math.min(canvas.width-x,Math.ceil(c.box[2]*canvas.width)+2),h=Math.min(canvas.height-y,Math.ceil(c.box[3]*canvas.height)+2);
   if(w>0&&h>0)ctx.drawImage(background,x,y,w,h,x,y,w,h);
  }
  img.src=canvas.toDataURL('image/png');
 }
 await document.fonts.load(`12px ${translationFonts[translationFont]}`);if(gen!==generation)return;
 img.alt=`${page+1}페이지 번역문`;
 for(const [index,b] of translated.blocks.entries()){
  const box=rangeBox(b.chars);if(!box[2]||!box[3])continue;
  const text=document.createElement('div');text.className='translated-block';text.dataset.block=String(index);text.textContent=b.text;text.title=b.text;
  text.style.cssText=`color:${b.chars.find(c=>c.text.trim())?.color??"#111"};left:${box[0]*100}%;top:${box[1]*100}%;width:${box[2]*100}%;height:${box[3]*100}%`;
  el.append(text);
  styleTranslationBlock(text,b,page);
 }
}

function styleTranslationBlock(text:HTMLElement,block:TranslationBlock,page:number){
 if(!doc)return;
 const layout=layoutTranslation(block.chars,block.text,doc.pages[page],translationFonts[translationFont],translationAutoSize?null:translationSize);
 const box=rangeBox(block.chars),scale=widths[page]/doc.pages[page].width;
 text.style.fontFamily=translationFonts[translationFont];text.style.fontSize=`${layout.size*scale}px`;
 text.classList.toggle('manual-size',!translationAutoSize);text.tabIndex=translationAutoSize?-1:0;
 text.replaceChildren();
 for(const line of layout.lines){
  const span=document.createElement('span');span.className='translated-line';span.textContent=line.text+'\n';
  span.style.cssText=`top:${(line.y-box[1]*doc.pages[page].height-layout.ascent)*scale}px;line-height:${layout.lineHeight*scale}px`;
  text.append(span);
 }
}
async function updateTranslationTypography(){
 if(translations.size)translationRevision++;
 translationFont=$<HTMLSelectElement>('translation-font').value;
 translationAutoSize=$<HTMLSelectElement>('translation-size-mode').value==='auto';
 const input=$<HTMLInputElement>('translation-font-size');input.disabled=translationAutoSize;
 await document.fonts.load(`12px ${translationFonts[translationFont]}`);
 if(input.validity.valid&&input.value!=='')translationSize=Number(input.value);
 else input.value=String(translationSize);
 for(const [page,el] of mounted){
  const translated=translations.get(page);if(!translated)continue;
  for(const text of el.querySelectorAll<HTMLElement>('.translated-block')){
   const block=translated.blocks[Number(text.dataset.block)];
   styleTranslationBlock(text,block,page);
  }
 }
 const result=$('translation-result');result.style.fontFamily=translationFonts[translationFont];
 result.style.fontSize=translationAutoSize?'':`${translationSize}pt`;
}
$('translation-font').onchange=updateTranslationTypography;
$('translation-size-mode').onchange=updateTranslationTypography;
$('translation-font-size').onchange=updateTranslationTypography;

async function saveTranslatedPDF(){
 if(!doc||translating||busy||translations.size===0)return;
 const currentDoc=doc,exportFont=translationFont,exportRevision=translationRevision;
 await document.fonts.load(`12px ${translationFonts[translationFont]}`);
 if(doc!==currentDoc||translating)return;
 const pages:{page:number;whole_page:boolean;masks:number[][];lines:(TranslationLine&{size:number;color:number[]})[]}[]=[];
 for(const [page,translated] of translations){
  const lines=[];
  for(const block of translated.blocks){
   const layout=layoutTranslation(block.chars,block.text,doc.pages[page],translationFonts[translationFont],translationAutoSize?null:translationSize);
   if(layout.overflow){toast(`${page+1}페이지 번역문이 영역을 넘습니다. 글자 크기를 줄이거나 자동 맞춤을 선택하세요.`);return;}
   const color=(block.chars.find(c=>c.text.trim())?.color??'rgb(0,0,0)').match(/\d+/g)!.map(Number);
   lines.push(...layout.lines.filter(l=>l.text.trim()).map(l=>({...l,size:layout.size,color})));
  }
  pages.push({page,whole_page:translated.wholePage,masks:translated.blocks.flatMap(b=>b.chars.filter(c=>c.text.trim()).map(c=>c.box)),lines});
 }
 const path=await save({defaultPath:doc.path.replace(/\.pdf$/i,'-번역.pdf'),filters:[{name:'PDF',extensions:['pdf']}]});
 if(!path||doc!==currentDoc)return;
 await task(`번역 PDF 저장 중 · ${pages.length}페이지의 번역문을 포함합니다…`,async()=>{
  await api({op:'save_translation',path,font:exportFont,pages});savedTranslationRevision=exportRevision;toast('번역 PDF를 저장했습니다. 원본 파일은 유지됩니다.');
 });
}
