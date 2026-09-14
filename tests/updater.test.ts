// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from 'vitest';
import { initializeUpdater } from '../src/updater';
import { invoke } from '@tauri-apps/api/core';
vi.mock('@tauri-apps/api/core', () => ({invoke: vi.fn()}));
vi.mock('@tauri-apps/api/event', () => ({listen: vi.fn(async () => () => {})}));
const mockedInvoke = vi.mocked(invoke);
let busy: boolean;
let unsaved: boolean;
let notify: ReturnType<typeof vi.fn>;
let setInstalling: ReturnType<typeof vi.fn>;
beforeEach(() => {
    document.body.replaceChildren(); vi.clearAllMocks(); busy = false; unsaved = false;
    notify = vi.fn(); setInstalling = vi.fn(value => { busy = value; });
    HTMLDialogElement.prototype.showModal = function() { this.open = true; };
    HTMLDialogElement.prototype.close = function() { this.open = false; this.dispatchEvent(new Event('close')); };
    mockedInvoke.mockResolvedValue({version:'0.1.2', notes:'<script>실행되지 않는 릴리스 설명</script>'});
});
const start = () => initializeUpdater({isBusy: () => busy, hasUnsaved: () => unsaved, setInstalling, notify});
test('자동 확인은 알림만 표시하고 설치하지 않는다', async () => {
    await start()();
    expect(document.querySelector('.update-banner')?.textContent).toContain('0.1.2');
    expect(mockedInvoke.mock.calls).toEqual([['check_update']]);
    expect(document.querySelector('dialog')).not.toBeNull();
});
test('나중에를 선택하면 다운로드를 시작하지 않는다', async () => {
    const check = start(); await check(true);
    expect(document.querySelector('.update-notes script')).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-later]')!.click();
    expect(document.querySelector('dialog')).toBeNull();
    expect(mockedInvoke.mock.calls).toEqual([['check_update']]);
});
test('파일 작업 중에는 설치 확인창을 열지 않는다', async () => {
    busy = true; await start()(true);
    expect(document.querySelector('dialog')).toBeNull();
    expect(notify).toHaveBeenCalled();
    expect(mockedInvoke).toHaveBeenCalledTimes(1);
});
test('명시적인 동의 후에만 선택한 버전을 설치하고 실패 시 작업 잠금을 푼다', async () => {
    await start()(true);
    mockedInvoke.mockRejectedValueOnce(new Error('잘못된 서명'));
    document.querySelector<HTMLButtonElement>('[data-install]')!.click();
    await vi.waitFor(() => expect(document.querySelector('.update-status')?.textContent).toContain('잘못된 서명'));
    expect(mockedInvoke).toHaveBeenLastCalledWith('install_update', {version:'0.1.2'});
    expect(setInstalling.mock.calls).toEqual([[true], [false]]);
    expect(busy).toBe(false);
});
test('최신 버전이면 업데이트를 제안하지 않는다', async () => {
    mockedInvoke.mockResolvedValueOnce(null); await start()(true);
    expect(document.querySelector<HTMLElement>('.update-banner')!.hidden).toBe(true);
    expect(notify).toHaveBeenCalledWith('현재 최신 버전을 사용하고 있습니다.');
});
test('확인창을 연 뒤 파일 작업이 시작돼도 동의 시점에 설치를 차단한다', async () => {
    await start()(true); busy = true;
    document.querySelector<HTMLButtonElement>('[data-install]')!.click();
    expect(mockedInvoke.mock.calls).toEqual([['check_update']]);
    expect(setInstalling).not.toHaveBeenCalled();
});

test('저장하지 않은 편집이나 번역 결과가 있으면 설치를 막는다', async () => {
 unsaved=true;await start()(true);
 expect(document.querySelector('dialog')).toBeNull();
 expect(mockedInvoke.mock.calls).toEqual([['check_update']]);
});
test('동의 직전에 번역 결과가 생겨도 설치하지 않는다', async () => {
 await start()(true);unsaved=true;
 document.querySelector<HTMLButtonElement>('[data-install]')!.click();
 expect(mockedInvoke.mock.calls).toEqual([['check_update']]);
});
test('나중에 선택한 버전의 자동 확인창은 반복하지 않는다', async () => {
 const check=start();await check();
 document.querySelector<HTMLButtonElement>('[data-later]')!.click();await check();
 expect(document.querySelector('dialog')).toBeNull();
 expect(mockedInvoke.mock.calls.every(call=>call[0]==='check_update')).toBe(true);
});
