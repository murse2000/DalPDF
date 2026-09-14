export type TextChar = { text: string; color?:string; box: [number, number, number, number] };
export type PageText = { chars: TextChar[] };
export function textOf(chars: TextChar[]) { return chars.map(c => c.text).join(''); }
export function unitRange(chars: TextChar[], index: number, unit: 'sentence' | 'paragraph'): [number, number] {
 if (unit === 'sentence') {
  const text = textOf(chars).replace(/[\r\n]/g, ' ');
  const offset = textOf(chars.slice(0,index)).length;
  for (const part of new Intl.Segmenter(undefined,{granularity:'sentence'}).segment(text)) {
   if (offset < part.index + part.segment.length) {
    let position=0, start=0, end=chars.length;
    for(let i=0;i<chars.length;i++) { if(position<=part.index)start=i;position+=chars[i].text.length;if(position>=part.index+part.segment.length){end=i+1;break;} }
    return [start,end];
   }
  }
 }
 // PDF에는 문단 정보가 없을 수 있어 빈 줄과 줄 사이 간격으로 경계를 구합니다.
 const starts=[0];let previous:TextChar|undefined;let breaks='';
 chars.forEach((c,i)=>{
  if(!c.text.trim()){breaks+=c.text;return;}
  if(previous){
   const gap=c.box[1]-previous.box[1];
   const newLine=Math.abs(gap)>Math.max(c.box[3],previous.box[3])*.5;
   if(/\n\s*\n/.test(breaks)|| (newLine && (gap>Math.max(c.box[3],previous.box[3])*1.7 || gap<0)))starts.push(i);
  }
  previous=c;breaks='';
 });
 starts.push(chars.length);
 const n=starts.findIndex((start,i)=>start<=index && starts[i+1]>index);
 return n<0?[0,chars.length]:[starts[n],starts[n+1]];
}

export function paragraphRanges(chars:TextChar[]):[number,number][]{
 const ranges:[number,number][]=[];let start=0;
 while(start<chars.length){const [,end]=unitRange(chars,start,'paragraph');if(textOf(chars.slice(start,end)).trim())ranges.push([start,end]);start=end;}
 return ranges;
}
export function rangeBox(chars:TextChar[]):[number,number,number,number]{
 const visible=chars.filter(c=>c.text.trim()&&c.box[2]>0&&c.box[3]>0);
 if(!visible.length)return [0,0,0,0];
 const left=Math.min(...visible.map(c=>c.box[0])),top=Math.min(...visible.map(c=>c.box[1]));
 return [left,top,Math.max(...visible.map(c=>c.box[0]+c.box[2]))-left,Math.max(...visible.map(c=>c.box[1]+c.box[3]))-top];
}
