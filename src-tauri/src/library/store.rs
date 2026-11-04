use super::Result;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
};

pub fn io_context(operation: &str, path: &Path, error: std::io::Error) -> std::io::Error {
    std::io::Error::new(
        error.kind(),
        format!("{operation} [{}]: {error}", path.display()),
    )
}

/// Retry only Windows access/sharing locks while retaining the prepared directory.
/// A permanent denial still fails after a bounded two-second grace period.
pub fn install_directory(source: &Path, destination: &Path) -> std::io::Result<()> {
    retry_directory_install(
        || fs::rename(source, destination),
        std::thread::sleep,
        cfg!(windows),
    )
    .map_err(|error| {
        io_context(
            &format!("Install generated edition from [{}]", source.display()),
            destination,
            error,
        )
    })
}

fn retry_directory_install(
    mut rename: impl FnMut() -> std::io::Result<()>,
    mut wait: impl FnMut(std::time::Duration),
    windows: bool,
) -> std::io::Result<()> {
    let delays = [50, 100, 200, 400, 600, 650];
    for attempt in 0..=delays.len() {
        match rename() {
            Err(error)
                if windows
                    && matches!(error.raw_os_error(), Some(5 | 32 | 33))
                    && attempt < delays.len() =>
            {
                wait(std::time::Duration::from_millis(delays[attempt]));
            }
            result => return result,
        }
    }
    unreachable!()
}

pub const MAX_SOURCE_BYTES: u64 = 512 * 1024 * 1024;
pub const CHUNK_BYTES: usize = 1024 * 1024;

pub fn hash_reader(input: impl Read) -> Result<String> {
    hash_reader_inner(input, false)
}
pub fn hash_import_reader(input: impl Read) -> Result<String> {
    hash_reader_inner(input, true)
}
fn hash_reader_inner(mut input: impl Read, cancellable: bool) -> Result<String> {
    let mut hash = Sha256::new();
    let mut buffer = [0; 65536];
    loop {
        if cancellable {
            crate::import_cancel::check()?;
        }
        let n = input.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub fn hash_id(parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    format!("{:x}", hash.finalize())
}
pub fn valid_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
pub fn object_relative(id: &str) -> Result<String> {
    if !valid_id(id) {
        return Err("Invalid source identity".into());
    }
    Ok(format!("objects/sha256/{}/{id}", &id[..2]))
}
/// All stored paths must remain relative, including after following symlinks.
pub fn checked_path(root: &Path, relative: &str) -> Result<PathBuf> {
    let path = Path::new(relative);
    if path.as_os_str().is_empty()
        || path
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
        || relative.contains(':')
        || relative.contains('\\')
    {
        return Err("Unsafe Library relative path".into());
    }
    let target = root.join(path);
    let mut ancestor = target.as_path();
    while !ancestor.exists() {
        ancestor = ancestor.parent().ok_or("Missing path parent")?;
    }
    if !dunce::canonicalize(ancestor)?.starts_with(root) {
        return Err("Library reference escapes its root".into());
    }
    Ok(target)
}
pub fn directory(root: &Path, relative: &str) -> Result<PathBuf> {
    let path = checked_path(root, relative)?;
    fs::create_dir_all(&path).map_err(|e| io_context("Create Library directory", &path, e))?;
    checked_path(root, relative)
}

pub struct Upload {
    pub id: u64,
    pub name: String,
    pub expected: u64,
    pub received: u64,
    pub file: tempfile::NamedTempFile,
    pub started: std::time::Instant,
}
impl Upload {
    pub fn append(&mut self, bytes: &[u8]) -> Result<()> {
        if bytes.len() > CHUNK_BYTES
            || self.received.saturating_add(bytes.len() as u64) > self.expected
        {
            return Err("Import chunk exceeds declared size or 1 MiB limit".into());
        }
        self.file.write_all(bytes)?;
        self.received += bytes.len() as u64;
        Ok(())
    }
}

/// Install once; never overwrite an existing immutable object.
pub fn install_source(
    root: &Path,
    upload: tempfile::NamedTempFile,
    id: &str,
) -> Result<(PathBuf, bool)> {
    let relative = object_relative(id)?;
    directory(root, &format!("objects/sha256/{}", &id[..2]))?;
    let destination = checked_path(root, &relative)?;
    if destination.exists() {
        if fs::metadata(&destination)?.len() > MAX_SOURCE_BYTES {
            return Err("Stored source exceeds size limit".into());
        }
        if hash_reader(File::open(&destination)?)? != id {
            return Err("Stored source integrity failure".into());
        }
        return Ok((destination, false));
    }
    upload.as_file().sync_all()?;
    upload
        .persist_noclobber(&destination)
        .map_err(|e| io_context("Install book source", &destination, e.error))?;
    let verified = (|| -> Result<()> {
        if hash_reader(File::open(&destination)?)? != id {
            return Err("Installed source hash mismatch".into());
        }
        Ok(())
    })();
    if let Err(error) = verified {
        let _ = fs::remove_file(&destination);
        return Err(error);
    }
    Ok((destination, true))
}

pub fn cleanup_staging(root: &Path) -> Result<()> {
    let staging = directory(root, "staging")?;
    // The exclusive Library lock permits cleanup of our abandoned staging entries.
    for entry in fs::read_dir(staging)? {
        let entry = entry?;
        if entry.file_name().to_string_lossy().starts_with("upload-")
            && entry.file_type()?.is_file()
        {
            fs::remove_file(entry.path())?;
        } else if entry
            .file_name()
            .to_string_lossy()
            .starts_with("publication-")
            && entry.file_type()?.is_dir()
        {
            let relative = format!("staging/{}", entry.file_name().to_string_lossy());
            let owned = checked_path(root, &relative)?;
            fs::remove_dir_all(owned)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod directory_install_tests {
    use super::*;

    #[test]
    fn transient_windows_lock_retries_without_republishing() {
        let mut calls = 0;
        let mut waits = vec![];
        retry_directory_install(
            || {
                calls += 1;
                if calls < 3 {
                    Err(std::io::Error::from_raw_os_error(5))
                } else {
                    Ok(())
                }
            },
            |delay| waits.push(delay.as_millis()),
            true,
        )
        .unwrap();
        assert_eq!(calls, 3);
        assert_eq!(waits, [50, 100]);
    }

    #[test]
    fn permanent_lock_is_bounded_and_other_errors_are_immediate() {
        for (windows, code, expected_calls) in [
            (true, 5, 7),
            (true, 32, 7),
            (true, 33, 7),
            (true, 3, 1),
            (false, 5, 1),
        ] {
            let mut calls = 0;
            let mut elapsed = 0;
            let error = retry_directory_install(
                || {
                    calls += 1;
                    Err(std::io::Error::from_raw_os_error(code))
                },
                |delay| elapsed += delay.as_millis(),
                windows,
            )
            .unwrap_err();
            assert_eq!(error.raw_os_error(), Some(code));
            assert_eq!(calls, expected_calls);
            assert_eq!(elapsed, if expected_calls == 7 { 2000 } else { 0 });
        }
    }

    #[cfg(windows)]
    #[test]
    fn real_windows_file_lock_releases_during_install() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("prepared");
        let target = root.path().join("edition");
        fs::create_dir(&source).unwrap();
        let file = source.join("manifest.json");
        fs::write(&file, b"saved edition").unwrap();
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(1)
            .open(&file)
            .unwrap();
        let error = fs::rename(&source, &target).unwrap_err();
        assert!(matches!(error.raw_os_error(), Some(5 | 32 | 33)));
        let release = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            drop(lock);
        });
        let result = install_directory(&source, &target);
        release.join().unwrap();
        result.unwrap();
        assert_eq!(
            fs::read(target.join("manifest.json")).unwrap(),
            b"saved edition"
        );
    }

    #[test]
    fn installs_directory_without_replacing_existing_edition() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("prepared");
        let target = root.path().join("edition");
        fs::create_dir(&source).unwrap();
        fs::write(source.join("manifest.json"), b"original").unwrap();
        install_directory(&source, &target).unwrap();
        assert!(!source.exists());
        fs::create_dir(&source).unwrap();
        fs::write(source.join("manifest.json"), b"different").unwrap();
        assert!(install_directory(&source, &target).is_err());
        assert_eq!(fs::read(target.join("manifest.json")).unwrap(), b"original");
        assert_eq!(
            fs::read(source.join("manifest.json")).unwrap(),
            b"different"
        );
    }
}
