import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const source = 'artifacts/DalPDF.app';
const target = 'artifacts/light/DalPDF.app';
const model = path.resolve(source, 'Contents/Resources/translation/model/model.gguf');
if (!fs.statSync(model).size) throw new Error('전체 설치본 모델이 없습니다.');
fs.rmSync(target, {recursive:true, force:true});
fs.cpSync(source, target, {recursive:true, filter:file => path.resolve(file) !== model});
// 번들 리소스가 달라졌으므로 경량 앱에도 새 앱 서명과 별도 업데이트 서명을 적용합니다.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', target], {stdio:'inherit'});
execFileSync('codesign', ['--verify', '--deep', '--strict', target], {stdio:'inherit'});
