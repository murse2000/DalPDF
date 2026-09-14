// 고정된 PDFium 바이너리와 라이선스를 함께 내려받습니다.
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const windows = process.argv.includes('--windows') || process.platform === 'win32';
const target = windows ? 'win-x64' : process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
const folder = `${root}src-tauri/${windows ? 'pdfium-win' : 'pdfium'}`;
mkdirSync(folder, {recursive:true});
const response = await fetch(`https://github.com/bblanchon/pdfium-binaries/releases/download/chromium/8044/pdfium-${target}.tgz`);
if (!response.ok) throw new Error(`PDFium 다운로드 실패: ${response.status}`);
const archive = `${folder}/download.tgz`;
writeFileSync(archive, Buffer.from(await response.arrayBuffer()));
execFileSync('tar', ['-xzf',archive,'-C',folder]);
rmSync(archive);
