export type PrintRequest={current_page:number;translation:{font:string;pages:unknown[]}|null};
type Host={available:()=>boolean;occupied:()=>boolean;lock:(busy:boolean)=>void;request:()=>Promise<PrintRequest>;print:(request:PrintRequest)=>Promise<boolean>;notify:(message:string)=>void};

export function printAction(host:Host){
 return async()=>{
  if(!host.available()||host.occupied())return;
  // 대화상자를 준비하는 동안에도 문서와 번역 내용이 바뀌지 않게 합니다.
  host.lock(true);
  try{const printed=await host.print(await host.request());if(printed)host.notify('인쇄 요청을 보냈습니다.');}
  catch(error){host.notify(String(error));}
  finally{host.lock(false);}
 };
}

export function isPrintShortcut(event:Pick<KeyboardEvent,'key'|'metaKey'|'ctrlKey'|'altKey'>){
 return (event.metaKey||event.ctrlKey)&&!event.altKey&&event.key.toLowerCase()==='p';
}
