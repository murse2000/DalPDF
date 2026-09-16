import { invoke } from '@tauri-apps/api/core';

const preference = 'dalpdf-default-pdf-do-not-ask';
type Hooks = { isBusy: () => boolean; notify: (message: string) => void };

export async function offerDefaultPdfApp(hooks: Hooks): Promise<void> {
    if (localStorage.getItem(preference) === 'true') return;
    try { if (await invoke<boolean>('is_default_pdf_app')) return; }
    catch { return; }
    // 업데이트/문서 확인창과 겹치지 않으며 작업이 끝난 뒤 한 번만 묻습니다.
    while (hooks.isBusy() || document.querySelector('dialog[open]')) {
        await new Promise(resolve => window.setTimeout(resolve, 1000));
    }
    const dialog = document.createElement('dialog');
    dialog.className = 'default-app-dialog';
    dialog.innerHTML = '<h2>기본 PDF 앱으로 설정할까요?</h2><p>PDF 파일을 DalPDF로 엽니다.</p><p data-status role="status"></p><div class="dialog-actions"><button data-never>다시 묻지 않기</button><button data-later>나중에</button><button class="primary" data-set>기본으로 설정</button></div>';
    document.body.append(dialog); dialog.showModal();
    const status = dialog.querySelector<HTMLElement>('[data-status]')!;
    const set = dialog.querySelector<HTMLButtonElement>('[data-set]')!;
    const later = dialog.querySelector<HTMLButtonElement>('[data-later]')!;
    const never = dialog.querySelector<HTMLButtonElement>('[data-never]')!;
    let setting = false;
    const recheck = async () => {
        try { if (await invoke<boolean>('is_default_pdf_app')) { dialog.close(); hooks.notify('기본 PDF 앱으로 설정했습니다.'); } }
        catch { /* 설정 화면을 닫은 뒤 다시 시도할 수 있습니다. */ }
    };
    dialog.addEventListener('close', () => { window.removeEventListener('focus', recheck); dialog.remove(); }, {once:true});
    dialog.addEventListener('cancel', event => { if (setting) event.preventDefault(); });
    later.onclick = () => dialog.close();
    never.onclick = () => { localStorage.setItem(preference, 'true'); dialog.close(); };
    set.onclick = async () => {
        if (setting) return;
        setting = true; set.disabled = later.disabled = never.disabled = true;
        try {
            if (await invoke<boolean>('set_default_pdf_app')) { dialog.close(); hooks.notify('기본 PDF 앱으로 설정했습니다.'); }
            else {
                status.textContent = '기본 앱 설정에서 .pdf를 DalPDF로 선택해 주세요.';
                window.addEventListener('focus', recheck);
            }
        } catch (error) { status.textContent = String(error); }
        finally { setting = false; set.disabled = later.disabled = never.disabled = false; }
    };
}
