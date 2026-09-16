// @vitest-environment jsdom
import {beforeEach,expect,test,vi} from 'vitest';
import {annotationTools,highlightBoxes} from '../src/annotations';

beforeEach(()=>{
 document.body.innerHTML='<button id="highlight"></button><button id="add-note"></button><div class="pdf-page"></div>';
 HTMLDialogElement.prototype.showModal=function(){this.open=true;};HTMLDialogElement.prototype.close=function(){this.open=false;};
});
const note={index:0,kind:'note',text:'검토할 내용',color:[255,225,70],display:[.2,.3,.03,.03],boxes:[]};
function setup(){
 const identity={};const mutate=vi.fn(async()=>true);
 const tools=annotationTools({api:vi.fn().mockResolvedValue({annotations:[note]}),identity:()=>identity,editable:()=>true,occupied:()=>false,enter:vi.fn(async()=>{}),mutate,selection:vi.fn(async()=>null),toast:vi.fn()});
 return {tools,mutate,page:document.querySelector<HTMLElement>('.pdf-page')!};
}
test('형광펜 영역은 줄과 표 셀을 구분한다',()=>{
 const boxes=highlightBoxes([{text:'A',box:[.1,.1,.02,.02]},{text:'B',box:[.12,.1,.02,.02]},{text:'C',box:[.5,.1,.02,.02]},{text:'D',box:[.1,.2,.02,.02]}]);
 expect(boxes).toHaveLength(3);expect(boxes[0][2]).toBeCloseTo(.04);
});
test('기존 메모는 접혀 열리고 펼치기, 편집, 삭제를 지원한다',async()=>{
 const {tools,mutate,page}=setup();await tools.layer(0,page,()=>true);
 const card=page.querySelector<HTMLElement>('.pdf-note')!,content=card.querySelector<HTMLButtonElement>('.pdf-note-content')!;
 expect(card.classList.contains('collapsed')).toBe(true);expect(content.hidden).toBe(true);
 card.querySelector<HTMLButtonElement>('.pdf-note-handle')!.click();expect(content.hidden).toBe(false);
 content.click();expect(document.querySelector('dialog')!.open).toBe(true);
 document.querySelector<HTMLTextAreaElement>('textarea')!.value='수정한 메모';document.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(()=>expect(mutate).toHaveBeenCalledWith(expect.objectContaining({op:'edit_annotation',text:'수정한 메모'})));
 content.click();document.querySelector<HTMLButtonElement>('.annotation-delete')!.click();
 await vi.waitFor(()=>expect(mutate).toHaveBeenCalledWith({op:'delete_annotation',page:0,index:0}));
});
test('문서가 바뀌거나 렌더 세대가 끝난 주석 결과는 표시하지 않는다',async()=>{
 const {tools,page}=setup();await tools.layer(0,page,()=>false);expect(page.childElementCount).toBe(0);
});

test('렌더 임시 컨테이너가 제거돼도 실제 페이지 좌표로 메모를 추가한다',async()=>{
 const {tools,mutate,page}=setup();
 vi.spyOn(page,'getBoundingClientRect').mockReturnValue({left:100,top:200,width:600,height:800} as DOMRect);
 document.getElementById('add-note')!.click();await vi.waitFor(()=>expect(tools.mode).toBe('note'));
 const surface=document.createElement('div');page.append(surface);await tools.layer(0,surface,()=>true);
 page.replaceChildren(...surface.childNodes);surface.remove();
 page.querySelector('.annotation-layer')!.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:400,clientY:600}));
 document.querySelector<HTMLTextAreaElement>('textarea')!.value='새 메모';document.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(()=>expect(mutate).toHaveBeenCalledWith({op:'add_note',page:0,x:.5,y:.5,text:'새 메모'}));
});

test('메모 드래그는 카드 전체를 미리 보여주고 화면에 보정된 위치를 한 번 저장한다',async()=>{
 const {tools,mutate,page}=setup();
 vi.spyOn(page,'getBoundingClientRect').mockReturnValue({left:100,top:200,width:600,height:800} as DOMRect);
 const surface=document.createElement('div');page.append(surface);await tools.layer(0,surface,()=>true);
 page.replaceChildren(...surface.childNodes);surface.remove();
 const card=page.querySelector<HTMLElement>('.pdf-note')!,handle=page.querySelector<HTMLElement>('.pdf-note-handle')!;
 vi.spyOn(card,'getBoundingClientRect').mockReturnValue({left:220,top:280,width:164,height:120} as DOMRect);
 handle.setPointerCapture=vi.fn();handle.releasePointerCapture=vi.fn();
 const pointer=(type:string,x:number,y:number)=>{const event=new MouseEvent(type,{clientX:x,clientY:y,button:0,bubbles:true});Object.defineProperties(event,{pointerId:{value:1},isPrimary:{value:true}});handle.dispatchEvent(event);};
 pointer('pointerdown',225,285);pointer('pointermove',285,365);
 expect(card.style.transform).toContain('translate(');expect(handle.style.transform).toBe('');expect(mutate).not.toHaveBeenCalled();
 pointer('pointerup',285,365);expect(mutate).toHaveBeenCalledTimes(1);
 const request=mutate.mock.calls[0][0] as {op:string;x:number;y:number};expect(request.op).toBe('move_annotation');expect(request.x).toBeCloseTo(.3);expect(request.y).toBeCloseTo(.2);
 handle.click();expect(document.querySelector('dialog')!.open).toBe(false);
});

test('새 메모는 저장 과정에서 다시 그려져도 즉시 펼쳐 보인다',async()=>{
 const page=document.querySelector<HTMLElement>('.pdf-page')!;let identity={};let items:unknown[]=[];
 vi.spyOn(page,'getBoundingClientRect').mockReturnValue({left:0,top:0,width:600,height:800} as DOMRect);
 const tools=annotationTools({api:vi.fn(async()=>({annotations:items})) as never,identity:()=>identity,editable:()=>true,occupied:()=>false,enter:vi.fn(async()=>{}),selection:vi.fn(async()=>null),toast:vi.fn(),mutate:async()=>{items=[note];identity={};page.replaceChildren();await tools.layer(0,page,()=>true);return true;}});
 document.getElementById('add-note')!.click();await vi.waitFor(()=>expect(tools.mode).toBe('note'));await tools.layer(0,page,()=>true);
 page.querySelector('.annotation-layer')!.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:100,clientY:200}));
 document.querySelector<HTMLTextAreaElement>('textarea')!.value='검토할 내용';document.querySelector('form')!.dispatchEvent(new Event('submit',{cancelable:true}));
 await vi.waitFor(()=>expect(page.querySelector('.pdf-note')?.classList.contains('collapsed')).toBe(false));
 expect(page.querySelector<HTMLButtonElement>('.pdf-note-content')!.hidden).toBe(false);
});
