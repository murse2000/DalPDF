import {expect,test,vi} from 'vitest';
import {printAction,isPrintShortcut,type PrintRequest} from '../src/printing';

function setup(request:PrintRequest={current_page:0,translation:null}){
 let busy=false;
 const host={available:()=>true,occupied:()=>busy,lock:vi.fn((value:boolean)=>{busy=value;}),request:vi.fn(async()=>request),print:vi.fn(async(_request:PrintRequest)=>false),notify:vi.fn()};
 return {host,action:printAction(host)};
}
test('원문과 번역 인쇄 요청을 그대로 전달하며 취소하면 알림 없이 잠금을 해제한다',async()=>{
 for(const translation of [null,{font:'gothic',pages:[{page:2,whole_page:true,lines:[{text:'번역문'}]}]}]){
  const request={current_page:2,translation},before=JSON.stringify(request),{host,action}=setup(request);
  await action();expect(host.print).toHaveBeenCalledWith(request);expect(JSON.stringify(request)).toBe(before);
  expect(host.lock.mock.calls).toEqual([[true],[false]]);expect(host.notify).not.toHaveBeenCalled();
 }
});
test('인쇄 대화상자가 열려 있는 동안 중복 인쇄와 준비 작업을 막는다',async()=>{
 const {host,action}=setup();let finish!:(value:boolean)=>void;
 host.print.mockImplementation(()=>new Promise<boolean>(resolve=>{finish=resolve;}));
 const first=action();await vi.waitFor(()=>expect(host.print).toHaveBeenCalledTimes(1));
 await action();expect(host.request).toHaveBeenCalledTimes(1);finish(false);await first;
 expect(host.lock).toHaveBeenLastCalledWith(false);
});
test('준비 실패와 시스템 인쇄 실패 후에도 앱을 다시 사용할 수 있다',async()=>{
 for(const failure of ['request','print'] as const){
  const {host,action}=setup();host[failure].mockRejectedValue(new Error('인쇄 준비 실패'));
  await action();expect(host.notify).toHaveBeenCalledWith('Error: 인쇄 준비 실패');expect(host.lock).toHaveBeenLastCalledWith(false);
  if(failure==='request')expect(host.print).not.toHaveBeenCalled();
 }
});
test('Ctrl+P와 Cmd+P를 지원하고 다른 조합은 인쇄로 처리하지 않는다',()=>{
 expect(isPrintShortcut({key:'p',ctrlKey:true,metaKey:false,altKey:false})).toBe(true);
 expect(isPrintShortcut({key:'P',ctrlKey:false,metaKey:true,altKey:false})).toBe(true);
 expect(isPrintShortcut({key:'p',ctrlKey:false,metaKey:false,altKey:false})).toBe(false);
 expect(isPrintShortcut({key:'p',ctrlKey:true,metaKey:false,altKey:true})).toBe(false);
});
