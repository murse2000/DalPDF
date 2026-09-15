import test from 'node:test';
import assert from 'node:assert/strict';
import { activePage, wheelZoom } from '../src/geometry.ts';
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
