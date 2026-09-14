import test from 'node:test';
import assert from 'node:assert/strict';
import {sourcesFor,retrieve,checkedAnswer,checkedCards,replaceTerm,validTerms,comparePages} from '../src/assistant-core.ts';

test('긴 원문의 모든 글자와 페이지 출처를 보존한다',()=>{
 const text='전압 3.3V와 🐻 문서입니다.\r\n'.repeat(100);
 const sources=sourcesFor([{page:4,text}]);
 assert.equal(sources.map(s=>s.text).join(''),text);
 for(const source of sources){assert.equal(source.page,4);assert.equal(text.slice(source.start,source.start+source.text.length),source.text);assert.ok(source.text.length<=400);}
});
test('한국어 질문의 영어 검색어를 이용해 긴 문서의 관련 구간을 찾는다',()=>{
 const sources=sourcesFor(Array.from({length:80},(_,page)=>({page,text:page===67?'The operating voltage range is 3.3 V to 5 V.':'Installation manual. Dimensions and package information.'})));
 assert.equal(retrieve(sources,'동작 전압 범위는?',['operating','voltage','range'])[0].page,67);
 assert.deepEqual(retrieve(sources,'존재하지않는검색어',[]),[]);
});
test('출처가 없거나 변조된 인용을 답변 근거로 허용하지 않는다',()=>{
 const sources=[{id:'p1',page:0,start:0,text:'Voltage is 3.3 V.\r\nCurrent is 20 mA.'}];
 assert.throws(()=>checkedAnswer({answer:'5V',citations:[{id:'p1',quote:'Voltage is 5 V.'}]},sources));
 assert.throws(()=>checkedAnswer({answer:'3.3V',citations:[{id:'p99',quote:'Voltage is 3.3 V.'}]},sources));
 assert.equal(checkedAnswer({answer:'모델이 추측한 답',citations:[]},sources).answer,'문서에서 확인되지 않음');
 assert.equal(checkedAnswer({answer:'3.3V',citations:[{id:'p1',quote:'Voltage is 3.3 V. Current is 20 mA.'}]},sources).citations.length,1);
 assert.throws(()=>checkedCards({cards:[{title:'전압',answer:'5V',citations:[{id:'p1',quote:'5 volts'}]}]},sources));
});
test('용어 교정은 정규식·치환 기호를 문자 그대로 처리하고 다른 영어 단어는 유지한다',()=>{
 assert.equal(replaceTerm('driver screwdriver driver','driver','구동 $& 회로'),'구동 $& 회로 screwdriver 구동 $& 회로');
 assert.equal(replaceTerm('C++ C++','C++','C#'),'C# C#');
 assert.equal(validTerms([{source:'driver',target:'구동 회로',language:'한국어'}]).length,1);
 assert.throws(()=>validTerms([{source:'',target:'구동 회로',language:'한국어'}]));
});
test('페이지 삽입 뒤의 동일 본문을 변경으로 오인하지 않고 숫자·조건 차이를 찾는다',()=>{
 const before=[{page:0,text:'Title\nVoltage 3.3 V\nOnly when enabled'},{page:1,text:'Unchanged appendix'}];
 const after=[{page:0,text:'Inserted cover'},{page:1,text:'Title\nVoltage 5 V\nAlways enabled'},{page:2,text:'Unchanged appendix'}];
 const changes=comparePages(before,after);
 assert.equal(changes.length,2);
 assert.equal(changes[0].after[0].text,'Inserted cover');
 assert.equal(changes[1].before[0].text,'Voltage 3.3 V');
 assert.equal(changes[1].after[0].page,1);
 assert.ok(!JSON.stringify(changes).includes('Unchanged appendix'));
 assert.deepEqual(comparePages(before,before),[]);
});
