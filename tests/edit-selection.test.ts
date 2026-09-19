// @vitest-environment jsdom
import {afterEach,expect,test,vi} from 'vitest';
const native=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@tauri-apps/api/core',()=>({invoke:native.invoke}));
vi.mock('@tauri-apps/api/event',()=>({listen:vi.fn(async()=>()=>{})}));
vi.mock('@tauri-apps/api/window',()=>({getCurrentWindow:()=>({setTitle:vi.fn(async()=>{}),onDragDropEvent:vi.fn(),onCloseRequested:vi.fn()})}));
vi.mock('@tauri-apps/plugin-dialog',()=>({open:vi.fn(),save:vi.fn(),ask:vi.fn(),message:vi.fn()}));
vi.mock('lucide',()=>({createIcons:vi.fn(),icons:{}}));
vi.mock('../src/assistant',()=>({createAssistant:()=>({running:false,reset:vi.fn(),close:vi.fn()})}));
vi.mock('../src/acceleration',()=>({accelerationPanel:vi.fn()}));
vi.mock('../src/updater',()=>({initializeUpdater:()=>vi.fn(async()=>{})}));
vi.mock('../src/default-app',()=>({offerDefaultPdfApp:vi.fn()}));
vi.mock('../src/annotations',()=>({annotationTools:()=>({mode:null,reset:vi.fn(),resetDocument:vi.fn(),layer:vi.fn(async()=>{})})}));
vi.mock('../src/thumbnails',()=>({Thumbnails:class{update(){}schedule(){}}}));
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();document.body.replaceChildren();});

test.each(['resize','document','read'])('늦은 개체 응답을 문서 상태에 따라 처리한다: %s',async(scenario)=>{
 vi.resetModules();native.invoke.mockReset();
 vi.useFakeTimers();document.body.innerHTML='<div id="app"></div>';
 const frames:FrameRequestCallback[]=[];
 vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length;});
 let resize!:()=>void;
 vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){resize=callback;}observe(){}});
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(900);
 vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(700);
 HTMLImageElement.prototype.decode=vi.fn(async()=>{});
 const documentInfo={path:'fixture.pdf',pages:[{width:600,height:800}],editable:true,undo:false,redo:false,revision:0};
 const pending:Array<(value:unknown)=>void>=[];
 const object={index:0,kind:'text',text:'Operating voltage',font:'Helvetica',display:[.1,.1,.4,.03],x:60,y:700,width:240,height:24,pixels:null};
 native.invoke.mockImplementation(async(command:string,args?:{request:Record<string,unknown>})=>{
  if(command==='pending_file')return 'fixture.pdf';
  const request=args!.request;
  if(request.op==='open')return {...documentInfo,path:request.path};
  if(request.op==='text')return {...documentInfo,revision:1,undo:true};
  if(request.op==='render')return 'data:image/png;base64,AA==';
  if(request.op==='objects')return new Promise(resolve=>pending.push(resolve));
  throw new Error(`예상하지 못한 호출: ${command}/${request.op}`);
 });
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 const draw=async()=>{for(let i=0;i<5;i++){frames.splice(0).forEach(callback=>callback(0));await flush();}};
 await import('../src/main');await flush();await draw();
 document.getElementById('edit')!.click();await flush();
 expect(pending.length).toBeGreaterThan(0);
 // WebView2에서 패널 너비가 바뀐 뒤 늦은 네이티브 개체 응답이 도착하는 순서를 재현합니다.
 resize();await draw();
 if(scenario==='read')document.getElementById('read')!.click();
 if(scenario==='document'){const {open}=await import('@tauri-apps/plugin-dialog');vi.mocked(open).mockResolvedValue('second.pdf');document.getElementById('open')!.click();}
 await flush();await draw();
 for(const resolve of pending.splice(0))resolve({objects:[object],rotation:'None'});
 await flush();await draw();
 const target=document.querySelector<HTMLButtonElement>('.object-box');
 if(scenario!=='resize'){expect(target).toBeNull();expect(document.getElementById('text-value')).toBeNull();return;}
 expect(target).not.toBeNull();target!.click();
 expect((document.getElementById('text-value') as HTMLTextAreaElement).value).toBe('Operating voltage');
 (document.getElementById('text-value') as HTMLTextAreaElement).value='Updated voltage';
 document.getElementById('apply-text')!.click();await flush();
 expect(native.invoke).toHaveBeenCalledWith('pdf',{request:expect.objectContaining({op:'text',text:'Updated voltage',index:0,page:0})});
});
