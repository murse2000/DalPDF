// @vitest-environment jsdom
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {invoke} from '@tauri-apps/api/core';
import {offerDefaultPdfApp} from '../src/default-app';
vi.mock('@tauri-apps/api/core',()=>({invoke:vi.fn()}));
const native=vi.mocked(invoke);
const notify=vi.fn();
const start=()=>offerDefaultPdfApp({isBusy:()=>false,notify});
beforeEach(()=>{
 document.body.replaceChildren();localStorage.clear();vi.clearAllMocks();native.mockResolvedValue(false);
 HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new Event('close'));};
});
afterEach(()=>{document.querySelectorAll('dialog').forEach(d=>d.close());vi.useRealTimers();});
test('기본 앱이면 묻지 않고 조회만 한다',async()=>{
 native.mockResolvedValue(true);await start();expect(document.querySelector('dialog')).toBeNull();expect(native.mock.calls).toEqual([['is_default_pdf_app']]);
});
test('나중에는 설정을 변경하지 않는다',async()=>{
 await start();document.querySelector<HTMLButtonElement>('[data-later]')!.click();expect(native.mock.calls).toEqual([['is_default_pdf_app']]);expect(document.querySelector('dialog')).toBeNull();
});
test('다시 묻지 않기를 선택하면 다음 시작에 확인창을 띄우지 않는다',async()=>{
 await start();document.querySelector<HTMLButtonElement>('[data-never]')!.click();await start();expect(native).toHaveBeenCalledTimes(1);expect(document.querySelector('dialog')).toBeNull();
});
test('명시적 동의 후에만 변경하고 실제 기본 앱 확인 후 완료를 알린다',async()=>{
 await start();native.mockResolvedValueOnce(true);document.querySelector<HTMLButtonElement>('[data-set]')!.click();await vi.waitFor(()=>expect(notify).toHaveBeenCalledWith('기본 PDF 앱으로 설정했습니다.'));
 expect(native.mock.calls).toEqual([['is_default_pdf_app'],['set_default_pdf_app']]);expect(document.querySelector('dialog')).toBeNull();
});
test('Windows 설정을 연 것만으로 성공 처리하지 않고 돌아왔을 때 다시 조회한다',async()=>{
 await start();document.querySelector<HTMLButtonElement>('[data-set]')!.click();await vi.waitFor(()=>expect(document.querySelector('[data-status]')!.textContent).toContain('.pdf'));
 expect(notify).not.toHaveBeenCalled();native.mockResolvedValueOnce(true);window.dispatchEvent(new Event('focus'));await vi.waitFor(()=>expect(notify).toHaveBeenCalledOnce());
 expect(native.mock.calls.at(-1)).toEqual(['is_default_pdf_app']);
});
test('다른 확인창이 닫힌 뒤에만 기본 앱 확인창을 띄운다',async()=>{
 vi.useFakeTimers();const other=document.createElement('dialog');document.body.append(other);other.showModal();const pending=start();await vi.advanceTimersByTimeAsync(1000);
 expect(document.querySelector('.default-app-dialog')).toBeNull();other.close();await vi.advanceTimersByTimeAsync(1000);await pending;expect(document.querySelector('.default-app-dialog')).not.toBeNull();
});
test('설정 실패는 오류를 표시하고 기본 앱 변경 성공으로 알리지 않는다',async()=>{
 await start();native.mockRejectedValueOnce('설정 오류');document.querySelector<HTMLButtonElement>('[data-set]')!.click();await vi.waitFor(()=>expect(document.querySelector('[data-status]')!.textContent).toBe('설정 오류'));expect(notify).not.toHaveBeenCalled();
});
