use crate::{
    library::{self, ImportResult, Library, LibraryItem, LibraryState, Snapshot},
    reader::document::Result,
    state::{DocumentInfo, OpenDocument, ReaderState},
};
use std::sync::{Arc, atomic::Ordering};
use tauri::{
    Emitter, Manager,
    ipc::{InvokeBody, Request},
};
use tauri_plugin_dialog::DialogExt;

fn with_library<T>(
    app: &tauri::AppHandle,
    operation: impl FnOnce(&mut Library) -> library::Result<T>,
) -> Result<T> {
    let state = app.state::<LibraryState>();
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    let library = guard.as_mut().map_err(|e| e.to_string())?;
    operation(library).map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn library_import_warnings(app: tauri::AppHandle, item_id: i64) -> Result<Vec<String>> {
    tauri::async_runtime::spawn_blocking(move || with_library(&app, |l| l.import_warnings(item_id)))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn list_library(app: tauri::AppHandle) -> Result<Snapshot> {
    tauri::async_runtime::spawn_blocking(move || with_library(&app, |l| l.list()))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn reader_edition_status(
    app: tauri::AppHandle,
    item_id: i64,
) -> Result<library::derived::ReaderEditionStatus> {
    tauri::async_runtime::spawn_blocking(move || {
        with_library(&app, |l| l.reader_edition_status(item_id))
    })
    .await
    .map_err(|e| e.to_string())?
}
/// Compatibility endpoint: reconstruction is disabled in the product.
#[tauri::command]
pub async fn create_reader_edition(
    app: tauri::AppHandle,
    item_id: i64,
    experimental: bool,
) -> Result<library::derived::DerivedResult> {
    let gate = app.state::<ReaderState>().render_gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.lock().map_err(|e| e.to_string())?;
        with_library(&app, |l| l.reader_edition(item_id, experimental))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn remove_recent_book(app: tauri::AppHandle, item_id: i64) -> Result<Snapshot> {
    tauri::async_runtime::spawn_blocking(move || {
        with_library(&app, |l| {
            l.remove_recent(item_id)?;
            l.list()
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn library_thumbnail(
    app: tauri::AppHandle,
    item_id: i64,
) -> Result<tauri::ipc::Response> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(bytes) = with_library(&app, |library| library.cached_thumbnail(item_id))? {
            return Ok(tauri::ipc::Response::new(bytes));
        }
        let gate = app.state::<ReaderState>().render_gate.clone();
        let _guard = gate.lock().map_err(|e| e.to_string())?;
        let bytes = with_library(&app, |library| library.thumbnail(item_id))?;
        Ok(tauri::ipc::Response::new(bytes))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn begin_import(app: tauri::AppHandle, name: String, size: u64) -> Result<u64> {
    let id =
        tauri::async_runtime::spawn_blocking(move || with_library(&app, |l| l.begin(&name, size)))
            .await
            .map_err(|e| e.to_string())??;
    crate::import_cancel::register(id);
    Ok(id)
}
#[tauri::command]
pub async fn append_import(app: tauri::AppHandle, request: Request<'_>) -> Result<()> {
    let id = request
        .headers()
        .get("x-upload-id")
        .and_then(|h| h.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or("Missing upload identity")?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("Import requires binary bytes".into());
    };
    if bytes.len() > library::store::CHUNK_BYTES {
        return Err("Import chunk exceeds 1 MiB".into());
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || with_library(&app, |l| l.append(id, &bytes)))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn cancel_import(app: tauri::AppHandle, upload_id: u64) -> Result<()> {
    crate::import_cancel::cancel(upload_id);
    tauri::async_runtime::spawn_blocking(move || {
        let result = with_library(&app, |l| {
            l.cancel(upload_id);
            Ok(())
        });
        crate::import_cancel::remove(upload_id);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn finish_import(app: tauri::AppHandle, upload_id: u64) -> Result<ImportResult> {
    let gate = app.state::<ReaderState>().render_gate.clone();
    let token = crate::import_cancel::token(upload_id);
    let result = tauri::async_runtime::spawn_blocking(move || {
        let _scope = crate::import_cancel::Scope::enter(token);
        let _guard = gate.lock().map_err(|e| e.to_string())?;
        with_library(&app, |l| {
            l.finish_with_progress(upload_id, None, |stage| {
                let _ = app.emit_to(
                    "main",
                    "library-import-stage",
                    serde_json::json!({"uploadId": upload_id, "stage": stage}),
                );
            })
        })
    })
    .await
    .map_err(|e| e.to_string())?;
    crate::import_cancel::remove(upload_id);
    result
}
#[tauri::command]
pub async fn import_from_dialog(app: tauri::AppHandle) -> Result<Option<ImportResult>> {
    let gate = app.state::<ReaderState>().render_gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ReaderState>();
        let mut dialog = app.dialog().file();
        for handler in state.formats.handlers() {
            dialog = dialog.add_filter(handler.filter_name(), handler.supported_extensions());
        }
        let Some(selected) = dialog.blocking_pick_file() else {
            return Ok(None);
        };
        let path = dunce::canonicalize(selected.into_path().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        let legacy = app
            .state::<crate::progress::ProgressState>()
            .0
            .lock()
            .map_err(|e| e.to_string())?
            .existing(&crate::progress::book_identity(&path));
        let _guard = gate.lock().map_err(|e| e.to_string())?;
        with_library(&app, |l| l.import_path(&path, legacy)).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn open_library_item(
    app: tauri::AppHandle,
    item_id: i64,
    prefer_reader: Option<bool>,
) -> Result<DocumentInfo> {
    let mut timing = crate::open_timing::OpenTiming::new();
    let generation = app.state::<ReaderState>().next_generation();
    tauri::async_runtime::spawn_blocking(move || {
        let (mut opened, item_id) = with_library(&app, |library| {
            timing.mark("open.queue_and_library_lock");
            let _ = prefer_reader; // Retained for older clients; PDF always opens Original.
            let item_id = library.original_reading_item(item_id)?;
            let item = library.item(item_id)?;
            let (document, path) = library::edition::resolve(
                &library.root,
                &item.edition_id,
                &app.state::<ReaderState>().formats,
            )?;
            timing.mark("open.resolve");
            let mut opened = OpenDocument::new(std::path::Path::new(&path), generation, document)?;
            opened.info.library_item_id = Some(item_id);
            opened.annotation_key =
                crate::annotations::identity(&format!("edition:{}", item.edition_id));
            opened.info.display_name = Some(match (&item.author, &item.title) {
                (Some(author), Some(title)) => format!("{author} — {title}"),
                (_, Some(title)) => title.clone(),
                _ => item.original_name,
            });
            opened.info.initial_page_index =
                item.page_index.unwrap_or(0).min(opened.info.page_count - 1);
            opened.info.initial_page = opened.document.page_info(opened.info.initial_page_index)?;
            Ok((opened, item_id))
        })?;
        timing.mark("open.initial_page");
        let state = app.state::<ReaderState>();
        let mut current = state.document.lock().map_err(|e| e.to_string())?;
        if state.generation.load(Ordering::SeqCst) != generation {
            return Err("Open request superseded".into());
        }
        let title = with_library(&app, |library| {
            library.mark_opened(item_id)?;
            let item = library.item(item_id)?;
            let title = item.title.unwrap_or(item.original_name);
            Ok(match item.author {
                Some(author) if !author.is_empty() => format!("{title} — {author} — GjøaReader"),
                _ => format!("{title} — GjøaReader"),
            })
        })?;
        if let Err(error) = crate::ui_settings::remember_book(
            &app,
            Some(crate::ui_settings::LastBook::Library { item_id }),
        ) {
            opened.info.progress_warning = Some(format!("Cannot remember last book: {error}"));
        }
        let info = opened.info.clone();
        *current = Some(Arc::new(opened));
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_title(&title);
        }
        timing.mark("open.commit_and_title");
        Ok(info)
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn save_progress(app: &tauri::AppHandle, item_id: i64, index: usize) -> Result<()> {
    with_library(app, |l| l.save_progress(item_id, index))?;
    // Frontend updates the existing row only after this committed save resolves.
    Ok(())
}
#[tauri::command]
pub async fn create_library_folder(
    app: tauri::AppHandle,
    parent_id: Option<i64>,
    name: String,
) -> Result<i64> {
    tauri::async_runtime::spawn_blocking(move || {
        with_library(&app, |l| l.create_folder(parent_id, &name))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn rename_library_root(app: tauri::AppHandle, name: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || with_library(&app, |l| l.rename_mylib(&name)))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn rename_library_folder(
    app: tauri::AppHandle,
    folder_id: i64,
    name: String,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        with_library(&app, |l| l.rename_folder(folder_id, &name))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn delete_library_folder(app: tauri::AppHandle, folder_id: i64) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || with_library(&app, |l| l.delete_folder(folder_id)))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn move_library_item(
    app: tauri::AppHandle,
    item_id: i64,
    folder_id: Option<i64>,
    inbox: bool,
) -> Result<LibraryItem> {
    tauri::async_runtime::spawn_blocking(move || {
        with_library(&app, |l| l.move_item(item_id, folder_id, inbox))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn rename_library_item(app: tauri::AppHandle, item_id: i64, name: String) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        with_library(&app, |l| l.rename_item(item_id, &name))?;
        if app
            .state::<ReaderState>()
            .info()?
            .is_some_and(|i| i.library_item_id == Some(item_id))
            && let Some(window) = app.get_webview_window("main")
        {
            let _ = window.set_title(&format!("{name} — GjøaReader"));
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn move_library_folder(
    app: tauri::AppHandle,
    folder_id: i64,
    parent_id: Option<i64>,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        with_library(&app, |l| l.move_folder(folder_id, parent_id))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_library_resource(
    app: tauri::AppHandle,
    item_id: Option<i64>,
    folder_id: Option<i64>,
) -> Result<Snapshot> {
    let gate = app.state::<ReaderState>().render_gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = gate.lock().map_err(|e| e.to_string())?;
        let state = app.state::<ReaderState>();
        let mut current = state.document.lock().map_err(|e| e.to_string())?;
        with_library(&app, |l| {
            let (items, _) = l.deletion_items(item_id, folder_id)?;
            state.next_generation(); // Invalidate any open that has not committed yet.
            if current
                .as_ref()
                .is_some_and(|d| d.info.library_item_id.is_some_and(|id| items.contains(&id)))
            {
                *current = None; // Release PDF/file handles before moving owned files.
                let _ = crate::ui_settings::remember_book(&app, None);
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.set_title("GjøaReader");
                }
            }
            l.delete_resource(item_id, folder_id)?;
            if current.is_none()
                && let Some(window) = app.get_webview_window("main")
            {
                let _ = window.set_title("GjøaReader");
            }
            l.list()
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
