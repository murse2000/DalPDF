import test from 'node:test';
import assert from 'node:assert/strict';
import { activePage, wheelZoom, documentLayout } from '../src/geometry.ts';
test('마지막 페이지 이동 시 이전 페이지 끝 2px가 보여도 마지막 페이지를 선택한다', () => {
  assert.equal(activePage([28,1046,2064],[1000,1000,1000],2044,700,1,2),2);
});
test('두 페이지 경계에서 더 넓게 보이는 페이지를 선택한다', () => {
  assert.equal(activePage([28,1046],[1000,1000],650,700,0,1),0);
  assert.equal(activePage([28,1046],[1000,1000],800,700,0,1),1);
});
test('휠 위로 확대하고 아래로 축소하며 같은 양을 되돌리면 배율을 복원한다', () => {
  const enlarged=wheelZoom(1,-50,0,800);
  assert.ok(enlarged>1);
  assert.ok(Math.abs(wheelZoom(enlarged,50,0,800)-1)<1e-12);
});
test('휠 단위를 정규화하고 확대 범위를 25~300%로 제한한다', () => {
  assert.equal(wheelZoom(1,3,1,800),wheelZoom(1,48,0,800));
  assert.equal(wheelZoom(1,0.1,2,800),wheelZoom(1,80,0,800));
  assert.equal(wheelZoom(3,-100,0,800),3);
  assert.equal(wheelZoom(.25,100,0,800),.25);
  assert.equal(wheelZoom(1,0,0,800),1);
});

test('42페이지부터 가로 페이지인 데이터시트도 너비 맞춤에서 모든 페이지를 가운데 표시한다', () => {
  const pages = Array.from({length:128},(_,n)=>n>=41&&n<=43?{width:842,height:595}:{width:595,height:842});
  const layout = documentLayout(pages,1086,null);
  assert.equal(layout.width,1086);
  for(const width of layout.widths) {
    assert.ok(Math.abs(width-1014)<1e-9);
    assert.ok(Math.abs((layout.width-width)/2-36)<1e-9);
  }
  assert.ok(layout.heights[41]<layout.heights[0]);
  assert.equal(layout.offsets[42],layout.offsets[41]+layout.heights[41]+18);
});
test('확대 후 좁은 창에서 다시 너비 맞춤하면 가로 스크롤 없이 페이지가 들어간다', () => {
  const pages=[{width:595,height:842},{width:842,height:595}];
  const enlarged=documentLayout(pages,1086,2);
  assert.deepEqual(enlarged.widths,[1190,1684]);
  assert.equal(enlarged.width,1756);
  const fitted=documentLayout(pages,300,null);
  assert.equal(fitted.width,300);
  for(const width of fitted.widths)assert.ok(Math.abs(width-228)<1e-9);
});
