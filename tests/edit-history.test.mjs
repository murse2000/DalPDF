import test from 'node:test';
import assert from 'node:assert/strict';
import {EditHistory} from '../src/edit-history.ts';

test('메모 생성·이동·삭제의 실행 취소와 재실행은 번역 결과를 보존한다',()=>{
 const history=new EditHistory();
 for(const operation of ['add_note','move_annotation','edit_annotation','delete_annotation'])assert.equal(history.commit(operation),true);
 for(let i=0;i<4;i++)assert.equal(history.commit('undo'),true);
 for(let i=0;i<4;i++)assert.equal(history.commit('redo'),true);
});
test('본문 변경은 번역을 초기화하고 주석 변경과 섞인 이력도 구분한다',()=>{
 const history=new EditHistory();
 assert.equal(history.commit('text'),false);assert.equal(history.commit('add_highlight'),true);
 assert.equal(history.commit('undo'),true);assert.equal(history.commit('undo'),false);
 assert.equal(history.commit('redo'),false);assert.equal(history.commit('redo'),true);
});
test('실패한 요청은 이력에 기록하지 않으며 새 변경은 재실행 이력을 지운다',async()=>{
 const history=new EditHistory();history.commit('add_note');
 await assert.rejects(Promise.reject(new Error('편집 실패')).then(()=>history.commit('text')));
 assert.equal(history.commit('undo'),true);
 history.commit('text');assert.equal(history.commit('undo'),false);
 assert.equal(history.commit('redo'),false);
 history.reset();assert.equal(history.commit('undo'),false);
});
test('엔진과 같은 20개 이력 한도를 유지한다',()=>{
 const history=new EditHistory();history.commit('text');
 for(let i=0;i<20;i++)history.commit('add_note');
 for(let i=0;i<20;i++)assert.equal(history.commit('undo'),true);
 assert.equal(history.commit('undo'),false);
});
