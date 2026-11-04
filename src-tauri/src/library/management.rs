use super::{Library, Result, edition::Manifest, store};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs,
    io::{Read, Write},
    path::Path,
};

#[derive(Serialize, Deserialize)]
struct DeletionJournal {
    paths: Vec<String>,
}

impl Library {
    pub fn rename_item(&self, id: i64, name: &str) -> Result<()> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 500 || name.chars().any(char::is_control) {
            return Err("Name must contain 1–500 characters without control characters".into());
        }
        if self.db.execute(
            "UPDATE library_items SET title=?1,display_name=?1 WHERE id=?2",
            params![name, id],
        )? != 1
        {
            return Err("Library item not found".into());
        }
        Ok(())
    }

    pub fn move_folder(&self, id: i64, parent: Option<i64>) -> Result<()> {
        let snapshot = self.list()?;
        if !snapshot.folders.iter().any(|f| f.id == id) {
            return Err("User folder not found".into());
        }
        let mut cursor = parent;
        let mut seen = BTreeSet::new();
        while let Some(ancestor) = cursor {
            if ancestor == id || !seen.insert(ancestor) {
                return Err("Cannot move a folder into itself or its descendants".into());
            }
            cursor = snapshot
                .folders
                .iter()
                .find(|f| f.id == ancestor)
                .ok_or("Target folder not found")?
                .parent_id;
        }
        self.db
            .execute(
                "UPDATE folders SET parent_id=?1 WHERE id=?2",
                params![parent, id],
            )
            .map_err(|e| format!("Cannot move folder (check duplicate sibling name): {e}"))?;
        Ok(())
    }

    /// Only explicit user items/folders can be selected; roots are not database IDs.
    pub fn deletion_items(
        &self,
        item: Option<i64>,
        folder: Option<i64>,
    ) -> Result<(Vec<i64>, Vec<i64>)> {
        match (item, folder) {
            (Some(id), None) => {
                self.item(id)?;
                Ok((vec![id], vec![]))
            }
            (None, Some(id)) => {
                let snapshot = self.list()?;
                if !snapshot.folders.iter().any(|f| f.id == id) {
                    return Err("User folder not found".into());
                }
                let mut folders = vec![id];
                let mut at = 0;
                while at < folders.len() {
                    let parent = folders[at];
                    for f in &snapshot.folders {
                        if f.parent_id == Some(parent) {
                            if folders.contains(&f.id) {
                                return Err("Cyclic Library folders".into());
                            }
                            folders.push(f.id);
                        }
                    }
                    at += 1;
                }
                let items = snapshot
                    .items
                    .iter()
                    .filter(|i| i.folder_id.is_some_and(|id| folders.contains(&id)))
                    .map(|i| i.id)
                    .collect();
                Ok((items, folders))
            }
            _ => Err("Select one book or user folder".into()),
        }
    }

    pub fn delete_resource(&mut self, item: Option<i64>, folder: Option<i64>) -> Result<()> {
        recover_deletions(&self.root, &self.db)?;
        let (items, folders) = self.deletion_items(item, folder)?;
        let snapshot = self.list()?;
        let editions: BTreeSet<_> = snapshot
            .items
            .iter()
            .filter(|i| items.contains(&i.id))
            .map(|i| i.edition_id.clone())
            .filter(|e| {
                !snapshot
                    .items
                    .iter()
                    .any(|i| !items.contains(&i.id) && &i.edition_id == e)
            })
            .collect();
        let mut sources = BTreeSet::new();
        let mut removed_fonts = BTreeSet::new();
        let mut retained_fonts = BTreeSet::new();
        let mut paths = Vec::new();
        let mut records = self.db.prepare("SELECT id,source_id FROM editions")?;
        let records = records
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        // Scan only manifests, never decode books or regenerate an edition.
        for (id, source) in &records {
            let path = store::checked_path(&self.root, &super::edition::manifest_relative(id)?)?;
            let manifest: Manifest = read_json(&path)?;
            if manifest.edition_id != *id || manifest.source_id != *source {
                return Err("Edition manifest identity mismatch".into());
            }
            for font in manifest.shared_fonts {
                if font.path != format!("fonts/{}", font.sha256) || !store::valid_id(&font.sha256) {
                    return Err("Unsafe shared font reference".into());
                }
                if editions.contains(id) {
                    removed_fonts.insert(font.path);
                } else {
                    retained_fonts.insert(font.path);
                }
            }
            if editions.contains(id) {
                paths.push(format!("editions/{id}"));
                if !records
                    .iter()
                    .any(|(other, s)| s == source && !editions.contains(other))
                {
                    sources.insert(source.clone());
                }
            }
        }
        for source in &sources {
            paths.push(store::object_relative(source)?);
        }
        paths.extend(removed_fonts.difference(&retained_fonts).cloned());
        for relative in &paths {
            let path = store::checked_path(&self.root, relative)?;
            if path.exists() {
                validate_tree(&self.root, &path)?;
            }
        }
        let pending = tempfile::Builder::new()
            .prefix("deletion-")
            .tempdir_in(store::checked_path(&self.root, "staging")?)?;
        let journal = DeletionJournal { paths };
        let journal_bytes = serde_json::to_vec(&journal)?;
        if journal_bytes.len() > 8 * 1024 * 1024 {
            return Err("Deletion plan exceeds metadata size limit".into());
        }
        let mut file = fs::File::create(pending.path().join("journal.json"))?;
        file.write_all(&journal_bytes)?;
        file.sync_all()?;
        drop(file);
        // Keep a recovery record before the first rename. The SQL marker decides
        // rollback versus physical purge even if the process exits at any step.
        let pending = pending.keep();
        let id = pending
            .file_name()
            .ok_or("Missing deletion identity")?
            .to_string_lossy()
            .into_owned();
        let result = (|| -> Result<()> {
            for (index, relative) in journal.paths.iter().enumerate() {
                let path = store::checked_path(&self.root, relative)?;
                if path.exists() {
                    fs::rename(path, pending.join(index.to_string()))?;
                }
            }
            let tx = self.db.unchecked_transaction()?;
            for id in &items {
                tx.execute("DELETE FROM progress WHERE item_id=?1", [id])?;
                tx.execute("DELETE FROM recent_items WHERE item_id=?1", [id])?;
                tx.execute("DELETE FROM library_items WHERE id=?1", [id])?;
            }
            for id in &editions {
                tx.execute("DELETE FROM edition_thumbnails WHERE edition_id=?1", [id])?;
                tx.execute("DELETE FROM editions WHERE id=?1", [id])?;
            }
            for id in &sources {
                tx.execute("DELETE FROM sources WHERE id=?1", [id])?;
            }
            for id in folders.iter().rev() {
                tx.execute("DELETE FROM folders WHERE id=?1", [id])?;
            }
            tx.execute("INSERT INTO deletion_commits(id) VALUES(?1)", [&id])?;
            tx.commit()?;
            Ok(())
        })();
        let cleanup = recover_deletions(&self.root, &self.db);
        result?;
        cleanup.map_err(|e| {
            format!("Library entries deleted; file cleanup will retry on restart: {e}").into()
        })
    }
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T> {
    let mut bytes = Vec::new();
    fs::File::open(path)?
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("Library metadata exceeds size limit".into());
    }
    Ok(serde_json::from_slice(&bytes)?)
}

fn validate_tree(root: &Path, path: &Path) -> Result<()> {
    let meta = fs::symlink_metadata(path)?;
    if meta.file_type().is_symlink() || !dunce::canonicalize(path)?.starts_with(root) {
        return Err("Unsafe deletion path".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return Err("Cannot delete reparse points from Library".into());
        }
    }
    if meta.is_dir() {
        for entry in fs::read_dir(path)? {
            validate_tree(root, &entry?.path())?;
        }
    }
    Ok(())
}

pub(super) fn recover_deletions(root: &Path, db: &Connection) -> Result<()> {
    for entry in fs::read_dir(store::checked_path(root, "staging")?)? {
        let entry = entry?;
        let id = entry.file_name().to_string_lossy().into_owned();
        if !id.starts_with("deletion-") {
            continue;
        }
        let dir = store::checked_path(root, &format!("staging/{id}"))?;
        validate_tree(root, &dir)?;
        let committed: bool = db.query_row(
            "SELECT EXISTS(SELECT 1 FROM deletion_commits WHERE id=?1)",
            [&id],
            |r| r.get(0),
        )?;
        let journal_path = dir.join("journal.json");
        // A crash while initially writing the journal has moved no payload yet.
        // Likewise a finished rollback can leave just the journal behind.
        if !committed
            && fs::read_dir(&dir)?.all(|entry| entry.is_ok_and(|e| e.file_name() == "journal.json"))
        {
            if journal_path.exists() {
                fs::remove_file(&journal_path)?;
            }
            fs::remove_dir(&dir)?;
            continue;
        }
        if journal_path.exists() {
            let journal: DeletionJournal = read_json(&journal_path)?;
            for (index, relative) in journal.paths.iter().enumerate() {
                let original = store::checked_path(root, relative)?;
                let staged = dir.join(index.to_string());
                if !staged.exists() {
                    continue;
                }
                if committed {
                    if staged.is_dir() {
                        fs::remove_dir_all(&staged)?;
                    } else {
                        fs::remove_file(&staged)?;
                    }
                } else {
                    if original.exists() {
                        return Err("Deletion recovery destination already exists".into());
                    }
                    fs::rename(&staged, original)?;
                }
            }
            fs::remove_file(journal_path)?;
        }
        fs::remove_dir(dir)?;
        db.execute("DELETE FROM deletion_commits WHERE id=?1", [id])?;
    }
    // A crash after removing the empty quarantine can leave only a harmless marker.
    let ids = db
        .prepare("SELECT id FROM deletion_commits")?
        .query_map([], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for id in ids {
        if !store::checked_path(root, &format!("staging/{id}"))?.exists() {
            db.execute("DELETE FROM deletion_commits WHERE id=?1", [id])?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_source_is_removed_only_after_its_last_edition() {
        let temp = tempfile::tempdir().unwrap();
        let mut library = Library::new(temp.path()).unwrap();
        let source = store::hash_id(&["shared source"]);
        let source_path = store::object_relative(&source).unwrap();
        fs::create_dir_all(temp.path().join(&source_path).parent().unwrap()).unwrap();
        fs::write(temp.path().join(&source_path), b"fixture").unwrap();
        library
            .db
            .execute(
                "INSERT INTO sources VALUES(?1,'pdf',7,'fixture',?2,1)",
                params![source, source_path],
            )
            .unwrap();
        for (item, version) in [(1, "old"), (2, "new")] {
            let id = store::hash_id(&[version]);
            let relative = super::super::edition::manifest_relative(&id).unwrap();
            let manifest = serde_json::json!({"schemaVersion":1,"editionId":id,"sourceId":source,"sourcePath":source_path,"format":"pdf","publisherId":"fixture","publisherVersion":1,"kind":"native-source","pageCount":1,"pages":[]});
            fs::create_dir_all(temp.path().join(&relative).parent().unwrap()).unwrap();
            fs::write(
                temp.path().join(&relative),
                serde_json::to_vec(&manifest).unwrap(),
            )
            .unwrap();
            library
                .db
                .execute(
                    "INSERT INTO editions VALUES(?1,?2,'fixture',1,'pdf',?3,1,1)",
                    params![id, source, relative],
                )
                .unwrap();
            library
                .db
                .execute(
                    "INSERT INTO library_items(id,edition_id,title,author,inbox,folder_id,added_at) VALUES(?1,?2,'fixture',NULL,1,NULL,1)",
                    params![item, id],
                )
                .unwrap();
        }
        library.delete_resource(Some(1), None).unwrap();
        assert!(temp.path().join(&source_path).exists());
        assert_eq!(library.list().unwrap().items.len(), 1);
        library.delete_resource(Some(2), None).unwrap();
        assert!(!temp.path().join(&source_path).exists());
    }

    #[test]
    fn recursive_deletion_keeps_shared_fonts_and_external_sources_and_rolls_back_failures() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("library");
        let mut library = Library::new(&root).unwrap();
        let mut items = Vec::new();
        for name in ["One", "Two"] {
            let source = temp.path().join(format!("{name}.fb2"));
            fs::write(&source, format!(r#"<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0"><description><title-info><book-title>{name}</book-title></title-info></description><body><section><p>Shared font test {name}.</p></section></body></FictionBook>"#)).unwrap();
            items.push(library.import_path(&source, None).unwrap().item);
        }
        let manifests: Vec<Manifest> = items
            .iter()
            .map(|i| {
                read_json(
                    &root.join(super::super::edition::manifest_relative(&i.edition_id).unwrap()),
                )
                .unwrap()
            })
            .collect();
        let original = fs::read(
            root.join(super::super::edition::manifest_relative(&items[0].edition_id).unwrap()),
        )
        .unwrap();
        library.rename_item(items[0].id, " Renamed ").unwrap();
        assert_eq!(
            library.item(items[0].id).unwrap().title.as_deref(),
            Some("Renamed")
        );
        assert!(library.rename_item(items[0].id, " \n ").is_err());
        assert_eq!(
            fs::read(
                root.join(super::super::edition::manifest_relative(&items[0].edition_id).unwrap())
            )
            .unwrap(),
            original
        );
        let parent = library.create_folder(None, "Parent").unwrap();
        let child = library.create_folder(Some(parent), "Child").unwrap();
        assert!(library.move_folder(parent, Some(child)).is_err());
        library.move_folder(child, None).unwrap();
        library.move_folder(child, Some(parent)).unwrap();
        library.move_item(items[0].id, Some(child), false).unwrap();
        library.save_progress(items[0].id, 0).unwrap();
        library.mark_opened(items[0].id).unwrap();
        library.db.execute_batch("CREATE TRIGGER fail_delete BEFORE DELETE ON sources BEGIN SELECT RAISE(ABORT,'injected delete failure'); END;").unwrap();
        assert!(library.delete_resource(None, Some(parent)).is_err());
        assert_eq!(library.list().unwrap().items.len(), 2);
        assert!(root.join(&manifests[0].source_path).exists());
        assert_eq!(
            fs::read(
                root.join(super::super::edition::manifest_relative(&items[0].edition_id).unwrap())
            )
            .unwrap(),
            original
        );
        assert_eq!(fs::read_dir(root.join("staging")).unwrap().count(), 0);
        library
            .db
            .execute_batch("DROP TRIGGER fail_delete")
            .unwrap();
        library.delete_resource(None, Some(parent)).unwrap();
        let snapshot = library.list().unwrap();
        assert_eq!(snapshot.items.len(), 1);
        assert!(snapshot.folders.is_empty());
        assert!(snapshot.recent.is_empty());
        assert!(!root.join(&manifests[0].source_path).exists());
        assert!(
            !root
                .join(format!("editions/{}", items[0].edition_id))
                .exists()
        );
        assert!(temp.path().join("One.fb2").exists());
        assert!(!manifests[0].shared_fonts.is_empty());
        for font in &manifests[0].shared_fonts {
            assert!(root.join(&font.path).exists());
        }
        library.delete_resource(Some(items[1].id), None).unwrap();
        for font in &manifests[0].shared_fonts {
            assert!(!root.join(&font.path).exists());
        }
        for table in [
            "library_items",
            "editions",
            "sources",
            "progress",
            "recent_items",
            "edition_thumbnails",
            "deletion_commits",
        ] {
            let count: i64 = library
                .db
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(count, 0, "{table}");
        }
        drop(library);
        assert!(
            Library::new(&root)
                .unwrap()
                .list()
                .unwrap()
                .items
                .is_empty()
        );
    }

    #[test]
    fn interrupted_deletion_restores_before_commit_and_purges_after_commit() {
        let temp = tempfile::tempdir().unwrap();
        let library = Library::new(temp.path()).unwrap();
        let initial = temp.path().join("staging/deletion-initial-write");
        fs::create_dir(&initial).unwrap();
        fs::write(initial.join("journal.json"), b"{unfinished").unwrap();
        recover_deletions(temp.path(), &library.db).unwrap();
        assert!(!initial.exists());
        let path = "objects/sha256/test-recovery";
        fs::write(temp.path().join(path), b"preserved bytes").unwrap();
        for committed in [false, true] {
            let dir = temp.path().join("staging/deletion-recovery");
            fs::create_dir(&dir).unwrap();
            fs::write(
                dir.join("journal.json"),
                serde_json::to_vec(&DeletionJournal {
                    paths: vec![path.into()],
                })
                .unwrap(),
            )
            .unwrap();
            fs::rename(temp.path().join(path), dir.join("0")).unwrap();
            if committed {
                library
                    .db
                    .execute(
                        "INSERT INTO deletion_commits VALUES('deletion-recovery')",
                        [],
                    )
                    .unwrap();
            }
            recover_deletions(temp.path(), &library.db).unwrap();
            assert_eq!(temp.path().join(path).exists(), !committed);
            assert!(!dir.exists());
        }
    }
}
