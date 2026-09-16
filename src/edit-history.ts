const annotations=new Set(['add_note','add_highlight','edit_annotation','delete_annotation','move_annotation']);

// PDF 엔진의 20개 스냅샷과 같은 순서로 성공한 변경의 종류만 보관합니다.
export class EditHistory {
 private undo:boolean[]=[];
 private redo:boolean[]=[];
 reset(){this.undo=[];this.redo=[];}
 commit(operation:string):boolean{
  if(operation==='undo'||operation==='redo'){
   const source=operation==='undo'?this.undo:this.redo,target=operation==='undo'?this.redo:this.undo;
   const annotation=source.pop();if(annotation===undefined)return false;target.push(annotation);return annotation;
  }
  const annotation=annotations.has(operation);
  this.undo.push(annotation);if(this.undo.length>20)this.undo.shift();this.redo=[];
  return annotation;
 }
}
