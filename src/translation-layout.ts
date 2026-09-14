import { rangeBox, type TextChar } from './text-selection';
export type TranslationLine={text:string;x:number;y:number;width:number};
export type TranslationLayout={size:number;ascent:number;lineHeight:number;lines:TranslationLine[];overflow:boolean};
export function layoutTranslation(chars:TextChar[],text:string,page:{width:number;height:number},family:string,size:number|null):TranslationLayout{
 const box=rangeBox(chars),left=box[0]*page.width,top=box[1]*page.height,width=box[2]*page.width,height=box[3]*page.height;
 const context=document.createElement('canvas').getContext('2d')!;
 const tokens=Array.from(new Intl.Segmenter(undefined,{granularity:'word'}).segment(text.replace(/\r/g,'')),s=>s.segment);
 const atSize=(fontSize:number):TranslationLayout=>{
  context.font=`${fontSize}px ${family}`;
  const metrics=context.measureText('Hg한');
  const ascent=metrics.fontBoundingBoxAscent||metrics.actualBoundingBoxAscent;
  const descent=metrics.fontBoundingBoxDescent||metrics.actualBoundingBoxDescent;
  const lineHeight=Math.max(fontSize*1.1,ascent+descent);
  const rows:string[]=[];let row='';
  const push=()=>{rows.push(row.trimEnd());row='';};
  for(const token of tokens){
   for(const [i,part] of token.split('\n').entries()){
    if(i>0)push();
    if(!part)continue;
    if(context.measureText(row+part).width<=width){row+=part;continue;}
    if(row)push();
    if(context.measureText(part).width<=width){row=part.trimStart();continue;}
    for(const c of Array.from(part)){
     if(row&&context.measureText(row+c).width>width)push();
     row+=c;
    }
   }
  }
  if(row||!rows.length)push();
  const lines=rows.map((text,i)=>({text,x:left,y:top+ascent+i*lineHeight,width:context.measureText(text).width}));
  return {size:fontSize,ascent,lineHeight,lines,overflow:rows.length*lineHeight>height+.01||lines.some(l=>l.width>width+.01)};
 };
 if(size!==null)return atSize(size);
 let low=.1,high=Math.max(...chars.map(c=>c.box[3]))*page.height;
 for(let i=0;i<14;i++){const mid=(low+high)/2;if(atSize(mid).overflow)high=mid;else low=mid;}
 return atSize(low);
}
