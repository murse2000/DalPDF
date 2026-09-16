// @vitest-environment jsdom
import {afterEach,expect,test,vi} from 'vitest';
import {Thumbnails} from '../src/thumbnails';

afterEach(()=>vi.useRealTimers());
const pages=()=>({pages:Array.from({length:128},()=>({width:595,height:842}))});

test('대용량 문서는 현재 주변 다섯 페이지만 미리보기로 렌더링한다',async()=>{
 vi.useFakeTimers();
 const list=document.createElement('div'),render=vi.fn(async(page:number)=>`data:image/png;base64,${page}`),go=vi.fn();
 const thumbnails=new Thumbnails(list,render,go,()=>true);
 thumbnails.update(pages(),29);await vi.advanceTimersByTimeAsync(600);
 expect(render.mock.calls.map(call=>call[0])).toEqual([29,28,30,27,31]);
 expect(list.querySelectorAll('img')).toHaveLength(5);
 list.querySelector<HTMLButtonElement>('[aria-current="page"]')!.click();expect(go).toHaveBeenCalledWith(29);
});

test('본문 렌더링 중에는 기다리고 같은 문서의 준비된 썸네일을 재사용한다',async()=>{
 vi.useFakeTimers();let idle=false;
 const list=document.createElement('div'),render=vi.fn(async()=> 'data:image/png;base64,AA==');
 const thumbnails=new Thumbnails(list,render,()=>{},()=>idle),doc=pages();
 thumbnails.update(doc,0);await vi.advanceTimersByTimeAsync(600);expect(render).not.toHaveBeenCalled();
 idle=true;thumbnails.schedule();await vi.advanceTimersByTimeAsync(600);expect(render).toHaveBeenCalledTimes(5);
 thumbnails.update(doc,1);await vi.advanceTimersByTimeAsync(600);expect(render).toHaveBeenCalledTimes(5);
});

test('문서를 바꾸면 이전 문서에서 늦게 도착한 썸네일을 버린다',async()=>{
 vi.useFakeTimers();let resolve!:(image:string)=>void;
 const list=document.createElement('div');
 const render=vi.fn().mockImplementationOnce(()=>new Promise<string>(done=>{resolve=done;})).mockResolvedValue('data:image/png;base64,new');
 const thumbnails=new Thumbnails(list,render,()=>{},()=>true);
 thumbnails.update(pages(),0);await vi.advanceTimersByTimeAsync(80);
 thumbnails.update(pages(),29);resolve('data:image/png;base64,old');await vi.advanceTimersByTimeAsync(600);
 expect([...list.querySelectorAll('img')].every(image=>image.src.endsWith(',new'))).toBe(true);
});
