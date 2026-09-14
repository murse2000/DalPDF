import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const version = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json')).version;
const platform = process.argv[2];
const environment = {...process.env, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? ''};
const key = environment.TAURI_SIGNING_PRIVATE_KEY;
if (!key) throw new Error('업데이트 서명 키가 필요합니다.');
if (fs.existsSync(key)) environment.TAURI_SIGNING_PRIVATE_KEY = fs.readFileSync(key, 'utf8');
fs.mkdirSync('artifacts', {recursive:true});
let output;
if (platform === 'macos') {
    output = `artifacts/DalPDF-${version}-arm64.app.tar.gz`;
    // 최종 앱 서명이 포함된 번들을 묶은 뒤 업데이트 서명을 생성합니다.
    execFileSync('tar', ['-czf', output, '-C', 'artifacts', 'DalPDF.app'], {env:{...environment, COPYFILE_DISABLE:'1'}});
} else if (platform === 'windows') {
    output = `artifacts/DalPDF-${version}-x64-setup.exe`;
    fs.copyFileSync(process.argv[3] ?? `src-tauri/target/release/bundle/nsis/DalPDF_${version}_x64-setup.exe`, output);
} else throw new Error('macos 또는 windows를 지정하세요.');
// 키 내용은 명령행 인자나 출력에 포함하지 않습니다.
execFileSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'signer', 'sign', output], {env:environment, stdio:'pipe'});
if (!fs.existsSync(output+'.sig')) throw new Error('업데이트 서명 생성에 실패했습니다.');
console.log(`${path.basename(output)} 업데이트 서명 완료`);
