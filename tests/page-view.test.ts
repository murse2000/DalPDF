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
