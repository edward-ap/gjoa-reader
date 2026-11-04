//! Native application composition. Domain persistence stays outside the UI toolkit.
//! The Tauri identifier selects the production data root; test overrides are
//! process-only and cover every store, font cache and window-state file together.

#[cfg(test)]
mod test_corpus;

mod annotations;
mod commands;
mod import_cancel;
pub mod library;
mod library_commands;
mod open_timing;
mod preferences;
mod progress;
pub mod publication;
pub mod reader;
mod state;
mod ui_settings;

pub fn run() {
    use tauri::Manager;
    use tauri_plugin_window_state::{Builder as WindowStateBuilder, StateFlags};
    let mut window_state = WindowStateBuilder::default()
        .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
        .skip_initial_state("main");
    if let Some(path) = std::env::var_os("READER_TEST_DATA_DIR") {
        let path = std::path::PathBuf::from(path);
        assert!(path.is_absolute(), "READER_TEST_DATA_DIR must be absolute");
        window_state = window_state.with_filename(path.join("window-state.json").to_string_lossy());
    }
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(window_state.build())
        .manage(state::ReaderState::default())
        .setup(|app| {
            // Explicit process-only override for native tests; never accepted from JS.
            let directory = match std::env::var_os("READER_TEST_DATA_DIR") {
                Some(path) => {
                    let path = std::path::PathBuf::from(path);
                    if path.is_absolute() {
                        Ok(path)
                    } else {
                        Err("READER_TEST_DATA_DIR must be absolute".into())
                    }
                }
                // GjoaReader uses its own Tauri identifier. Never probe a sibling reader
                // profile or migrate an existing user Library during startup.
                None => app.path().app_data_dir().map_err(|error| error.to_string()),
            };
            if let Ok(path) = &directory {
                publication::font_assets::configure(path.join("font-cache"));
            }
            let library = directory
                .as_ref()
                .map_err(|error| error.clone())
                .and_then(|path| {
                    library::Library::new(&path.join("library")).map_err(|e| e.to_string())
                });
            app.manage(library::LibraryState(std::sync::Mutex::new(
                library.map_err(Into::into),
            )));
            app.manage(ui_settings::UiSettings(std::sync::Mutex::new(
                ui_settings::Store::new(
                    directory.clone().map(|path| path.join("ui-settings.json")),
                ),
            )));
            app.manage(preferences::Preferences(std::sync::Mutex::new(
                preferences::Store::new(directory.clone().map(|path| path.join("settings.json"))),
            )));
            app.manage(progress::ProgressState(std::sync::Arc::new(
                std::sync::Mutex::new(progress::ProgressStore::new(
                    directory.clone().map(|path| path.join("progress.json")),
                )),
            )));
            app.manage(annotations::AnnotationState(std::sync::Mutex::new(
                directory
                    .and_then(|path| annotations::Store::open(&path.join("annotations.sqlite"))),
            )));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ui_settings::prepare_main_window,
            ui_settings::show_main_window,
            ui_settings::read_ui_settings,
            ui_settings::save_ui_settings,
            preferences::read_settings,
            preferences::save_settings,
            commands::open_document,
            commands::restore_last_document,
            commands::close_document,
            commands::get_document_info,
            commands::get_page_info,
            commands::render_page,
            commands::save_book_progress,
            annotations::read_page_annotations,
            annotations::save_page_annotations,
            library_commands::list_library,
            library_commands::create_reader_edition,
            library_commands::reader_edition_status,
            library_commands::remove_recent_book,
            library_commands::library_thumbnail,
            library_commands::library_import_warnings,
            library_commands::begin_import,
            library_commands::append_import,
            library_commands::cancel_import,
            library_commands::finish_import,
            library_commands::import_from_dialog,
            library_commands::open_library_item,
            library_commands::create_library_folder,
            library_commands::rename_library_folder,
            library_commands::rename_library_root,
            library_commands::delete_library_folder,
            library_commands::rename_library_item,
            library_commands::delete_library_resource,
            library_commands::move_library_folder,
            library_commands::move_library_item
        ])
        .run(tauri::generate_context!())
        .expect("Failed to start GjøaReader");
}
pub mod pipeline_metrics;
