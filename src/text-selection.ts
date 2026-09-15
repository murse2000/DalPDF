export type TextChar = { text: string; color?:string; size?:number; box: [number, number, number, number] };
export type PageText = { chars: TextChar[] };
export function textOf(chars: TextChar[]) { return chars.map(c => c.text).join(''); }
// 위첨자 등 같은 시각적 줄에 삽입된 PDF 추출기의 가상 줄바꿈을 제거합니다.
export function translationText(chars:TextChar[]) {
 let result='',previous:TextChar|undefined;
 for(let i=0;i<chars.length;i++){
  const c=chars[i];
  if(/[\r\n]/.test(c.text)){
   const next=chars.slice(i+1).find(c=>c.text.trim());
   if(previous&&next&&Math.min(previous.box[1]+previous.box[3],next.box[1]+next.box[3])>Math.max(previous.box[1],next.box[1])&&next.box[0]>=previous.box[0]+previous.box[2]-.001)continue;
  }
  result+=c.text;if(c.text.trim())previous=c;
 }
 return result;
}
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
 const starts=[0];let previous:TextChar|undefined;let breaks='';let left=0;
 chars.forEach((c,i)=>{
  if(!c.text.trim()){breaks+=c.text;return;}
  if(previous){
   const gap=c.box[1]-previous.box[1];
   const newLine=Math.abs(gap)>Math.max(c.box[3],previous.box[3])*.5;
   const height=Math.max(c.box[3],previous.box[3]);
   // 표의 옆 셀과 다른 열을 하나의 넓은 번역 영역으로 합치지 않습니다.
   const nextCell=!newLine&&(c.box[0]-previous.box[0]-previous.box[2]>height*1.5||c.box[0]<previous.box[0]-height);
   const nextColumn=newLine&&Math.abs(c.box[0]-left)>height*3;
   const nextStyle=newLine&&(c.color!==previous.color||Math.abs((c.size??c.box[3])/(previous.size??previous.box[3])-1)>.08);
   if(nextCell||nextColumn||nextStyle||/\n\s*\n/.test(breaks)|| (newLine && (gap>height*1.7 || gap<0))){starts.push(i);left=c.box[0];}
  }
  else left=c.box[0];
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
