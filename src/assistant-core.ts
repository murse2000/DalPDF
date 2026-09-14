import { diffArrays } from 'diff';

export type TextPage={page:number;text:string};
export type Source={id:string;page:number;text:string;start:number};
export type Citation={id:string;quote:string};
export type Answer={answer:string;citations:Citation[];example?:string};
export type Card=Answer&{title:string};
export type Term={source:string;target:string;language:string};
export type Change={before:Source[];after:Source[]};
export const normalized=(text:string)=>text.replace(/\s+/gu,' ').trim();

export function sourcesFor(pages:TextPage[],limit=400):Source[]{
 const result:Source[]=[];
 for(const {page,text} of pages){
  let start=0;
  while(start<text.length){
   let end=Math.min(start+limit,text.length);
   if(end<text.length){
    const gap=text.slice(start+Math.floor(limit/2),end).search(/\s[^\s]*$/u);
    if(gap>=0)end=start+Math.floor(limit/2)+gap+1;
    if(/[\uD800-\uDBFF]/u.test(text[end-1]))end--;
   }
   const part=text.slice(start,end);
   if(part.trim())result.push({id:`p${page+1}s${start}`,page,text:part,start});
   start=end;
  }
 }
 return result;
}
function tokens(text:string):string[]{
 const words=text.toLowerCase().match(/[\p{L}\p{N}]+/gu)??[];
 return words.flatMap(word=>{
  if(!/[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(word))return [word];
  const chars=Array.from(word);return [word,...chars.slice(1).map((c,i)=>chars[i]+c)];
 });
}
// 원문 구간의 단어 빈도와 길이를 함께 고려합니다. 문서 전체를 모델에 넣지 않습니다.
export function retrieve(sources:Source[],query:string,keywords:string[],budget=3500):Source[]{
 const terms=[...new Set(tokens(query+' '+keywords.join(' ')))];
 if(!terms.length)return [];
 const counts=sources.map(s=>{const m=new Map<string,number>();for(const t of tokens(s.text))m.set(t,(m.get(t)??0)+1);return m;});
 const lengths=counts.map(c=>[...c.values()].reduce((a,b)=>a+b,0));
 const average=lengths.reduce((a,b)=>a+b,0)/Math.max(1,sources.length);
 const frequencies=terms.map(t=>counts.filter(c=>c.has(t)).length);
 const ranked=sources.map((source,i)=>({source,score:terms.reduce((score,t,j)=>{
  const frequency=counts[i].get(t)??0;
  const idf=Math.log(1+(sources.length-frequencies[j]+.5)/(frequencies[j]+.5));
  return score+idf*frequency*2.2/(frequency+1.2*(.25+.75*lengths[i]/Math.max(1,average)));
 },0)})).filter(r=>r.score>0).sort((a,b)=>b.score-a.score);
 const selected:Source[]=[];let size=0;
 for(const {source} of ranked){if(size+source.text.length>budget)continue;selected.push(source);size+=source.text.length;if(selected.length===5)break;}
 return selected;
}
export function checkedAnswer(value:unknown,sources:Source[]):Answer{
 const a=value as Partial<Answer>|null;
 if(!a||typeof a.answer!=='string'||!Array.isArray(a.citations))throw new Error('AI 응답 형식을 확인하지 못했습니다. 다시 시도해 주세요.');
 const citations:Citation[]=[];
 for(const c of a.citations){
  const source=sources.find(s=>s.id===c?.id);
  if(!source||typeof c.quote!=='string'||normalized(c.quote).length<Math.min(8,normalized(source.text).length)||!normalized(source.text).includes(normalized(c.quote)))throw new Error('AI가 제시한 인용문을 원문에서 확인하지 못했습니다. 다시 시도해 주세요.');
  citations.push({id:c.id,quote:c.quote});
 }
 if(!citations.length)return {answer:'문서에서 확인되지 않음',citations:[]};
 if(!a.answer.trim())throw new Error('AI 답변이 비어 있습니다.');
 return {answer:a.answer,citations,...(typeof a.example==='string'&&a.example.trim()?{example:a.example}:{})};
}
export function checkedCards(value:unknown,sources:Source[]):Card[]{
 const cards=(value as {cards?:unknown[]})?.cards;
 if(!Array.isArray(cards))throw new Error('핵심 안내 응답 형식을 확인하지 못했습니다.');
 return cards.map(c=>{const title=(c as {title?:string})?.title;if(typeof title!=='string'||!title.trim())throw new Error('핵심 안내 제목이 비어 있습니다.');return {title,...checkedAnswer(c,sources)};}).filter(c=>c.citations.length>0);
}
export function validTerms(value:unknown):Term[]{
 if(!Array.isArray(value)||value.length>200||value.some(t=>!t||typeof t.source!=='string'||typeof t.target!=='string'||!t.source.trim()||!t.target.trim()||t.source.length>100||t.target.length>100||!['한국어','English','日本語','简体中文'].includes(t.language)))throw new Error('저장된 용어집 형식을 확인하지 못했습니다.');
 return value;
}
export function replaceTerm(text:string,from:string,to:string):string{
 if(!from)return text;
 const escaped=from.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const start=/^[a-z0-9]/i.test(from)?'(?<![a-z0-9])':'';
 const end=/[a-z0-9]$/i.test(from)?'(?![a-z0-9])':'';
 return text.replace(new RegExp(start+escaped+end,'gu'),()=>to);
}
export function comparePages(before:TextPage[],after:TextPage[]):Change[]{
 const lines=(pages:TextPage[],prefix:string)=>pages.flatMap(({page,text})=>{
  let start=0;return text.split(/\r\n|\r|\n/u).flatMap(line=>{
   const offset=text.indexOf(line,start);start=offset+line.length;
   return line.trim()?[{id:`${prefix}${page+1}s${offset}`,page,text:line,start:offset}]:[];
  });
 });
 const parts=diffArrays(lines(before,'a'),lines(after,'b'),{comparator:(a,b)=>normalized(a.text)===normalized(b.text),timeout:10000});
 if(!parts)throw new Error('두 문서의 차이가 너무 많아 비교를 완료하지 못했습니다. 필요한 페이지를 쪼개어 비교해 주세요.');
 const result:Change[]=[];let pending:Change={before:[],after:[]};
 const flush=()=>{if(pending.before.length||pending.after.length)result.push(pending);pending={before:[],after:[]};};
 for(const part of parts){if(part.removed)pending.before.push(...part.value);else if(part.added)pending.after.push(...part.value);else flush();}
 flush();return result;
}
