import test from 'node:test';
import assert from 'node:assert/strict';
import { activePage } from '../src/geometry.ts';
test('마지막 페이지 이동 시 이전 페이지 끝 2px가 보여도 마지막 페이지를 선택한다', () => {
  assert.equal(activePage([28,1046,2064],[1000,1000,1000],2044,700,1,2),2);
});
test('두 페이지 경계에서 더 넓게 보이는 페이지를 선택한다', () => {
  assert.equal(activePage([28,1046],[1000,1000],650,700,0,1),0);
  assert.equal(activePage([28,1046],[1000,1000],800,700,0,1),1);
});
