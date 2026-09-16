import {invoke} from '@tauri-apps/api/core';
import {save} from '@tauri-apps/plugin-dialog';
import type {Card,Source} from './assistant-core';

export type ExportCard={title:string;answer:string;citations:{page:number;quote:string}[]};
export type OverviewExport={source_path:string;page_count:number;processed:number;total:number;complete:boolean;cards:ExportCard[]};
export function exportCard(card:Card,sources:Source[]):ExportCard{
 return {title:card.title,answer:card.answer,citations:card.citations.map(c=>{
  const source=sources.find(s=>s.id===c.id);if(!source)throw new Error('핵심 안내의 근거 페이지를 찾지 못했습니다.');
  return {page:source.page+1,quote:c.quote};
 })};
}
export async function exportOverview(report:OverviewExport,format:'pdf'|'md'):Promise<boolean>{
 if(!report.cards.length)throw new Error('저장할 핵심 안내가 없습니다.');
 const path=await save({defaultPath:report.source_path.replace(/\.pdf$/i,'')+`-핵심안내.${format}`,filters:[{name:format==='pdf'?'PDF':'Markdown',extensions:[format]}]});
 if(!path)return false;
 await invoke('export_overview',{request:{path,format,report}});return true;
}
