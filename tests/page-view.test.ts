// @vitest-environment jsdom
import {afterEach,expect,test} from 'vitest';
import {resizePage} from '../src/page-view';
afterEach(()=>document.body.replaceChildren());
test('확대 중에도 기존 이미지와 번역문을 제거하지 않는다',()=>{
 const page=document.createElement('div');page.style.cssText='width:600px;height:800px';
 const image=document.createElement('img'),translation=document.createElement('div');
 translation.textContent='번역된 문장';page.append(image,translation);document.body.append(page);
 resizePage(page,28,900,1200);
 expect(image.isConnected).toBe(true);expect(translation.isConnected).toBe(true);
 expect(page.querySelector('.page-preview')?.getAttribute('style')).toContain('scale(1.5)');
 expect(page.style.width).toBe('900px');
});
test('연속 확대·축소는 미리보기를 중첩하지 않고 원래 배율로 돌아온다',()=>{
 const page=document.createElement('div');page.style.cssText='width:600px;height:800px';
 const image=document.createElement('img');page.append(image);document.body.append(page);
 resizePage(page,28,900,1200);resizePage(page,28,300,400);resizePage(page,28,600,800);
 expect(page.querySelectorAll('.page-preview')).toHaveLength(1);
 expect(page.querySelector('.page-preview')?.getAttribute('style')).toContain('scale(1)');
 expect(page.querySelector('img')).toBe(image);
});

test('이미지 드래그는 확대 배율과 스크롤을 반영하고 놓을 때 한 번만 적용한다',async()=>{
 const {bindImageDrag}=await import('../src/object-drag');
 const page=document.createElement('div'),button=document.createElement('button');page.append(button);document.body.append(page);
 let top=100;page.getBoundingClientRect=()=>({left:200,top,width:1200,height:1600} as DOMRect);
 button.setPointerCapture=()=>{};button.releasePointerCapture=()=>{};
 const moves:number[][]=[];bindImageDrag(button,page,()=>true,(x,y)=>moves.push([x,y]));
 const pointer=(type:string,x:number,y:number)=>{const e=new Event(type);Object.assign(e,{pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y});button.dispatchEvent(e);};
 pointer('pointerdown',320,260);pointer('pointermove',440,420);
 expect(moves).toHaveLength(0);expect(button.style.transform).toBe('translate(120px,160px)');
 top=20;pointer('pointermove',440,420);pointer('pointerup',440,420);
 expect(moves).toHaveLength(1);expect(moves[0][0]).toBeCloseTo(.1);expect(moves[0][1]).toBeCloseTo(.15);
 expect(button.style.transform).toBe('');
});
test('이미지 클릭과 취소한 드래그는 문서를 변경하지 않는다',async()=>{
 const {bindImageDrag}=await import('../src/object-drag');
 const page=document.createElement('div'),button=document.createElement('button');page.append(button);document.body.append(page);
 page.getBoundingClientRect=()=>({left:0,top:0,width:600,height:800} as DOMRect);
 button.setPointerCapture=()=>{};button.releasePointerCapture=()=>{};
 const moves:number[][]=[];bindImageDrag(button,page,()=>true,(x,y)=>moves.push([x,y]));
 const pointer=(type:string,x:number)=>{const e=new Event(type);Object.assign(e,{pointerId:1,isPrimary:true,button:0,clientX:x,clientY:100});button.dispatchEvent(e);};
 pointer('pointerdown',100);pointer('pointermove',101);pointer('pointerup',101);
 pointer('pointerdown',100);pointer('pointermove',200);pointer('pointercancel',200);pointer('pointerup',200);
 expect(moves).toHaveLength(0);expect(button.style.transform).toBe('');
});
test('페이지 회전 방향에 맞게 이미지의 PDF 좌표를 이동한다',async()=>{
 const {imageDragPosition}=await import('../src/object-drag');
 expect(imageDragPosition(100,200,30,40,'None')).toEqual({x:130,y:160});
 expect(imageDragPosition(100,200,30,40,'Degrees90')).toEqual({x:140,y:230});
 expect(imageDragPosition(100,200,30,40,'Degrees180')).toEqual({x:70,y:240});
 expect(imageDragPosition(100,200,30,40,'Degrees270')).toEqual({x:60,y:170});
});
