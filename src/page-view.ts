// 새 비트맵이 준비될 때까지 기존 이미지와 번역 레이어를 함께 확대합니다.
export function resizePage(el: HTMLElement, top: number, width: number, height: number) {
  let preview=el.querySelector<HTMLElement>(':scope > .page-preview');
  if(!preview){
    preview=document.createElement('div');preview.className='page-preview';
    preview.style.cssText=`width:${el.style.width};height:${el.style.height};transform-origin:0 0;pointer-events:none`;
    preview.append(...el.childNodes);el.append(preview);
  }
  preview.style.transform=`scale(${width/parseFloat(preview.style.width)})`;
  el.style.top=`${top}px`;el.style.width=`${width}px`;el.style.height=`${height}px`;
  delete el.dataset.key;
}
