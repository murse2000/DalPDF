import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
async function hash(file){const h=createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex');}
const directory = process.argv[2] ?? 'artifacts';
const version = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json')).version;
const platforms = {};
for (const [platform, name] of [
    ['darwin-aarch64', `DalPDF-${version}-arm64.app.tar.gz`],
    ['windows-x86_64', `DalPDF-${version}-x64-setup.exe`],
]) {
    if (!fs.statSync(path.join(directory,name)).size) throw new Error('빈 업데이트 파일입니다.');
    const signature = fs.readFileSync(path.join(directory,name+'.sig'),'utf8').trim();
    if (!signature) throw new Error('업데이트 서명이 없습니다.');
    platforms[platform] = {url:`https://github.com/murse2000/DalPDF/releases/download/v${version}/${name}`, signature};
}
const notesFile = `releases/v${version}.md`;
const manifest = {version, notes:fs.readFileSync(notesFile,'utf8'), pub_date:new Date().toISOString(), platforms};
fs.writeFileSync(path.join(directory,'latest.json'), JSON.stringify(manifest,null,2)+'\n');
const files = [`DalPDF-${version}-arm64.dmg`, `DalPDF-${version}-arm64.app.tar.gz`, `DalPDF-${version}-arm64.app.tar.gz.sig`, `DalPDF-${version}-x64-setup.exe`, `DalPDF-${version}-x64-setup.exe.sig`, 'latest.json'];
fs.writeFileSync(path.join(directory,'SHA256SUMS.txt'), (await Promise.all(files.map(async name => `${await hash(path.join(directory,name))}  ${name}`))).join('\n')+'\n');
console.log(`v${version} 업데이트 피드와 체크섬 생성 완료`);
