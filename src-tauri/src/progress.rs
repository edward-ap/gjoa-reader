use crate::reader::document::Result;
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

pub struct ProgressState(pub Arc<Mutex<ProgressStore>>);

pub struct ProgressStore {
    path: Result<PathBuf>,
    data: Value,
    loaded: bool,
    blocked: Option<String>,
}

impl ProgressStore {
    pub fn new(path: Result<PathBuf>) -> Self {
        Self {
            path,
            data: json!({"version": 1, "books": {}}),
            loaded: false,
            blocked: None,
        }
    }

    fn ensure_loaded(&mut self) {
        if self.loaded {
            return;
        }
        self.loaded = true;
        let result = (|| -> Result<Option<Value>> {
            let path = self.path.as_ref().map_err(Clone::clone)?;
            let bytes = match std::fs::read(path) {
                Ok(bytes) => bytes,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
                Err(error) => return Err(format!("Cannot read progress: {error}")),
            };
            let data: Value = serde_json::from_slice(&bytes)
                .map_err(|error| format!("Malformed progress JSON: {error}"))?;
            if data.get("version").and_then(Value::as_u64) != Some(1)
                || !data.get("books").is_some_and(Value::is_object)
            {
                return Err("Unsupported progress schema; original file preserved".into());
            }
            Ok(Some(data))
        })();
        match result {
            Ok(Some(data)) => self.data = data,
            Ok(None) => {}
            Err(error) => self.blocked = Some(error),
        }
    }

    pub fn restore(&mut self, identity: &str, page_count: usize) -> (usize, Option<String>) {
        self.ensure_loaded();
        let record = self.data["books"].get(identity);
        let mut warning = self.blocked.clone();
        let saved = match record {
            None => 0,
            Some(record) => match record.get("pageIndex").and_then(Value::as_u64) {
                Some(index) => index,
                None => {
                    warning = Some("Invalid saved page; opening first page. Other progress records are preserved.".into());
                    0
                }
            },
        };
        (
            saved.min(page_count.saturating_sub(1) as u64) as usize,
            warning,
        )
    }

    /// Read-only legacy import seed. Missing/invalid records remain untouched.
    pub fn existing(&mut self, identity: &str) -> Option<usize> {
        self.ensure_loaded();
        if self.blocked.is_some() {
            return None;
        }
        self.data["books"]
            .get(identity)?
            .get("pageIndex")?
            .as_u64()
            .and_then(|n| usize::try_from(n).ok())
    }

    pub fn save(&mut self, identity: &str, page_index: usize, page_count: usize) -> Result<()> {
        if identity.is_empty() || page_index >= page_count {
            return Err("Invalid book progress/page range".into());
        }
        self.ensure_loaded();
        // Keep a session's progress even if disk writes fail; never discard other records.
        self.data["books"][identity] = json!({"pageIndex": page_index});
        if let Some(error) = &self.blocked {
            return Err(format!("{error}; progress is only kept in memory"));
        }
        let path = self.path.as_ref().map_err(Clone::clone)?;
        let parent = path.parent().ok_or("Progress path has no parent")?;
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Cannot create progress directory: {error}"))?;
        let mut temporary =
            tempfile::NamedTempFile::new_in(parent).map_err(|error| error.to_string())?;
        serde_json::to_writer_pretty(temporary.as_file_mut(), &self.data)
            .map_err(|error| error.to_string())?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|error| error.to_string())?;
        // Replace only after a complete JSON file has been written and synced.
        temporary
            .persist(path)
            .map_err(|error| format!("Cannot replace progress file: {}", error.error))?;
        Ok(())
    }
}

pub fn book_identity(path: &std::path::Path) -> String {
    let identity = path.to_string_lossy().into_owned();
    #[cfg(windows)]
    let identity = identity.to_lowercase();
    identity
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_and_independent_records_survive_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested/progress.json");
        let mut store = ProgressStore::new(Ok(path.clone()));
        assert_eq!(store.restore("C:/a/book.djvu", 200), (0, None));
        store.save("C:/a/book.djvu", 99, 200).unwrap();
        store.save("C:/b/book.djvu", 49, 100).unwrap();
        let mut reopened = ProgressStore::new(Ok(path));
        assert_eq!(reopened.restore("C:/a/book.djvu", 200), (99, None));
        assert_eq!(reopened.restore("C:/b/book.djvu", 100), (49, None));
        assert_eq!(reopened.restore("C:/a/book.djvu", 20), (19, None));
        assert!(reopened.save("C:/a/book.djvu", 20, 20).is_err());
        assert_eq!(reopened.restore("C:/a/book.djvu", 200).0, 99);
    }

    #[test]
    fn malformed_json_and_unsupported_schema_are_never_overwritten() {
        for text in [
            "{broken",
            r#"{"version":2,"books":{}}"#,
            r#"{"version":1,"books":null}"#,
        ] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("progress.json");
            std::fs::write(&path, text).unwrap();
            let mut store = ProgressStore::new(Ok(path.clone()));
            assert!(store.restore("book", 10).1.is_some());
            assert!(store.save("book", 3, 10).is_err());
            assert_eq!(store.restore("book", 10).0, 3);
            assert_eq!(std::fs::read_to_string(path).unwrap(), text);
        }
    }

    #[test]
    fn malformed_record_preserved_while_other_book_is_updated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.json");
        let bad = json!({"pageIndex": -3, "note": "keep me"});
        std::fs::write(
            &path,
            json!({"version":1,"books":{"bad":bad},"extension":"keep"}).to_string(),
        )
        .unwrap();
        let mut store = ProgressStore::new(Ok(path.clone()));
        assert_eq!(store.restore("bad", 10).0, 0);
        assert!(store.restore("bad", 10).1.is_some());
        store.save("good", 4, 10).unwrap();
        let written: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        assert_eq!(written["books"]["bad"], bad);
        assert_eq!(written["extension"], "keep");
    }

    #[test]
    fn failed_replace_preserves_existing_target_and_session_progress() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("progress.json");
        let mut store = ProgressStore::new(Ok(path.clone()));
        store.restore("book", 10);
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("keep"), "original").unwrap();
        assert!(store.save("book", 4, 10).is_err());
        assert_eq!(
            std::fs::read_to_string(path.join("keep")).unwrap(),
            "original"
        );
        assert_eq!(store.restore("book", 10).0, 4);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn canonical_identity_distinguishes_folders_and_normalizes_dot_segments() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("a")).unwrap();
        std::fs::create_dir(dir.path().join("b")).unwrap();
        for folder in ["a", "b"] {
            std::fs::write(dir.path().join(folder).join("book.djvu"), "test").unwrap();
        }
        let a = dunce::canonicalize(dir.path().join("a/book.djvu")).unwrap();
        let b = dunce::canonicalize(dir.path().join("b/book.djvu")).unwrap();
        assert_ne!(book_identity(&a), book_identity(&b));
        assert_eq!(
            book_identity(&a),
            book_identity(&dunce::canonicalize(dir.path().join("b/../a/book.djvu")).unwrap())
        );
    }
}
