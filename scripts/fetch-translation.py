"""빌드 시 번역 엔진과 모델을 내려받아 해시를 검증합니다. 앱에서는 다운로드하지 않습니다."""
import hashlib
import json
import pathlib
import subprocess
import sys
import tarfile
import tempfile
import zipfile

sys.stdout.reconfigure(encoding='utf-8')

root = pathlib.Path(__file__).resolve().parents[1] / 'src-tauri' / 'translation'
platform = sys.argv[1] if len(sys.argv) > 1 else ('windows' if sys.platform == 'win32' else 'mac')
assets = {
    'mac': ('llama-b10809-bin-macos-arm64.tar.gz', '7d692df9e1e386e62f1c12b843903218041e6cd74c9415aa39a7ed3176f9eaa2'),
    'windows': ('llama-b10809-bin-win-cpu-x64.zip', '9df3158ed228a641a4b127942d7f459f24c9e13f04682659d05c00c80099b6b5'),
    'windows-vulkan': ('llama-b10809-bin-win-vulkan-x64.zip', '97e50b3ef0cdd2cb4d5afd446a9006b3496bee6c0d0ba7083d32f36075771870')
}
def digest(path):
    with path.open('rb') as file:
        return hashlib.file_digest(file, 'sha256').hexdigest()
def download(url, path, sha=None):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and (sha is None or digest(path) == sha):
        return
    temporary = path.with_suffix(path.suffix + '.part')
    subprocess.run(['curl', '-fL', '--retry', '3', '-o', str(temporary), url], check=True)
    if sha and digest(temporary) != sha:
        temporary.unlink()
        raise RuntimeError('다운로드 파일의 SHA256이 일치하지 않습니다.')
    temporary.replace(path)
name, sha = assets[platform]
with tempfile.TemporaryDirectory(prefix='dalpdf-translation-') as folder:
    archive = pathlib.Path(folder) / name
    download('https://github.com/ggml-org/llama.cpp/releases/download/b10809/' + name, archive, sha)
    destination = root / platform
    destination.mkdir(parents=True, exist_ok=True)
    if name.endswith('.zip'):
        with zipfile.ZipFile(archive) as file:
            file.extractall(destination)
    else:
        with tarfile.open(archive) as file:
            file.extractall(destination, filter='data')
if platform.startswith('windows'):
    download('https://raw.githubusercontent.com/ggml-org/llama.cpp/b10809/LICENSE', destination / 'LICENSE', '94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d')
download('https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q3_K_S.gguf', root / 'model/model.gguf', '0ce20058cc0ed6b6c9213bb383589327e458c12ffce0842fc96867042d669c75')
download('https://huggingface.co/Qwen/Qwen3-4B-Instruct-2507/resolve/main/LICENSE', root / 'model/LICENSE')
print('내장 번역 엔진과 모델 검증 완료:', platform)
if platform == 'windows':
    subprocess.run([sys.executable, __file__, 'windows-vulkan'], check=True)
