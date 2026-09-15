import test from 'node:test';
import assert from 'node:assert/strict';
import { textOf, translationText, unitRange } from '../src/text-selection.ts';
const chars=(text,y=0)=>Array.from(text,(text,i)=>({text,box:[i*.01,y,.01,.02]}));
test('위첨자의 가상 줄바꿈은 제거하고 실제 다음 줄은 유지한다',()=>{
 const data=[{text:'I',box:[.1,.1,.01,.02]},{text:'\r\n',box:[.11,.12,0,0]},{text:'2',box:[.11,.095,.01,.015]},{text:'C',box:[.12,.1,.01,.02]},{text:'\n',box:[.13,.12,0,0]},{text:'Next',box:[.1,.14,.04,.02]}];
 assert.equal(translationText(data),'I2C\nNext');
 assert.equal(textOf(data),'I\r\n2C\nNext');
});
test('문장 선택은 줄바꿈을 넘어 문장 끝까지 선택한다',()=>{
 const data=chars('First sentence. Second\r\nsentence! Last.');
 const [start,end]=unitRange(data,20,'sentence');
 assert.equal(textOf(data.slice(start,end)).trim(),'Second\r\nsentence!');
});
test('문단 선택은 큰 줄 간격에서 다음 문단과 분리한다',()=>{
 const data=[...chars('First line.\r\n'),...chars('Wrapped line.\r\n',.025),...chars('Next paragraph.',.1)];
 const [start,end]=unitRange(data,16,'paragraph');
 assert.equal(textOf(data.slice(start,end)).trim(),'First line.\r\nWrapped line.');
});
test('한글과 보조 평면 문자가 있어도 문장 위치를 유지한다',()=>{
 const data=chars('달곰 🐻 입니다. 다음 문장입니다.');
 const [start,end]=unitRange(data,15,'sentence');
 assert.equal(textOf(data.slice(start,end)).trim(),'다음 문장입니다.');
});
test('페이지 번역용 문단 범위가 모든 원문을 빠짐없이 포함한다',async()=>{
 const {paragraphRanges,rangeBox}=await import('../src/text-selection.ts');
 const data=[...chars('Title\n'),...chars('Paragraph one.\n',.1),...chars('Paragraph two.',.2)];
 const ranges=paragraphRanges(data);
 assert.equal(ranges.length,3);
 assert.equal(ranges.map(([start,end])=>textOf(data.slice(start,end))).join(''),textOf(data));
 assert.deepEqual(rangeBox(chars('AB')),[0,0,.02,.02]);
});
test('표의 같은 행과 다음 행에 있는 서로 다른 셀을 합치지 않는다',async()=>{
 const {paragraphRanges}=await import('../src/text-selection.ts');
 const cell=(text,x,y)=>chars(text,y).map(c=>({...c,box:[c.box[0]+x,c.box[1],c.box[2],c.box[3]]}));
 const data=[...cell('Left cell',.1,.1),...cell('Right cell',.6,.1),...cell('Next left',.1,.13),...cell('Next right',.6,.13)];
 assert.deepEqual(paragraphRanges(data).map(([s,e])=>textOf(data.slice(s,e))),['Left cell','Right cell','Next left','Next right']);
});
