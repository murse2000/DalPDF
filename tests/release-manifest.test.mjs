import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

test('전체/경량 파일 모두 서명된 피드와 체크섬에 포함된다', () => {
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dalpdf-release-'));
    const version=JSON.parse(fs.readFileSync('package.json')).version;
    const assets=[`DalPDF-${version}-arm64.dmg`, ...['arm64.app.tar.gz','arm64-light.app.tar.gz','x64-setup.exe','x64-light-setup.exe'].flatMap(suffix=>[`DalPDF-${version}-${suffix}`,`DalPDF-${version}-${suffix}.sig`])];
    try {
        for(const name of assets) fs.writeFileSync(path.join(directory,name),'fixture');
        execFileSync(process.execPath,['scripts/release-manifest.mjs',directory]);
        const manifest=JSON.parse(fs.readFileSync(path.join(directory,'latest.json')));
        assert.equal(manifest.lightweight.model_sha256,fs.readFileSync('src-tauri/model.sha256','utf8').trim());
        assert.match(manifest.platforms['windows-x86_64'].url,/x64-setup.exe$/);
        assert.match(manifest.lightweight.platforms['windows-x86_64'].url,/x64-light-setup.exe$/);
        assert.match(manifest.lightweight.platforms['darwin-aarch64'].url,/arm64-light.app.tar.gz$/);
        const hashes=fs.readFileSync(path.join(directory,'SHA256SUMS.txt'),'utf8');
        for(const name of [...assets,'latest.json']) assert.ok(hashes.includes(`  ${name}\n`));
        const hook=fs.readFileSync('src-tauri/installer-light-hooks.nsh','utf8');
        assert.ok(hook.includes('!define /file DALPDF_MODEL_SHA256'));
        assert.ok(hook.includes('model.sha256'));
        assert.ok(hook.includes('${DALPDF_MODEL_SHA256}.gguf'));
    } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
