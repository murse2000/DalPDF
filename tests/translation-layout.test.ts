// @vitest-environment jsdom
import {afterEach,expect,test,vi} from 'vitest';
import {layoutTranslation} from '../src/translation-layout';
afterEach(()=>vi.restoreAllMocks());
function canvas(){
 const context={font:'',measureText(text:string){const size=parseFloat(this.font);return {width:Array.from(text).length*size*.6,fontBoundingBoxAscent:size*.8,fontBoundingBoxDescent:size*.2};}};
 vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
}
const chars=[{text:'Original',size:9,box:[.2,.3,.1,.025] as [number,number,number,number]}];
test('긴 번역문과 큰 지정 크기도 원본 영역 안으로 맞춘다',()=>{
 canvas();const page={width:600,height:800};
 for(const size of [null,72]){
  const result=layoutTranslation(chars,'표의 셀 안에 들어가야 하는 긴 번역문입니다.',page,'sans-serif',size);
  expect(result.overflow).toBe(false);
  for(const line of result.lines){expect(line.x+line.width).toBeLessThanOrEqual(180.01);expect(line.y+result.lineHeight-result.ascent).toBeLessThanOrEqual(260.01);}
 }
});
test('짧은 번역문을 원본 글자 크기보다 크게 늘리지 않는다',()=>{
 canvas();const result=layoutTranslation(chars,'짧음',{width:600,height:800},'sans-serif',null);
 expect(result.size).toBe(9);expect(result.overflow).toBe(false);
});
