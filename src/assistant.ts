import {invoke} from '@tauri-apps/api/core';
import {open} from '@tauri-apps/plugin-dialog';
import {exportCard,exportOverview,type OverviewExport} from './assistant-export';
import {sourcesFor,retrieve,checkedAnswer,checkedCards,validTerms,replaceTerm,type TextPage,type Source,type Answer,type Term,type Change} from './assistant-core';

type Block={page:number;index:number;source:string;text:string;language:string};
type Correction={page:number;index:number;before:string;after:string};
type Host={
 api:<T>(request:Record<string,unknown>)=>Promise<T>;
 document:()=>{path:string;pages:unknown[];revision:number}|null;
 selection:()=>{page:number;text:string};
 show:()=>Promise<void>;
 hide:()=>void;
 select:()=>void;
 evidence:(page:number,quote:string)=>Promise<void>;
 external:(path:string,page:number)=>Promise<void>;
 occupied:()=>boolean;
 controls:()=>void;
 blocks:()=>Block[];
 correct:(changes:Correction[])=>void;
 toast:(text:string)=>void;
};
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const button=(label:string,action:()=>void)=>{const b=document.createElement('button');b.textContent=label;b.onclick=action;return b;};
const text=(tag:string,value:string)=>{const el=document.createElement(tag);el.textContent=value;return el;};
export function createAssistant(host:Host){
 let running=false,epoch=0,tab='overview',pages:TextPage[]|null=null,terms:Term[]=[];
 let worker:Worker|null=null,workerReject:((reason:Error)=>void)|null=null;
 let preview:Correction[]=[],previewTerm:Term|null=null;
 let overviewResult:OverviewExport|null=null,exporting=false;
 const panel=document.createElement('aside');panel.id='assistant';panel.hidden=true;
 panel.innerHTML=`<div class="inspector-head"><strong>문서 도우미</strong><button id="assistant-close" aria-label="도우미 닫기">×</button></div>
 
 <nav class="assistant-tabs" aria-label="도우미 기능"><button data-tab="overview">핵심 안내</button><button data-tab="question">문서 질문</button><button data-tab="explain">쉽게 설명</button><button data-tab="compare">문서 비교</button><button data-tab="glossary">용어집</button></nav>
 <p id="assistant-status" role="status"></p><button id="assistant-cancel" hidden>AI 작업 취소</button>
 <section data-section="overview"><button id="overview-start" class="primary">핵심 안내 만들기</button><div><button id="overview-pdf" disabled>PDF 저장</button><button id="overview-md" disabled>Markdown 저장</button></div><div id="overview-results" class="ai-results"></div></section>
 <section data-section="question" hidden><form id="question-form"><label>문서에 질문하기<textarea id="question-input" rows="3" maxlength="500" placeholder="예: 이 제품의 동작 전압 범위는?" required></textarea></label><button id="question-start" class="primary">근거 찾아 답하기</button></form><div id="question-results" class="ai-results"></div></section>
 <section data-section="explain" hidden><button id="explain-select">원문에서 선택하기</button><p id="explain-selection" class="hint">선택한 내용이 없습니다.</p><button id="explain-start" class="primary">선택 내용 쉽게 설명</button><div id="explain-results" class="ai-results"></div></section>
 <section data-section="compare" hidden><p class="hint">현재 문서 → 새 버전 PDF의 텍스트 비교</p><button id="compare-start" class="primary">비교할 PDF 선택</button><p id="compare-file" class="hint"></p><div id="compare-results" class="ai-results"></div></section>
 <section data-section="glossary" hidden><p class="hint">저장한 용어는 다음 번역에도 적용됩니다.</p>
 <form id="term-form"><label>번역 언어<select id="term-language"><option>한국어</option><option>English</option><option>日本語</option><option>简体中文</option></select></label><label>원문 용어<input id="term-source" maxlength="100" placeholder="예: driver" required></label><label>기존 번역 용어<input id="term-before" maxlength="100" placeholder="예: 운전자 · 기존 번역을 고칠 때 입력"></label><label>올바른 번역<input id="term-target" maxlength="100" placeholder="예: 구동 회로" required></label><button id="term-preview" class="primary">저장 및 적용 대상 확인</button></form>
 <div id="term-changes"></div><button id="term-apply" hidden>용어 저장 및 선택 항목 적용</button><div id="term-list"></div></section>
 `;
 $('workspace').append(panel);
 function status(value:string){$('assistant-status').textContent=value;}
 function controls(){
  for(const id of ['overview-pdf','overview-md'])$<HTMLButtonElement>(id).disabled=running||exporting||host.occupied()||!overviewResult?.cards.length;
  for(const id of ['overview-start','question-start','explain-start','compare-start','term-preview','term-apply'])$<HTMLButtonElement>(id).disabled=running||exporting||host.occupied();
  $('assistant-cancel').hidden=!running;host.controls();
 }
 function check(job:number){if(job!==epoch)throw new Error('AI 작업을 취소했습니다.');}
 async function run(work:(job:number)=>Promise<void>){
  if(running||host.occupied()){host.toast('진행 중인 작업을 먼저 완료하거나 취소해 주세요.');return;}
  const job=++epoch;running=true;controls();
  try{await work(job);}catch(e){if(job===epoch)status(String(e));}
  finally{running=false;controls();}
 }
 async function cancel(){
  if(!running)return;
  epoch++;workerReject?.(new Error('비교를 취소했습니다.'));worker?.terminate();worker=null;workerReject=null;
  status('AI 작업을 취소하는 중…');await invoke('cancel_translation');
  status('취소했습니다. 완료된 결과는 유지됩니다.');
 }
 async function allPages(job:number,path?:string):Promise<TextPage[]>{
  if(!path&&pages)return pages;
  const identity=host.document();let total=1;const result:TextPage[]=[];
  for(let start=0;start<total;start+=8){
   check(job);status(`문서 읽는 중 · ${start+1}${total>1?` / ${total}`:''}페이지`);
   const batch=await host.api<{total:number;pages:TextPage[]}>({op:'document_text',path:path??null,start,count:8});
   check(job);if(host.document()!==identity)throw new Error('문서가 변경되었습니다. 다시 시작해 주세요.');
   total=batch.total;result.push(...batch.pages);
  }
  if(!path)pages=result;
  if(result.every(p=>!p.text.trim()))throw new Error('추출할 텍스트가 없습니다. 스캔 PDF는 지원하지 않습니다.');
  return result;
 }
 async function ai(kind:string,input:unknown,job:number){check(job);const result=await invoke<unknown>('assist',{kind,input});check(job);return result;}
 function answerCard(answer:Answer,sources:Source[],title?:string,externalPath?:string){
  const card=document.createElement('article');card.className='ai-card';
  if(title)card.append(text('h3',title));card.append(text('p',answer.answer));
  if(answer.example){const example=text('p',`이해를 돕는 예시 · 원문 외 설명\n${answer.example}`);example.className='ai-example';card.append(example);}
  for(const citation of answer.citations){
   const source=sources.find(s=>s.id===citation.id)!;
   const link=button(`${source.id.startsWith('b')?'새 버전 · ':''}${source.page+1}페이지 · 원문 보기`,()=>{
    if(externalPath&&source.id.startsWith('b'))void host.external(externalPath,source.page);
    else void host.evidence(source.page,citation.quote);
   });
   link.className='evidence-link';card.append(link,text('blockquote',citation.quote));
  }
  return card;
 }
 async function overview(){await run(async job=>{
  const all=await allPages(job),sources=sourcesFor(all),container=$('overview-results');container.replaceChildren();
  overviewResult={source_path:host.document()!.path,page_count:all.length,processed:0,total:0,complete:false,cards:[]};
  const batches:Source[][]=[];let batch:Source[]=[],size=0;
  for(const source of sources){if(size+source.text.length>3000){batches.push(batch);batch=[];size=0;}batch.push(source);size+=source.text.length;}
  if(batch.length)batches.push(batch);
  overviewResult.total=batches.length;
  let count=0;
  for(const [i,sources] of batches.entries()){
   status(`핵심 안내 작성 중 · ${i+1} / ${batches.length}구간`);
   const cards=checkedCards(await ai('overview',{sources},job),sources);
   for(const card of cards){container.append(answerCard(card,sources,card.title));overviewResult.cards.push(exportCard(card,sources));count++;}
   overviewResult.processed=i+1;
  }
  const skipped=all.filter(p=>!p.text.trim()).length;
  overviewResult.complete=true;
  status(`전체 ${all.length}페이지 검토 완료 · ${count}개 카드${skipped?` · 텍스트 없는 ${skipped}페이지 제외`:''}`);
  if(!count)container.append(text('p','핵심 내용을 확인하지 못했습니다. 문서 질문으로 필요한 내용을 찾아보세요.'));
 });}
 async function saveOverview(format:'pdf'|'md'){
  if(!overviewResult?.cards.length||running||exporting||host.occupied())return;
  const snapshot=structuredClone(overviewResult);exporting=true;controls();
  try{if(await exportOverview(snapshot,format))host.toast(`${snapshot.complete?'핵심 안내':'완료된 일부 핵심 안내'}를 저장했습니다.`);}
  catch(error){status(String(error));}finally{exporting=false;controls();}
 }
 async function question(){const query=$<HTMLTextAreaElement>('question-input').value.trim();if(!query)return;await run(async job=>{
  const all=await allPages(job),sources=sourcesFor(all);status('질문의 관련 용어를 찾는 중…');
  const expansion=await ai('keywords',{question:query},job) as {keywords?:unknown};
  if(!Array.isArray(expansion.keywords)||expansion.keywords.some(k=>typeof k!=='string'))throw new Error('검색 용어를 생성하지 못했습니다. 다시 시도해 주세요.');
  const selected=retrieve(sources,query,expansion.keywords.slice(0,8).map(String));
  $('question-results').replaceChildren();
  if(!selected.length){$('question-results').append(text('p','문서에서 확인되지 않음'));status('질문과 일치하는 원문 구간을 찾지 못했습니다.');return;}
  status('관련 원문을 읽고 답변하는 중…');
  const answer=checkedAnswer(await ai('question',{question:query,sources:selected},job),selected);
  $('question-results').append(text('h3',query),answerCard(answer,selected));
  status(`문서 ${all.length}페이지에서 관련 구간 검색 완료 · 인용문 대조 완료`);
 });}
 async function explain(){const selection=host.selection();if(!selection.text.trim()){host.toast('원문에서 문장이나 문단을 먼저 선택해 주세요.');return;}await run(async job=>{
  if(selection.text.length>3500)throw new Error('설명할 내용을 3,500자 이하로 선택해 주세요.');
  const sources=[{id:'selected',page:selection.page,text:selection.text,start:0}];status('선택한 내용을 쉽게 풀어 쓰는 중…');
  const answer=checkedAnswer(await ai('explain',{sources},job),sources);
  $('explain-results').replaceChildren(answerCard(answer,sources,'선택 내용 설명'));status('설명 완료 · 원문과 함께 확인하세요.');
 });}
 async function compare(){
  if(running||host.occupied())return;
  const identity=host.document(),path=await open({filters:[{name:'PDF',extensions:['pdf']}],multiple:false});
  if(typeof path!=='string'||host.document()!==identity)return;
  await run(async job=>{
   const before=await allPages(job),after=await allPages(job,path);check(job);status('두 문서의 텍스트 차이를 찾는 중…');
   const changes=await new Promise<Change[]>((resolve,reject)=>{
    worker=new Worker(new URL('./compare-worker.ts',import.meta.url),{type:'module'});workerReject=reject;
    worker.onmessage=e=>{worker?.terminate();worker=null;workerReject=null;if(e.data.error)reject(new Error(e.data.error));else resolve(e.data.changes);};
    worker.onerror=()=>{worker?.terminate();worker=null;workerReject=null;reject(new Error('문서 비교 작업기를 실행하지 못했습니다.'));};
    worker.postMessage({before,after});
   });check(job);
   $('compare-file').textContent=`이전: ${identity?.path.split(/[\\/]/).pop()} → 새 버전: ${path.split(/[\\/]/).pop()}`;
   const container=$('compare-results');container.replaceChildren();let shown=0;
   const more=button('변경 내용 더 보기',showMore);
   function showMore(){
    more.remove();
    for(const change of changes.slice(shown,shown+20)){
     const card=document.createElement('article');card.className='ai-card';card.append(text('h3',change.before.length&&change.after.length?'내용 변경':change.before.length?'내용 삭제':'내용 추가'));
     for(const [side,sources] of [['before',change.before],['after',change.after]] as const){
      if(!sources.length)continue;const detail=document.createElement('details');detail.open=true;
      detail.append(text('summary',`${side==='before'?'이전':'새 버전'} · ${[...new Set(sources.map(s=>s.page+1))].join(', ')}페이지`));
      const pre=text('pre',sources.map(s=>s.text).join('\n'));pre.className=side;detail.append(pre);
      const source=sources[0];detail.append(button('해당 페이지 열기',()=>{if(side==='before')void host.evidence(source.page,source.text);else void host.external(path as string,source.page);}));card.append(detail);
     }
     const output=document.createElement('div');
     card.append(button('변경 의미 설명',()=>void run(async job=>{
      const sources=[...change.before,...change.after];
      if(JSON.stringify({sources}).length>5800)throw new Error('변경 구간이 길어 한 번에 설명할 수 없습니다. 아래 원문 차이를 직접 확인해 주세요.');
      status('변경된 문장의 의미를 설명하는 중…');
      const answer=checkedAnswer(await ai('compare',{sources,before_ids:change.before.map(s=>s.id),after_ids:change.after.map(s=>s.id)},job),sources);output.replaceChildren(answerCard(answer,sources,undefined,path as string));status('변경 설명 완료 · 원문과 대조하세요.');
     })),output);container.append(card);
    }
    shown+=20;if(shown<changes.length)container.append(more);
   }
   showMore();const empty=[...before,...after].filter(p=>!p.text.trim()).length;
   status(`${changes.length}개 변경 구간${empty?` · 텍스트 없는 ${empty}페이지는 비교에서 제외`:''}`);
   if(!changes.length)container.append(text('p','추출한 텍스트의 차이가 없습니다. 이미지와 서식은 별도로 확인하세요.'));
  });
 }
 function renderTerms(){
  const list=$('term-list');list.replaceChildren(text('h3',`저장된 용어 · ${terms.length}개`));
  for(const term of terms){const row=document.createElement('div');row.className='term-row';row.append(text('span',`${term.source} → ${term.target} · ${term.language}`),button('삭제',()=>{
   if(running||host.occupied())return;
   try{const next=terms.filter(t=>t!==term);localStorage.setItem('dalpdf.glossary.v1',JSON.stringify(next));terms=next;renderTerms();clearPreview();}catch(e){host.toast(`용어집을 저장하지 못했습니다: ${e}`);}
  }));list.append(row);}
 }
 function clearPreview(){preview=[];previewTerm=null;$('term-changes').replaceChildren();$('term-apply').hidden=true;}
 function previewTermChanges(){
  if(running||host.occupied())return;
  clearPreview();const source=$<HTMLInputElement>('term-source').value.trim(),target=$<HTMLInputElement>('term-target').value.trim(),language=$<HTMLSelectElement>('term-language').value;
  const from=$<HTMLInputElement>('term-before').value.trim();
  if(!source||!target)return;previewTerm={source,target,language};
  for(const b of host.blocks()){
   if(b.language!==language||!b.source.toLowerCase().includes(source.toLowerCase()))continue;
   const after=replaceTerm(b.text,from,target);if(after!==b.text)preview.push({page:b.page,index:b.index,before:b.text,after});
  }
  $('term-changes').append(text('p',`${preview.length}개 번역 문단 변경 예정 · 용어는 다음 번역에도 사용됩니다.`));
  for(const [i,c] of preview.entries()){
   const label=document.createElement('label');label.className='term-preview';
   const input=document.createElement('input');input.type='checkbox';input.checked=true;input.dataset.correction=String(i);
   label.append(input,text('strong',`${c.page+1}페이지`),text('del',c.before),text('ins',c.after));$('term-changes').append(label);
  }
  $('term-apply').hidden=false;
 }
 function applyTerms(){
  if(!previewTerm||running||host.occupied())return;
  try{
   const next=[...terms.filter(t=>!(t.source.toLowerCase()===previewTerm!.source.toLowerCase()&&t.language===previewTerm!.language)),previewTerm];validTerms(next);
   const selected=Array.from($('term-changes').querySelectorAll<HTMLInputElement>('input:checked')).map(el=>preview[Number(el.dataset.correction)]);
   const blocks=host.blocks();if(selected.some(c=>!blocks.some(b=>b.page===c.page&&b.index===c.index&&b.text===c.before)))throw new Error('번역문이 변경되었습니다. 적용 대상을 다시 확인해 주세요.');
   localStorage.setItem('dalpdf.glossary.v1',JSON.stringify(next));terms=next;host.correct(selected);renderTerms();clearPreview();status(`용어 저장 완료 · ${selected.length}개 문단 교정`);
  }catch(e){status(String(e));}
 }
 async function show(next=tab){await host.show();panel.hidden=false;tab=next;for(const section of panel.querySelectorAll<HTMLElement>('[data-section]'))section.hidden=section.dataset.section!==tab;for(const b of panel.querySelectorAll('[data-tab]'))b.setAttribute('aria-pressed',String((b as HTMLElement).dataset.tab===tab));const selected=host.selection();$('explain-selection').textContent=selected.text?`${selected.page+1}페이지 · ${selected.text.length}자 선택`:'선택한 내용이 없습니다.';controls();}
 $('assistant-close').onclick=()=>{panel.hidden=true;host.hide();};
 for(const b of panel.querySelectorAll<HTMLElement>('[data-tab]'))b.onclick=()=>void show(b.dataset.tab);
 $('assistant-cancel').onclick=()=>void cancel();$('overview-start').onclick=()=>void overview();
 $('overview-pdf').onclick=()=>void saveOverview('pdf');$('overview-md').onclick=()=>void saveOverview('md');
 $('question-form').onsubmit=e=>{e.preventDefault();void question();};$('explain-start').onclick=()=>void explain();
 $('explain-select').onclick=()=>{panel.hidden=true;host.select();};$('compare-start').onclick=()=>void compare();
 $('term-form').onsubmit=e=>{e.preventDefault();previewTermChanges();};$('term-apply').onclick=applyTerms;
 for(const id of ['term-source','term-target','term-before','term-language'])$(id).addEventListener('input',clearPreview);
 try{terms=validTerms(JSON.parse(localStorage.getItem('dalpdf.glossary.v1')??'[]'));}catch(e){host.toast(String(e));}renderTerms();
 return {
  show,explain:async()=>{await show('explain');await explain();},
  get running(){return running||exporting;},
  glossary:(language:string)=>terms.filter(t=>t.language===language).map(({source,target})=>({source,target})),
  close:()=>{panel.hidden=true;},
  reset:()=>{if(running)void cancel();else epoch++;pages=null;overviewResult=null;clearPreview();for(const id of ['overview-results','question-results','explain-results','compare-results','compare-file'])$(id).replaceChildren();status('');controls();},
  controls,
 };
}
