// @vitest-environment jsdom
import {beforeEach,expect,test,vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import {save} from '@tauri-apps/plugin-dialog';
import {exportCard,exportOverview,type OverviewExport} from '../src/assistant-export';
import {createAssistant} from '../src/assistant';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/plugin-dialog',()=>({save:vi.fn(),open:vi.fn()}));
const report:OverviewExport={source_path:'/문서/원본.pdf',page_count:48,processed:1,total:12,complete:false,cards:[{title:'전압',answer:'1.7~3.6 V',citations:[{page:17,quote:'Operating voltage 1.7 to 3.6 V'}]}]};
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();document.body.innerHTML='<main id="workspace"></main>';});
test('화면의 검증된 인용을 원문 페이지와 함께 내보낸다',()=>{
 expect(exportCard({title:'전압',answer:'1.7~3.6 V',citations:[{id:'p17',quote:'Operating voltage'}]},[{id:'p17',page:16,start:0,text:'Operating voltage'}]).citations).toEqual([{page:17,quote:'Operating voltage'}]);
});
test('사용자가 저장을 취소하면 파일을 만들지 않는다',async()=>{
 vi.mocked(save).mockResolvedValue(null);expect(await exportOverview(report,'pdf')).toBe(false);expect(invoke).not.toHaveBeenCalled();
});
test('부분 완료 결과와 근거를 Markdown 저장 명령에 그대로 전달한다',async()=>{
 vi.mocked(save).mockResolvedValue('/문서/핵심.md');await exportOverview(report,'md');
 expect(invoke).toHaveBeenCalledWith('export_overview',{request:{path:'/문서/핵심.md',format:'md',report}});
 expect(save).toHaveBeenCalledWith(expect.objectContaining({defaultPath:'/문서/원본-핵심안내.md'}));
});
test('완료된 카드가 없으면 저장창을 열지 않는다',async()=>{
 await expect(exportOverview({...report,cards:[]},'pdf')).rejects.toThrow('저장할 핵심 안내');expect(save).not.toHaveBeenCalled();
});
test('핵심 안내가 중단돼도 검증된 완료 카드만 부분 결과로 저장하며 문서 변경 때 지운다',async()=>{
 const identity={path:'/원본.pdf',pages:[{},{}],revision:0};
 const host={api:vi.fn().mockResolvedValue({total:2,pages:[{page:0,text:'Operating voltage 1.7 to 3.6 V. '.repeat(65)},{page:1,text:'Second section with more evidence. '.repeat(50)}]}),document:()=>identity,selection:()=>({page:0,text:''}),show:vi.fn(),hide:vi.fn(),select:vi.fn(),evidence:vi.fn(),external:vi.fn(),occupied:()=>false,controls:vi.fn(),blocks:()=>[],correct:vi.fn(),toast:vi.fn()};
 const assistant=createAssistant(host);
 expect(document.querySelector<HTMLButtonElement>('#overview-pdf')!.disabled).toBe(true);
 let calls=0;vi.mocked(invoke).mockImplementation(async(command,args)=>{
  if(command==='assist'){
   if(calls++)throw new Error('두 번째 구간 오류');
   const sources=(args as {input:{sources:{id:string;text:string}[]}}).input.sources;
   return {cards:[{title:'전압',answer:'1.7~3.6 V',citations:[{id:sources[0].id,quote:sources[0].text}]}]};
  }
 });
 document.querySelector<HTMLButtonElement>('#overview-start')!.click();
 await vi.waitFor(()=>expect(document.querySelector('#assistant-status')!.textContent).toContain('두 번째 구간 오류'));
 expect(document.querySelector<HTMLButtonElement>('#overview-md')!.disabled).toBe(false);
 vi.mocked(save).mockResolvedValue('/핵심.md');document.querySelector<HTMLButtonElement>('#overview-md')!.click();
 await vi.waitFor(()=>expect(invoke).toHaveBeenCalledWith('export_overview',expect.objectContaining({request:expect.objectContaining({report:expect.objectContaining({complete:false,processed:1,total:2,cards:expect.any(Array)})})})));
 assistant.reset();expect(document.querySelector<HTMLButtonElement>('#overview-md')!.disabled).toBe(true);
});
