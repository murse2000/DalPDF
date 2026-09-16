type Document = {pages:{width:number;height:number}[]};

// 본문 렌더링이 끝난 뒤 현재 페이지 주변만 낮은 해상도로 준비합니다.
export class Thumbnails {
 private document:Document|null=null;
 private current=-1;
 private generation=0;
 private cache=new Map<number,string>();
 private pending=false;
 private timer:ReturnType<typeof setTimeout>|undefined;
 constructor(private list:HTMLElement,private render:(page:number)=>Promise<string>,private go:(page:number)=>void,private ready:()=>boolean){}
 update(document:Document,current:number){
  if(this.document!==document){this.document=document;this.cache.clear();this.current=-1;this.generation++;}
  if(this.current!==current){
   this.current=current;this.generation++;
   this.list.replaceChildren();
   const first=Math.max(0,Math.min(current-2,document.pages.length-5));
   for(let page=first;page<Math.min(first+5,document.pages.length);page++){
    const button=window.document.createElement('button');button.className='page-thumbnail';button.dataset.page=String(page);
    button.setAttribute('aria-label',`${page+1}페이지로 이동`);button.setAttribute('aria-current',page===current?'page':'false');button.onclick=()=>this.go(page);
    const image=window.document.createElement('img');image.alt=`${page+1}페이지 미리보기`;image.draggable=false;
    image.width=112;image.height=Math.round(112*document.pages[page].height/document.pages[page].width);
    const cached=this.cache.get(page);if(cached)image.src=cached;
    const label=window.document.createElement('span');label.textContent=String(page+1);button.append(image,label);this.list.append(button);
   }
   const active=this.list.querySelector<HTMLElement>('[aria-current="page"]');
   if(active)this.list.scrollTop=Math.max(0,active.offsetTop-(this.list.clientHeight-active.offsetHeight)/2);
  }
  this.schedule();
 }
 schedule(){if(!this.timer&&!this.pending)this.timer=setTimeout(()=>{this.timer=undefined;void this.draw();},80);}
 private async draw(){
  if(!this.ready()||this.pending)return;
  const buttons=[...this.list.querySelectorAll<HTMLButtonElement>('button[data-page]')].sort((a,b)=>Math.abs(Number(a.dataset.page)-this.current)-Math.abs(Number(b.dataset.page)-this.current));
  const button=buttons.find(button=>!this.cache.has(Number(button.dataset.page))&&!button.dataset.failed);
  if(!button)return;
  const page=Number(button.dataset.page),generation=this.generation;
  this.pending=true;
  try{
   const data=await this.render(page);
   if(generation!==this.generation)return;
   this.cache.set(page,data);while(this.cache.size>12)this.cache.delete(this.cache.keys().next().value!);
   button.querySelector('img')!.src=data;
  }catch{if(generation===this.generation)button.dataset.failed='true';}
  finally{this.pending=false;if(this.ready())this.schedule();}
 }
}
