import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type AvailableUpdate = { version: string; notes: string };
type Hooks = { isBusy: () => boolean; hasUnsaved: () => boolean; setInstalling: (value: boolean) => void; notify: (message: string, error?: boolean) => void };

export function initializeUpdater(hooks: Hooks) {
    let checking = false, installing = false;
    let available: AvailableUpdate | null = null;
    let offered = "";
    const banner = document.createElement('aside');
    banner.className = 'update-banner glass'; banner.hidden = true;
    banner.setAttribute('aria-live', 'polite'); document.body.append(banner);

    async function showConfirmation() {
        if (!available || installing) return;
        if (hooks.isBusy() || hooks.hasUnsaved()) { hooks.notify('작업을 마치고 편집·번역 결과를 저장한 뒤 업데이트해 주세요.'); return; }
        if (document.querySelector('.update-dialog')) return;
        const selected = available;
        const dialog = document.createElement('dialog'); dialog.className = 'update-dialog';
        dialog.innerHTML = '<h2>새 버전이 있습니다</h2><p class="update-version"></p><pre class="update-notes"></pre><p>동의하면 업데이트를 다운로드하고 서명을 검증한 뒤 설치합니다. 설치 후 앱이 다시 시작됩니다.</p><p class="update-status" role="status"></p><div><button class="button" data-later>나중에</button><button class="button primary" data-install>업데이트 설치</button></div>';
        dialog.querySelector('.update-version')!.textContent = `DalPDF ${selected.version}`;
        dialog.querySelector('.update-notes')!.textContent = selected.notes;
        document.body.append(dialog); dialog.showModal();
        const later = dialog.querySelector<HTMLButtonElement>('[data-later]')!;
        const install = dialog.querySelector<HTMLButtonElement>('[data-install]')!;
        const status = dialog.querySelector<HTMLElement>('.update-status')!;
        later.onclick = () => dialog.close();
        dialog.addEventListener('close', () => dialog.remove(), {once: true});
        dialog.addEventListener('cancel', event => { if (installing) event.preventDefault(); });
        install.onclick = async () => {
            if (hooks.isBusy() || hooks.hasUnsaved() || installing) { hooks.notify('작업을 마치고 편집·번역 결과를 저장해 주세요.'); return; }
            installing = true; hooks.setInstalling(true); install.disabled = later.disabled = true;
            status.textContent = '업데이트를 다운로드하고 있습니다…';
            const unlisten: (() => void)[] = [];
            try {
                unlisten.push(await listen<[number, number | null]>('update-progress', ({payload: [done, total]}) => {
                    status.textContent = total ? `업데이트 다운로드 ${Math.min(100, Math.round(done / total * 100))}%` : `업데이트 다운로드 ${(done / 1048576).toFixed(1)} MB`;
                }));
                unlisten.push(await listen('update-installing', () => { status.textContent = '서명 검증 완료 · 설치 후 다시 시작합니다…'; }));
                // 다운로드와 설치 명령은 사용자가 이 버튼을 누른 뒤에만 호출합니다.
                await invoke('install_update', {version: selected.version});
            } catch (error) {
                status.textContent = `업데이트하지 못했습니다: ${String(error)}`;
            } finally {
                unlisten.forEach(stop => stop()); installing = false; hooks.setInstalling(false);
                install.disabled = later.disabled = false;
            }
        };
    }

    async function checkForUpdates(manual = false) {
        if (checking || installing) return;
        checking = true;
        try {
            available = await invoke<AvailableUpdate | null>('check_update');
            banner.replaceChildren(); banner.hidden = !available;
            if (available) {
                const message = document.createElement('span'); message.textContent = `DalPDF ${available.version} 새 버전이 있습니다.`;
                const button = document.createElement('button'); button.className = 'button primary'; button.textContent = '업데이트 확인';
                button.onclick = () => { void showConfirmation(); }; banner.append(message, button);
                if (manual || offered !== available.version && !hooks.isBusy() && !hooks.hasUnsaved()) { offered=available.version; await showConfirmation(); }
            } else if (manual) hooks.notify('현재 최신 버전을 사용하고 있습니다.');
        } catch (error) {
            if (manual) hooks.notify(`업데이트 확인 실패: ${String(error)}`, true);
        } finally { checking = false; }
    }
    return checkForUpdates;
}
