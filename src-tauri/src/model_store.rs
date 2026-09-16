use sha2::{Digest, Sha256};
use std::{fs::File, io::{Read, Write}, path::{Path, PathBuf}};

pub const MODEL_SHA256: &str = include_str!("../model.sha256");
pub struct Store { pub base: PathBuf, pub cache: PathBuf }

pub fn model_path(base: &Path, cache: &Path) -> PathBuf {
    let bundled = base.join("translation/model/model.gguf");
    if bundled.is_file() { bundled } else { cache.join(format!("{}.gguf", MODEL_SHA256.trim())) }
}

fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 65536];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

// 앱 번들 교체와 Windows 제거 단계가 끝나도 모델은 사용자 데이터 폴더에 남습니다.
pub fn preserve(base: &Path, cache: &Path, expected: &str) -> std::io::Result<()> {
    let target = cache.join(format!("{expected}.gguf"));
    if hash_file(&target).is_ok_and(|hash| hash == expected) { return Ok(()); }
    let source = base.join("translation/model/model.gguf");
    std::fs::create_dir_all(cache)?;
    let mut temporary = tempfile::NamedTempFile::new_in(cache)?;
    std::io::copy(&mut File::open(source)?, &mut temporary)?;
    temporary.flush()?;
    temporary.as_file().sync_all()?;
    if hash_file(temporary.path())? != expected {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "내장 AI 모델의 검증에 실패했습니다."));
    }
    temporary.persist(&target).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_survives_bundle_removal_and_rejects_corruption() {
        let temp = tempfile::tempdir().unwrap();
        let base = temp.path().join("app");
        let source = base.join("translation/model/model.gguf");
        std::fs::create_dir_all(source.parent().unwrap()).unwrap();
        std::fs::write(&source, b"model").unwrap();
        let expected = hash_file(&source).unwrap();
        let cache = temp.path().join("cache");
        preserve(&base, &cache, &expected).unwrap();
        std::fs::remove_dir_all(&base).unwrap();
        preserve(&base, &cache, &expected).unwrap();
        // 두 번째 경량 업데이트도 번들 모델 없이 같은 캐시를 재사용합니다.
        preserve(&base, &cache, &expected).unwrap();
        assert!(preserve(&base, &cache, "different-model").is_err());
        assert_eq!(hash_file(&cache.join(format!("{expected}.gguf"))).unwrap(), expected);
        std::fs::write(cache.join(format!("{expected}.gguf")), b"broken").unwrap();
        assert!(preserve(&base, &cache, &expected).is_err());
    }
    #[test]
    fn invalid_bundle_is_not_committed_as_cache() {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("translation/model/model.gguf");
        std::fs::create_dir_all(source.parent().unwrap()).unwrap();
        std::fs::write(source, b"invalid").unwrap();
        let cache = temp.path().join("cache");
        assert!(preserve(temp.path(), &cache, MODEL_SHA256.trim()).is_err());
        assert_eq!(std::fs::read_dir(cache).unwrap().count(), 0);
    }
}
