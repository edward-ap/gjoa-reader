pub mod derived;
pub mod edition;
mod management;
pub mod store;
pub mod thumbnail;
use crate::reader::registry::FormatRegistry;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
    sync::Mutex,
    time::Instant,
};
use store::{MAX_SOURCE_BYTES, Upload, checked_path};
pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
pub struct LibraryState(pub Mutex<Result<Library>>);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: i64,
    pub edition_id: String,
    pub title: Option<String>,
    pub display_name: Option<String>,
    pub author: Option<String>,
    pub original_name: String,
    pub byte_length: u64,
    pub format: String,
    pub page_count: usize,
    pub page_index: Option<usize>,
    pub completed: bool,
    pub inbox: bool,
    pub folder_id: Option<i64>,
    pub added_at: i64,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Folder {
    pub id: i64,
    pub parent_id: Option<i64>,
    pub name: String,
}
#[derive(Serialize)]
pub struct Snapshot {
    #[serde(rename = "myLibName")]
    pub my_lib_name: String,
    pub items: Vec<LibraryItem>,
    pub folders: Vec<Folder>,
    pub recent: Vec<i64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub preferred_item_id: Option<i64>,
    pub warnings: Vec<String>,
    pub item: LibraryItem,
    pub duplicate: bool,
    pub copy_hash_ms: f64,
    pub publication_ms: f64,
    pub commit_ms: f64,
    pub total_ms: f64,
    pub byte_length: u64,
}

pub struct Library {
    pub root: PathBuf,
    db: Connection,
    _lock: File,
    upload: Option<Upload>,
    next_upload: u64,
}
impl Library {
    pub fn import_warnings(&self, item_id: i64) -> Result<Vec<String>> {
        use std::io::Read;
        let item = self.item(item_id)?;
        let path = checked_path(&self.root, &edition::manifest_relative(&item.edition_id)?)?;
        let mut bytes = Vec::new();
        File::open(path)?
            .take(8 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("Edition manifest too large".into());
        }
        let manifest: edition::Manifest = serde_json::from_slice(&bytes)?;
        Ok(manifest.import_warnings)
    }
    pub fn new(root: &Path) -> Result<Self> {
        fs::create_dir_all(root)?;
        let root = dunce::canonicalize(root)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join("library.lock"))?;
        lock.try_lock()
            .map_err(|e| format!("Library is already in use or cannot be locked: {e}"))?;
        for directory in ["objects/sha256", "editions", "staging"] {
            store::directory(&root, directory)?;
        }
        let db = Connection::open(checked_path(&root, "library.db")?)?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
        let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if version == 0 {
            db.execute_batch(include_str!("schema.sql"))?;
        } else if !(1..=8).contains(&version) {
            return Err("Unsupported Library schema version; database preserved".into());
        }
        if version < 2 {
            db.execute_batch("BEGIN IMMEDIATE; CREATE TABLE recent_items(item_id INTEGER PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE, opened_order INTEGER NOT NULL); PRAGMA user_version=2; COMMIT;")?;
        }
        if version < 3 {
            db.execute_batch("BEGIN IMMEDIATE; CREATE TABLE edition_thumbnails(edition_id TEXT PRIMARY KEY REFERENCES editions(id) ON DELETE CASCADE, version INTEGER NOT NULL CHECK(version=1), pixels BLOB NOT NULL CHECK(length(pixels) BETWEEN 12 AND 22536)); PRAGMA user_version=3; COMMIT;")?;
        }
        if version < 4 {
            db.execute_batch("BEGIN IMMEDIATE;
                ALTER TABLE progress ADD COLUMN completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1));
                UPDATE progress SET completed=1 WHERE (page_index+1)*100 >= 99*(SELECT e.page_count FROM library_items i JOIN editions e ON e.id=i.edition_id WHERE i.id=progress.item_id);
                PRAGMA user_version=4; COMMIT;")?;
        }
        if version < 5 {
            db.execute_batch("BEGIN IMMEDIATE; CREATE TABLE deletion_commits(id TEXT PRIMARY KEY); PRAGMA user_version=5; COMMIT;")?;
        }
        if version < 6 {
            db.execute_batch("BEGIN IMMEDIATE; CREATE TABLE library_settings(key TEXT PRIMARY KEY, value TEXT NOT NULL); PRAGMA user_version=6; COMMIT;")?;
        }
        if version < 7 {
            db.execute_batch("BEGIN IMMEDIATE; CREATE TABLE source_reconstructions(source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,policy TEXT NOT NULL,edition_id TEXT REFERENCES editions(id) ON DELETE SET NULL,report TEXT NOT NULL,PRIMARY KEY(source_id,policy)); PRAGMA user_version=7; COMMIT;")?;
        }
        if version < 8 {
            db.execute_batch("BEGIN IMMEDIATE; ALTER TABLE library_items ADD COLUMN display_name TEXT; PRAGMA user_version=8; COMMIT;")?;
        }
        management::recover_deletions(&root, &db)?;
        store::cleanup_staging(&root)?;
        Ok(Self {
            root,
            db,
            _lock: lock,
            upload: None,
            next_upload: 1,
        })
    }
    pub fn begin(&mut self, name: &str, size: u64) -> Result<u64> {
        if size == 0 || size > MAX_SOURCE_BYTES {
            return Err("Source must be between 1 byte and 512 MiB".into());
        }
        if self
            .upload
            .as_ref()
            .is_some_and(|u| u.started.elapsed().as_secs() > 1800)
        {
            self.upload = None;
        }
        if self.upload.is_some() {
            return Err("Another import is in progress".into());
        }
        let name = name.rsplit(['/', '\\']).next().unwrap_or("").trim();
        if name.is_empty() || name.len() > 1024 || name.chars().any(char::is_control) {
            return Err("Invalid original filename".into());
        }
        let id = self.next_upload;
        self.next_upload += 1;
        let file = tempfile::Builder::new()
            .prefix("upload-")
            .tempfile_in(checked_path(&self.root, "staging")?)?;
        self.upload = Some(Upload {
            id,
            name: name.into(),
            expected: size,
            received: 0,
            file,
            started: Instant::now(),
        });
        Ok(id)
    }
    pub fn append(&mut self, id: u64, bytes: &[u8]) -> Result<()> {
        self.upload
            .as_mut()
            .filter(|u| u.id == id)
            .ok_or("Unknown import session")?
            .append(bytes)
    }
    pub fn cancel(&mut self, id: u64) {
        if self.upload.as_ref().is_some_and(|u| u.id == id) {
            self.upload = None;
        }
    }
    pub fn import_path(&mut self, path: &Path, legacy: Option<usize>) -> Result<ImportResult> {
        use std::io::Read;
        let mut file = File::open(path)?;
        let id = self.begin(
            &path
                .file_name()
                .ok_or("Missing filename")?
                .to_string_lossy(),
            file.metadata()?.len(),
        )?;
        let result = (|| {
            let mut buffer = vec![0; store::CHUNK_BYTES];
            loop {
                let n = file.read(&mut buffer)?;
                if n == 0 {
                    break;
                }
                self.append(id, &buffer[..n])?;
            }
            self.finish(id, legacy)
        })();
        if result.is_err() {
            self.cancel(id);
        }
        result
    }
    pub fn finish(&mut self, id: u64, legacy: Option<usize>) -> Result<ImportResult> {
        self.finish_with_progress(id, legacy, |_| {})
    }
    pub fn finish_with_progress(
        &mut self,
        id: u64,
        legacy: Option<usize>,
        progress: impl Fn(&'static str),
    ) -> Result<ImportResult> {
        if self.upload.as_ref().is_none_or(|u| u.id != id) {
            return Err("Unknown import session".into());
        }
        let upload = self.upload.take().ok_or("Missing upload")?;
        crate::import_cancel::check()?;
        if upload.received != upload.expected {
            return Err("Incomplete import; staging discarded".into());
        }
        upload.file.as_file().sync_all()?;
        let source = store::hash_import_reader(File::open(upload.file.path())?)?;
        let copy_hash_ms = upload.started.elapsed().as_secs_f64() * 1000.0;
        progress("Processing");
        let publication_start = Instant::now();
        let registry = FormatRegistry::default();
        let handler = registry.detect_named(upload.file.path(), &upload.name)?;
        let mut edition_id = crate::publication::identity(
            &source,
            handler.format_id().0,
            handler.publication_kind(),
        );
        // An installed generated edition is authoritative even if OS fonts changed.
        let existing: Option<i64> = if handler.publication_kind()
            == crate::reader::format::PublicationKind::GeneratedLayout
        {
            let mut query=self.db.prepare("SELECT i.id,e.id FROM library_items i JOIN editions e ON e.id=i.edition_id WHERE e.source_id=?1 AND e.format_id=?2 AND e.publisher_id='canonical-typesetter' AND e.publisher_version=?3 ORDER BY i.id")?;
            let candidates = query
                .query_map(
                    params![
                        source,
                        handler.format_id().0,
                        crate::publication::CURRENT_PUBLISHER_VERSION
                    ],
                    |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)),
                )?
                .collect::<std::result::Result<Vec<_>, _>>()?;
            let mut found = None;
            for (id, candidate) in candidates {
                use std::io::Read;
                let mut bytes = Vec::new();
                File::open(checked_path(
                    &self.root,
                    &edition::manifest_relative(&candidate)?,
                )?)?
                .take(8 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)?;
                if bytes.len() > 8 * 1024 * 1024 {
                    return Err("Edition manifest too large".into());
                }
                let manifest: edition::Manifest = serde_json::from_slice(&bytes)?;
                if manifest.profile_id.as_deref()
                    == Some(crate::publication::typography::profile_id().as_str())
                {
                    edition_id = candidate;
                    found = Some(id);
                    break;
                }
            }
            found
        } else {
            self.db
                .query_row(
                    "SELECT id FROM library_items WHERE edition_id=?1",
                    [&edition_id],
                    |r| r.get(0),
                )
                .optional()?
        };
        if let Some(existing) = existing {
            crate::import_cancel::check()?;
            // Validate the reusable backing artifacts instead of silently accepting corruption.
            let (document, _) = edition::resolve(&self.root, &edition_id, &registry)?;
            progress("Saving");
            if self.cached_thumbnail(existing)?.is_none() {
                let bytes = thumbnail::render(document.as_ref())?;
                self.db.execute(
                    "INSERT OR IGNORE INTO edition_thumbnails VALUES(?1,1,?2)",
                    params![edition_id, bytes],
                )?;
            }
            if let Some(index) = legacy.filter(|i| *i < document.page_count()) {
                self.db.execute("INSERT OR IGNORE INTO progress(item_id,page_index,updated_at,completed) VALUES(?1,?2,unixepoch(),?3)",params![existing,index as i64,completion_reached(index, document.page_count())])?;
            }
            progress("Processing");
            let (preferred_item_id, reader_warning) = self.optional_reader(existing);
            progress("Saving");
            let mut warnings = self.import_warnings(existing)?;
            warnings.extend(reader_warning);
            if let Some(reader) = preferred_item_id {
                warnings.extend(self.import_warnings(reader).unwrap_or_default());
            }
            return Ok(ImportResult {
                preferred_item_id,
                warnings,
                item: self.item(existing)?,
                duplicate: true,
                copy_hash_ms,
                publication_ms: 0.0,
                commit_ms: 0.0,
                total_ms: upload.started.elapsed().as_secs_f64() * 1000.0,
                byte_length: upload.expected,
            });
        }
        let mut prepared = crate::publication::prepare_named(
            &source,
            handler,
            upload.file.path(),
            &checked_path(&self.root, "staging")?,
            &upload.name,
        )?;
        let publication_ms = publication_start.elapsed().as_secs_f64() * 1000.0;
        crate::import_cancel::check()?;
        progress("Saving");
        let started = upload.started;
        let size = upload.expected;
        let name = upload.name;
        let (object, installed_source) = store::install_source(&self.root, upload.file, &source)?;
        let mut installed_edition = false;
        let commit_start = Instant::now();
        let result = (|| -> Result<i64> {
            installed_edition = prepared
                .install(&self.root)
                .map_err(|e| format!("Saving edition in [{}]: {e}", self.root.display()))?;
            let manifest = &prepared.manifest;
            let transaction = self.db.transaction()?;
            transaction.execute("INSERT OR IGNORE INTO sources(id,format_id,byte_length,original_name,object_path,imported_at) VALUES(?1,?2,?3,?4,?5,unixepoch())",params![source,manifest.format,size as i64,name,manifest.source_path])?;
            transaction.execute("INSERT OR IGNORE INTO editions(id,source_id,publisher_id,publisher_version,format_id,manifest_path,page_count,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,unixepoch())",params![manifest.edition_id,source,manifest.publisher_id,manifest.publisher_version,manifest.format,edition::manifest_relative(&manifest.edition_id)?,manifest.page_count as i64])?;
            transaction.execute(
                "INSERT OR IGNORE INTO edition_thumbnails VALUES(?1,1,?2)",
                params![manifest.edition_id, prepared.thumbnail],
            )?;
            let title = Path::new(&name)
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy();
            let title = manifest
                .metadata
                .as_ref()
                .and_then(|m| m.title.as_deref())
                .unwrap_or(&title);
            let author = manifest.metadata.as_ref().and_then(|m| m.author.as_deref());
            transaction.execute("INSERT INTO library_items(edition_id,title,author,inbox,folder_id,added_at) VALUES(?1,?2,?3,1,NULL,unixepoch())",params![manifest.edition_id,title,author])?;
            let item = transaction.last_insert_rowid();
            if let Some(index) = legacy.filter(|i| *i < manifest.page_count) {
                transaction.execute(
                    "INSERT INTO progress(item_id,page_index,updated_at,completed) VALUES(?1,?2,unixepoch(),?3)",
                    params![item, index as i64, completion_reached(index, manifest.page_count)],
                )?;
            }
            crate::import_cancel::check()?;
            transaction.commit()?;
            Ok(item)
        })();
        match result {
            Ok(id) => {
                progress("Processing");
                let (preferred_item_id, reader_warning) = self.optional_reader(id);
                progress("Saving");
                let mut warnings = prepared.manifest.import_warnings.clone();
                warnings.extend(reader_warning);
                if let Some(reader) = preferred_item_id {
                    warnings.extend(self.import_warnings(reader).unwrap_or_default());
                }
                Ok(ImportResult {
                    preferred_item_id,
                    warnings,
                    item: self.item(id)?,
                    duplicate: false,
                    copy_hash_ms,
                    publication_ms,
                    commit_ms: commit_start.elapsed().as_secs_f64() * 1000.0,
                    total_ms: started.elapsed().as_secs_f64() * 1000.0,
                    byte_length: size,
                })
            }
            Err(error) => {
                prepared.rollback_fonts();
                // Only artifacts installed by this attempt, while the exclusive Library lock is held.
                if installed_edition {
                    let directory = crate::publication::edition_root(
                        &self.root,
                        &prepared.manifest.edition_id,
                    )?;
                    let _ = fs::remove_dir_all(directory);
                }
                if installed_source {
                    let _ = fs::remove_file(object);
                }
                Err(error)
            }
        }
    }
    pub fn cached_thumbnail(&self, id: i64) -> Result<Option<Vec<u8>>> {
        let item = self.item(id)?;
        Ok(self
            .db
            .query_row(
                "SELECT pixels FROM edition_thumbnails WHERE edition_id=?1 AND version=1",
                [&item.edition_id],
                |r| r.get(0),
            )
            .optional()?)
    }
    /// Backfill old libraries on demand, once per edition, without changing manifests.
    pub fn thumbnail(&self, id: i64) -> Result<Vec<u8>> {
        if let Some(bytes) = self.cached_thumbnail(id)? {
            return Ok(bytes);
        }
        let item = self.item(id)?;
        let (document, _) =
            edition::resolve(&self.root, &item.edition_id, &FormatRegistry::default())?;
        let bytes = thumbnail::render(document.as_ref())?;
        self.db.execute(
            "INSERT OR IGNORE INTO edition_thumbnails VALUES(?1,1,?2)",
            params![item.edition_id, bytes],
        )?;
        Ok(bytes)
    }
    pub fn item(&self, id: i64) -> Result<LibraryItem> {
        Ok(self
            .db
            .query_row(&format!("{ITEM_QUERY} WHERE i.id=?1"), [id], read_item)?)
    }
    pub fn list(&self) -> Result<Snapshot> {
        let mut query = self
            .db
            .prepare(&format!("{ITEM_QUERY} ORDER BY i.added_at DESC,i.id DESC"))?;
        let items = query
            .query_map([], read_item)?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let mut query = self
            .db
            .prepare("SELECT id,parent_id,name FROM folders ORDER BY name_key,id")?;
        let folders = query
            .query_map([], |r| {
                Ok(Folder {
                    id: r.get(0)?,
                    parent_id: r.get(1)?,
                    name: r.get(2)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        let recent = self.db.prepare("SELECT item_id FROM recent_items JOIN library_items ON library_items.id=item_id ORDER BY opened_order DESC LIMIT 5")?
            .query_map([], |r| r.get(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Snapshot {
            my_lib_name: self
                .db
                .query_row(
                    "SELECT value FROM library_settings WHERE key='mylib_name'",
                    [],
                    |r| r.get(0),
                )
                .optional()?
                .unwrap_or_else(|| "MyLib".into()),
            items,
            folders,
            recent,
        })
    }
    pub fn mark_opened(&self, id: i64) -> Result<()> {
        self.item(id)?;
        self.db.execute("INSERT INTO recent_items(item_id,opened_order) VALUES(?1,(SELECT COALESCE(MAX(opened_order),0)+1 FROM recent_items)) ON CONFLICT(item_id) DO UPDATE SET opened_order=excluded.opened_order", [id])?;
        Ok(())
    }
    pub fn remove_recent(&self, id: i64) -> Result<()> {
        self.db
            .execute("DELETE FROM recent_items WHERE item_id=?1", [id])?;
        Ok(())
    }
    pub fn save_progress(&self, id: i64, index: usize) -> Result<LibraryItem> {
        let item = self.item(id)?;
        if index >= item.page_count {
            return Err("Progress page index out of range".into());
        }
        self.db.execute("INSERT INTO progress(item_id,page_index,updated_at,completed) VALUES(?1,?2,unixepoch(),?3) ON CONFLICT(item_id) DO UPDATE SET page_index=excluded.page_index,updated_at=excluded.updated_at,completed=MAX(progress.completed,excluded.completed)",params![id,index as i64,completion_reached(index,item.page_count)])?;
        self.item(id)
    }
    pub fn move_item(&self, id: i64, folder: Option<i64>, inbox: bool) -> Result<LibraryItem> {
        if inbox && folder.is_some() {
            return Err("New cannot contain user folders".into());
        }
        if self.db.execute(
            "UPDATE library_items SET folder_id=?1,inbox=?2 WHERE id=?3",
            params![folder, inbox, id],
        )? != 1
        {
            return Err("Library item not found".into());
        }
        self.item(id)
    }
    pub fn create_folder(&self, parent: Option<i64>, name: &str) -> Result<i64> {
        let name = folder_name(name)?;
        self.db.execute("INSERT INTO folders(parent_id,name,name_key,created_at) VALUES(?1,?2,?3,unixepoch())",params![parent,name,name.to_lowercase()]).map_err(|e|format!("Cannot create folder (check parent or duplicate sibling name): {e}"))?;
        Ok(self.db.last_insert_rowid())
    }
    pub fn rename_mylib(&self, name: &str) -> Result<()> {
        let name = folder_name(name)?;
        self.db.execute("INSERT INTO library_settings(key,value) VALUES('mylib_name',?1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [name])?;
        Ok(())
    }
    pub fn rename_folder(&self, id: i64, name: &str) -> Result<()> {
        let name = folder_name(name)?;
        if self
            .db
            .execute(
                "UPDATE folders SET name=?1,name_key=?2 WHERE id=?3",
                params![name, name.to_lowercase(), id],
            )
            .map_err(|e| format!("Cannot rename folder (duplicate sibling name): {e}"))?
            != 1
        {
            return Err("User folder not found; system roots cannot be renamed".into());
        }
        Ok(())
    }
    pub fn delete_folder(&self, id: i64) -> Result<()> {
        if self
            .db
            .execute("DELETE FROM folders WHERE id=?1", [id])
            .map_err(|e| format!("Only empty user folders can be deleted: {e}"))?
            != 1
        {
            return Err("User folder not found; system roots cannot be deleted".into());
        }
        Ok(())
    }
}
fn folder_name(name: &str) -> Result<&str> {
    let name = name.trim();
    if name.is_empty()
        || name.chars().count() > 100
        || name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err("Folder name must contain 1–100 characters without controls or slashes".into());
    }
    Ok(name)
}
fn completion_reached(index: usize, count: usize) -> bool {
    count > 0 && index < count && (index as u128 + 1) * 100 >= count as u128 * 99
}

const ITEM_QUERY: &str = "SELECT i.id,i.edition_id,i.title,i.author,s.original_name,e.format_id,e.page_count,p.page_index,i.inbox,i.folder_id,i.added_at,COALESCE(p.completed,0),s.byte_length,i.display_name FROM library_items i JOIN editions e ON e.id=i.edition_id JOIN sources s ON s.id=e.source_id LEFT JOIN progress p ON p.item_id=i.id";
fn read_item(r: &rusqlite::Row<'_>) -> rusqlite::Result<LibraryItem> {
    Ok(LibraryItem {
        id: r.get(0)?,
        edition_id: r.get(1)?,
        title: r.get(2)?,
        display_name: r.get(13)?,
        author: r.get(3)?,
        original_name: r.get(4)?,
        format: r.get(5)?,
        page_count: r.get::<_, u32>(6)? as usize,
        page_index: r.get::<_, Option<u32>>(7)?.map(|n| n as usize),
        inbox: r.get(8)?,
        folder_id: r.get(9)?,
        added_at: r.get(10)?,
        completed: r.get(11)?,
        byte_length: u64::from(r.get::<_, u32>(12)?),
    })
}

#[cfg(test)]
mod tests;
