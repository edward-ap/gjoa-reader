use serde::{Deserialize, Serialize};
use std::{io::Write, path::PathBuf, sync::Mutex};
use tauri::Manager;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum LastBook {
    Library {
        #[serde(rename = "itemId")]
        item_id: i64,
    },
    External {
        path: PathBuf,
    },
}

#[derive(Clone, Copy, Default, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ViewMode {
    #[default]
    Single,
    Facing,
    Continuous,
}
#[derive(Clone, Copy, Default, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PanelSide {
    #[default]
    Left,
    Right,
}
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelPlacement {
    side: PanelSide,
    tab_position: f64,
}
impl Default for PanelPlacement {
    fn default() -> Self {
        Self {
            side: PanelSide::Left,
            tab_position: 0.35,
        }
    }
}
impl PanelPlacement {
    fn valid(&self) -> bool {
        self.tab_position.is_finite() && (0.0..=1.0).contains(&self.tab_position)
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    version: u32,
    left_width: f64,
    #[serde(default)]
    left_collapsed: bool,
    #[serde(default)]
    library_panel: PanelPlacement,
    #[serde(default)]
    view_mode: ViewMode,
    #[serde(default)]
    tutorial_completed: bool,
    #[serde(default)]
    last_book: Option<LastBook>,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            left_width: 290.0,
            left_collapsed: false,
            library_panel: PanelPlacement::default(),
            view_mode: ViewMode::Single,
            tutorial_completed: false,
            last_book: None,
        }
    }
}
pub struct Store {
    path: Result<PathBuf, String>,
    settings: Settings,
}
impl Store {
    pub fn new(path: Result<PathBuf, String>) -> Self {
        let mut store = Self {
            path,
            settings: Settings::default(),
        };
        if let Ok(path) = &store.path {
            match std::fs::read(path) {
                Ok(bytes) => match serde_json::from_slice::<Settings>(&bytes) {
                    Ok(settings)
                        if settings.version == 1
                            && valid_width(settings.left_width)
                            && settings.library_panel.valid() =>
                    {
                        store.settings = settings
                    }
                    _ => store.path = Err("Invalid UI settings; original file preserved".into()),
                },
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => store.path = Err(error.to_string()),
            }
        }
        store
    }
    #[cfg(test)]
    fn save(&mut self, width: Option<f64>, view_mode: Option<ViewMode>) -> Result<(), String> {
        self.save_with_tutorial(width, view_mode, None, None, None)
    }
    fn save_with_tutorial(
        &mut self,
        width: Option<f64>,
        view_mode: Option<ViewMode>,
        completed: Option<bool>,
        collapsed: Option<bool>,
        library_panel: Option<PanelPlacement>,
    ) -> Result<(), String> {
        let width = width.unwrap_or(self.settings.left_width);
        if !valid_width(width) {
            return Err("Invalid Library panel width".into());
        }
        let library_panel = library_panel.unwrap_or(self.settings.library_panel);
        if !library_panel.valid() {
            return Err("Invalid Library tab position".into());
        }
        let settings = Settings {
            version: 1,
            left_width: width,
            left_collapsed: collapsed.unwrap_or(self.settings.left_collapsed),
            library_panel,
            view_mode: view_mode.unwrap_or(self.settings.view_mode),
            tutorial_completed: self.settings.tutorial_completed || completed.unwrap_or(false),
            last_book: self.settings.last_book.clone(),
        };
        self.persist(settings)
    }
    fn persist(&mut self, settings: Settings) -> Result<(), String> {
        let path = self.path.as_ref().map_err(Clone::clone)?;
        let parent = path.parent().ok_or("Missing settings directory")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(&settings).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.persist(path).map_err(|e| e.to_string())?;
        self.settings = settings;
        Ok(())
    }
    pub fn last_book(&self) -> Option<LastBook> {
        self.settings.last_book.clone()
    }
    pub fn remember_book(&mut self, book: Option<LastBook>) -> Result<(), String> {
        let mut settings = self.settings.clone();
        settings.last_book = book;
        self.persist(settings)
    }
}
pub fn remember_book(app: &tauri::AppHandle, book: Option<LastBook>) -> Result<(), String> {
    app.state::<UiSettings>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .remember_book(book)
}
fn valid_width(width: f64) -> bool {
    width.is_finite() && (96.0..=16384.0).contains(&width)
}
pub struct UiSettings(pub Mutex<Store>);

#[tauri::command]
pub fn prepare_main_window(window: tauri::WebviewWindow) -> Result<(), String> {
    crate::preferences::apply_window_theme(&window)?;
    use tauri_plugin_window_state::{StateFlags, WindowExt};
    window
        .restore_state(StateFlags::SIZE | StateFlags::POSITION)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn show_main_window(window: tauri::WebviewWindow) -> Result<(), String> {
    use tauri_plugin_window_state::{StateFlags, WindowExt};
    // Maximizing can make a Windows HWND visible, so defer it until the shell is ready.
    let restored = window.restore_state(StateFlags::MAXIMIZED);
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    restored.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_ui_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    Ok(app
        .state::<UiSettings>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .settings
        .clone())
}
#[tauri::command]
pub fn save_ui_settings(
    app: tauri::AppHandle,
    left_width: Option<f64>,
    view_mode: Option<ViewMode>,
    tutorial_completed: Option<bool>,
    left_collapsed: Option<bool>,
    library_panel: Option<PanelPlacement>,
) -> Result<(), String> {
    app.state::<UiSettings>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .save_with_tutorial(
            left_width,
            view_mode,
            tutorial_completed,
            left_collapsed,
            library_panel,
        )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn last_book_survives_ui_updates_restart_and_explicit_close() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ui-settings.json");
        let mut store = Store::new(Ok(path.clone()));
        assert_eq!(store.last_book(), None);
        store
            .remember_book(Some(LastBook::Library { item_id: 42 }))
            .unwrap();
        store.save(Some(350.0), Some(ViewMode::Continuous)).unwrap();
        let mut reopened = Store::new(Ok(path.clone()));
        assert_eq!(
            reopened.last_book(),
            Some(LastBook::Library { item_id: 42 })
        );
        let json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(json["lastBook"]["itemId"], 42);
        let external = LastBook::External {
            path: dir.path().join("Книга.djvu"),
        };
        reopened.remember_book(Some(external.clone())).unwrap();
        assert_eq!(Store::new(Ok(path.clone())).last_book(), Some(external));
        reopened.remember_book(None).unwrap();
        assert_eq!(Store::new(Ok(path)).last_book(), None);
    }
    #[test]
    fn library_tab_migrates_and_survives_partial_updates() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ui-settings.json");
        std::fs::write(&path, br#"{"version":1,"leftWidth":347.5}"#).unwrap();
        let mut store = Store::new(Ok(path.clone()));
        assert_eq!(store.settings.library_panel, PanelPlacement::default());
        let placement = PanelPlacement {
            side: PanelSide::Right,
            tab_position: 0.8,
        };
        store
            .save_with_tutorial(None, None, None, Some(true), Some(placement))
            .unwrap();
        store.save(Some(390.0), Some(ViewMode::Facing)).unwrap();
        let reopened = Store::new(Ok(path.clone()));
        assert_eq!(reopened.settings.library_panel, placement);
        assert!(reopened.settings.left_collapsed);
        let before = std::fs::read(&path).unwrap();
        assert!(
            store
                .save_with_tutorial(
                    None,
                    None,
                    None,
                    None,
                    Some(PanelPlacement {
                        tab_position: 1.1,
                        ..placement
                    })
                )
                .is_err()
        );
        assert_eq!(std::fs::read(path).unwrap(), before);
    }
    #[test]
    fn tutorial_completion_is_sticky_and_survives_partial_updates_and_restart() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ui-settings.json");
        std::fs::write(&path, br#"{"version":1,"leftWidth":347.5}"#).unwrap();
        let mut store = Store::new(Ok(path.clone()));
        assert!(!store.settings.tutorial_completed);
        store
            .save_with_tutorial(None, None, Some(true), None, None)
            .unwrap();
        store.save(Some(420.), Some(ViewMode::Facing)).unwrap();
        store
            .save_with_tutorial(None, None, Some(false), None, None)
            .unwrap();
        let reopened = Store::new(Ok(path));
        assert!(reopened.settings.tutorial_completed);
        assert_eq!(reopened.settings.left_width, 420.);
        assert_eq!(reopened.settings.view_mode, ViewMode::Facing);
    }
    #[test]
    fn view_mode_migrates_and_independent_updates_preserve_both_preferences() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ui-settings.json");
        std::fs::write(&path, br#"{"version":1,"leftWidth":347.5}"#).unwrap();
        let mut store = Store::new(Ok(path.clone()));
        assert_eq!(store.settings.view_mode, ViewMode::Single);
        store.save(None, Some(ViewMode::Continuous)).unwrap();
        store.save(Some(420.0), None).unwrap();
        let reopened = Store::new(Ok(path.clone()));
        assert_eq!(reopened.settings.view_mode, ViewMode::Continuous);
        assert_eq!(reopened.settings.left_width, 420.0);
        let invalid = br#"{"version":1,"leftWidth":420,"viewMode":"unknown"}"#;
        std::fs::write(&path, invalid).unwrap();
        assert!(
            Store::new(Ok(path.clone()))
                .save(None, Some(ViewMode::Single))
                .is_err()
        );
        assert_eq!(std::fs::read(path).unwrap(), invalid);
    }
    #[test]
    fn panel_width_survives_restart_and_bad_settings_are_preserved() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("ui-settings.json");
        let mut store = Store::new(Ok(path.clone()));
        assert_eq!(store.settings.left_width, 290.0);
        store.save(Some(347.5), None).unwrap();
        assert!(store.save(Some(f64::NAN), None).is_err());
        assert!(store.save(Some(0.0), None).is_err());
        assert_eq!(Store::new(Ok(path.clone())).settings.left_width, 347.5);
        std::fs::write(&path, b"{invalid}").unwrap();
        assert!(
            Store::new(Ok(path.clone()))
                .save(Some(300.0), None)
                .is_err()
        );
        assert_eq!(std::fs::read(path).unwrap(), b"{invalid}");
    }
}
