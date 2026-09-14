import test from 'node:test';
import assert from 'node:assert/strict';
import { textOf, unitRange } from '../src/text-selection.ts';
const chars=(text,y=0)=>Array.from(text,(text,i)=>({text,box:[i*.01,y,.01,.02]}));
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
