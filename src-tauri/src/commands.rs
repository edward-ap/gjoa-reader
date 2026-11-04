use crate::{
    reader::document::{PageAppearance, PageInfo, RenderRequest, Result},
    state::{self, DocumentInfo, OpenDocument, ReaderState},
};
use std::io::Write;
use std::sync::{Arc, atomic::Ordering};
use tauri::{Manager, State, ipc::Response};
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn open_document(app: tauri::AppHandle) -> Result<Option<DocumentInfo>> {
    // Paths originate exclusively in the native dialog, never from JavaScript.
    let id = app.state::<ReaderState>().next_generation();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ReaderState>();
        let mut dialog = app.dialog().file();
        for handler in state.formats.handlers() {
            dialog = dialog.add_filter(handler.filter_name(), handler.supported_extensions());
        }
        let selected = dialog.blocking_pick_file();
        let Some(selected) = selected else {
            return Ok(None);
        };
        let path = selected.into_path().map_err(|e| e.to_string())?;
        open_path(&app, path, id).map(Some)
    })
    .await
    .map_err(|e| format!("Open worker failed: {e}"))?
}

// Only native-dialog or previously remembered native paths reach this helper.
fn open_path(app: &tauri::AppHandle, path: std::path::PathBuf, id: u64) -> Result<DocumentInfo> {
    let state = app.state::<ReaderState>();
    let mut opened = state::load(&state.formats, &path, id)?;
    let progress = app.state::<crate::progress::ProgressState>();
    match progress.0.lock() {
        Ok(mut store) => {
            let (page_index, warning) = store.restore(&opened.identity, opened.info.page_count);
            opened.info.progress_warning = warning;
            match opened.document.page_info(page_index) {
                Ok(info) => {
                    opened.info.initial_page_index = page_index;
                    opened.info.initial_page = info;
                }
                Err(error) => {
                    opened.info.progress_warning =
                        Some(format!("Cannot restore page; opening first page: {error}"))
                }
            }
        }
        Err(error) => opened.info.progress_warning = Some(format!("Progress unavailable: {error}")),
    }
    let state = app.state::<ReaderState>();
    let mut current = state.document.lock().map_err(|e| e.to_string())?;
    if state.generation.load(Ordering::SeqCst) != id {
        return Err("Open request superseded".into());
    }
    if let Err(error) = crate::ui_settings::remember_book(
        app,
        Some(crate::ui_settings::LastBook::External { path: path.clone() }),
    ) {
        opened.info.progress_warning = Some(format!("Cannot remember last book: {error}"));
    }
    let info = opened.info.clone();
    *current = Some(Arc::new(opened));
    if let Some(window) = app.get_webview_window("main") {
        let title = path.file_stem().unwrap_or_default().to_string_lossy();
        let _ = window.set_title(&format!("{title} — GjøaReader"));
    }
    Ok(info)
}

#[tauri::command]
pub async fn restore_last_document(app: tauri::AppHandle) -> Result<Option<DocumentInfo>> {
    use crate::ui_settings::{LastBook, UiSettings};
    let book = app
        .state::<UiSettings>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .last_book();
    let result = match book.clone() {
        None => return Ok(None),
        Some(LastBook::Library { item_id }) => {
            crate::library_commands::open_library_item(app.clone(), item_id, None)
                .await
                .map(Some)
        }
        Some(LastBook::External { path }) => {
            let id = app.state::<ReaderState>().next_generation();
            let app = app.clone();
            tauri::async_runtime::spawn_blocking(move || open_path(&app, path, id).map(Some))
                .await
                .map_err(|e| format!("Restore worker failed: {e}"))?
        }
    };
    if result.is_err() {
        // Deleted/missing books must not cause a failing reopen on every launch.
        let state = app.state::<UiSettings>();
        let mut store = state.0.lock().map_err(|e| e.to_string())?;
        if store.last_book() == book {
            let _ = store.remember_book(None);
        }
    }
    result
}

#[tauri::command]
pub async fn save_book_progress(
    document_id: u64,
    page_index: usize,
    app: tauri::AppHandle,
) -> Result<()> {
    let doc = app.state::<ReaderState>().get(document_id)?;
    if page_index >= doc.info.page_count {
        return Err("Progress page index out of range".into());
    }
    if let Some(item_id) = doc.info.library_item_id {
        return tauri::async_runtime::spawn_blocking(move || {
            crate::library_commands::save_progress(&app, item_id, page_index)
        })
        .await
        .map_err(|e| e.to_string())?;
    }
    let progress = app.state::<crate::progress::ProgressState>().0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        progress.lock().map_err(|error| error.to_string())?.save(
            &doc.identity,
            page_index,
            doc.info.page_count,
        )
    })
    .await
    .map_err(|error| format!("Progress worker failed: {error}"))?
}

#[tauri::command]
pub fn close_document(app: tauri::AppHandle, state: State<'_, ReaderState>) -> Result<()> {
    let mut document = state.document.lock().map_err(|e| e.to_string())?;
    state.next_generation();
    if let Err(error) = crate::ui_settings::remember_book(&app, None) {
        eprintln!("Cannot clear last book: {error}");
    }
    *document = None;
    drop(document);
    if let Some(window) = app.get_webview_window("main") {
        window.set_title("GjøaReader").map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn get_document_info(state: State<'_, ReaderState>) -> Result<Option<DocumentInfo>> {
    state.info()
}

#[tauri::command]
pub async fn get_page_info(
    document_id: u64,
    page_index: usize,
    app: tauri::AppHandle,
) -> Result<PageInfo> {
    let gate = app.state::<ReaderState>().render_gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.lock().map_err(|e| e.to_string())?;
        app.state::<ReaderState>()
            .get(document_id)?
            .document
            .page_info(page_index)
    })
    .await
    .map_err(|e| format!("Metadata worker failed: {e}"))?
}

#[tauri::command]
pub async fn render_page(
    document_id: u64,
    page_index: usize,
    target_width: u32,
    target_height: u32,
    appearance: Option<PageAppearance>,
    app: tauri::AppHandle,
) -> Result<Response> {
    let request = RenderRequest {
        width: target_width,
        height: target_height,
    };
    request.byte_len()?;
    let gate = app.state::<ReaderState>().render_gate.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = gate.lock().map_err(|e| e.to_string())?;
        let doc = app.state::<ReaderState>().get(document_id)?;
        render_document_appearance(&doc, page_index, request, appearance.unwrap_or_default())
    })
    .await
    .map_err(|e| format!("Render worker failed: {e}"))?
}

// Shared command worker, exercised with a non-decoder implementation in tests.
#[cfg(test)]
fn render_document(
    doc: &OpenDocument,
    page_index: usize,
    request: RenderRequest,
) -> Result<Response> {
    render_document_appearance(doc, page_index, request, PageAppearance::Original)
}
fn render_document_appearance(
    doc: &OpenDocument,
    page_index: usize,
    request: RenderRequest,
    appearance: PageAppearance,
) -> Result<Response> {
    let expected = request.byte_len()?;
    let start = std::time::Instant::now();
    let raster = doc
        .document
        .render_with_appearance(page_index, request, appearance)?;
    if raster.width != request.width
        || raster.height != request.height
        || raster.rgba.len() != expected
    {
        return Err("Render failure: unexpected raster dimensions/length".into());
    }
    // GUI launches may inherit a closed console pipe; diagnostics must never fail rendering.
    let _ = writeln!(
        std::io::stderr(),
        "render page={} {}x{} bytes={} elapsed_ms={:.1}",
        page_index + 1,
        raster.width,
        raster.height,
        raster.rgba.len(),
        start.elapsed().as_secs_f64() * 1000.0
    );
    Ok(Response::new(raster.rgba))
}

#[cfg(test)]
mod tests;
