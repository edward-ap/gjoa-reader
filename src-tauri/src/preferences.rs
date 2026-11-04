use crate::reader::document::PageAppearance;
use serde::{Deserialize, Serialize};
use std::{io::Write, path::PathBuf, sync::Mutex};
use tauri::Manager;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Language {
    System,
    #[default]
    En,
    Ru,
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiTheme {
    #[default]
    System,
    Light,
    Dark,
    Custom,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomTheme {
    pub foundation: String,
    pub definition: Option<serde_json::Value>,
    pub tokens: std::collections::BTreeMap<String, String>,
    pub families: std::collections::BTreeMap<String, std::collections::BTreeMap<String, String>>,
}
impl CustomTheme {
    fn validate(&self) -> bool {
        fn colors(tokens: &std::collections::BTreeMap<String, String>) -> bool {
            tokens.len() <= 1024
                && tokens.iter().all(|(key, value)| {
                    key.starts_with("--dui-")
                        && key.len() <= 120
                        && key
                            .bytes()
                            .all(|c| c.is_ascii_alphabetic() || c.is_ascii_digit() || c == b'-')
                        && value.len() == 7
                        && value.starts_with('#')
                        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
                })
        }
        matches!(self.foundation.as_str(), "light" | "dark")
            && self
                .definition
                .as_ref()
                .is_none_or(|d| d.is_object() && d.to_string().len() <= 20000)
            && colors(&self.tokens)
            && self.families.len() <= 4
            && self.families.iter().all(|(role, tokens)| {
                matches!(
                    role.as_str(),
                    "primary" | "secondary" | "tertiary" | "accent"
                ) && colors(tokens)
            })
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub version: u32,
    pub language: Language,
    pub ui_theme: UiTheme,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_theme: Option<CustomTheme>,
    pub page_appearance: PageAppearance,
    pub workspace_background: String,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            language: Language::En,
            ui_theme: UiTheme::System,
            custom_theme: None,
            page_appearance: PageAppearance::Original,
            workspace_background: "#484c50".into(),
        }
    }
}
impl Settings {
    fn validate(&self) -> Result<(), String> {
        let color = self.workspace_background.as_bytes();
        if self.version != 1
            || self
                .custom_theme
                .as_ref()
                .is_some_and(|theme| !theme.validate())
            || color.len() != 7
            || color[0] != b'#'
            || !color[1..].iter().all(u8::is_ascii_hexdigit)
        {
            return Err("Invalid application settings".into());
        }
        Ok(())
    }
}
pub struct Store {
    path: Result<PathBuf, String>,
    value: Settings,
}
impl Store {
    pub fn new(path: Result<PathBuf, String>) -> Self {
        let mut store = Self {
            path,
            value: Settings::default(),
        };
        if let Ok(path) = &store.path {
            match std::fs::read(path) {
                Ok(bytes) => match serde_json::from_slice::<Settings>(&bytes) {
                    Ok(value) if value.validate().is_ok() => store.value = value,
                    _ => store.path = Err("Invalid settings.json; original file preserved".into()),
                },
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => store.path = Err(e.to_string()),
            }
        }
        store
    }
    fn save(&mut self, value: Settings) -> Result<(), String> {
        value.validate()?;
        let path = self.path.as_ref().map_err(Clone::clone)?;
        std::fs::create_dir_all(path.parent().ok_or("Missing settings directory")?)
            .map_err(|e| e.to_string())?;
        let mut file =
            tempfile::NamedTempFile::new_in(path.parent().unwrap()).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec(&value).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.persist(path).map_err(|e| e.to_string())?;
        self.value = value;
        Ok(())
    }
}
pub struct Preferences(pub Mutex<Store>);
#[tauri::command]
pub fn read_settings(app: tauri::AppHandle) -> Result<Settings, String> {
    Ok(app
        .state::<Preferences>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .value
        .clone())
}
#[tauri::command]
pub fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    app.state::<Preferences>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .save(settings)?;
    if let Some(window) = app.get_webview_window("main") {
        apply_window_theme(&window)?;
    }
    Ok(())
}
pub fn apply_window_theme(window: &tauri::WebviewWindow) -> Result<(), String> {
    let preferences = window
        .app_handle()
        .state::<Preferences>()
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .value
        .clone();
    let theme = match preferences.ui_theme {
        UiTheme::System => None,
        UiTheme::Light => Some(tauri::Theme::Light),
        UiTheme::Dark => Some(tauri::Theme::Dark),
        UiTheme::Custom => Some(
            if preferences
                .custom_theme
                .as_ref()
                .is_some_and(|t| t.foundation == "dark")
            {
                tauri::Theme::Dark
            } else {
                tauri::Theme::Light
            },
        ),
    };
    window.set_theme(theme).map_err(|e| e.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn english_defaults_keep_legacy_language_settings_readable() {
        assert_eq!(Language::default(), Language::En);
        assert_eq!(Settings::default().language, Language::En);
        assert_eq!(
            serde_json::from_str::<Settings>("{}").unwrap().language,
            Language::En
        );
        // New profiles start in English; explicit historical values retain their
        // JSON meaning so opening a saved settings file never changes its data.
        for (encoded, expected) in [
            ("system", Language::System),
            ("en", Language::En),
            ("ru", Language::Ru),
        ] {
            let mut value = serde_json::to_value(Settings::default()).unwrap();
            value["language"] = encoded.into();
            let settings: Settings = serde_json::from_value(value).unwrap();
            assert_eq!(settings.language, expected);
            assert_eq!(serde_json::to_value(settings).unwrap()["language"], encoded);
        }
    }

    #[test]
    fn custom_theme_persists_and_reset_removes_it() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("settings.json");
        let mut store = Store::new(Ok(path.clone()));
        let theme = CustomTheme {
            foundation: "dark".into(),
            definition: None,
            tokens: [("--dui-color-text".into(), "#abcdef".into())].into(),
            families: Default::default(),
        };
        let value = Settings {
            ui_theme: UiTheme::Custom,
            custom_theme: Some(theme.clone()),
            ..Settings::default()
        };
        store.save(value.clone()).unwrap();
        assert_eq!(Store::new(Ok(path.clone())).value, value);
        let mut invalid = theme;
        invalid
            .tokens
            .insert("--dui-color-text".into(), "url(https://example.com)".into());
        assert!(
            store
                .save(Settings {
                    custom_theme: Some(invalid),
                    ..value
                })
                .is_err()
        );
        store.save(Settings::default()).unwrap();
        assert_eq!(Store::new(Ok(path.clone())).value, Settings::default());
        assert!(
            !std::fs::read_to_string(path)
                .unwrap()
                .contains("customTheme")
        );
    }
    #[test]
    fn defaults_roundtrip_validation_and_corrupt_preservation() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("settings.json");
        let mut store = Store::new(Ok(path.clone()));
        assert_eq!(store.value, Settings::default());
        let value = Settings {
            language: Language::Ru,
            ui_theme: UiTheme::Dark,
            page_appearance: PageAppearance::Night,
            workspace_background: "#123aBc".into(),
            ..Settings::default()
        };
        let custom = Settings {
            page_appearance: PageAppearance::Custom([123, 45, 67]),
            ..value.clone()
        };
        store.save(custom.clone()).unwrap();
        assert_eq!(Store::new(Ok(path.clone())).value, custom);
        assert!(
            serde_json::from_str::<Settings>(r#"{"pageAppearance":{"custom":[256,0,0]}}"#).is_err()
        );
        store.save(value.clone()).unwrap();
        assert_eq!(Store::new(Ok(path.clone())).value, value);
        for color in ["red", "#000", "#ffffff00", "#zzzzzz", ""] {
            assert!(
                store
                    .save(Settings {
                        workspace_background: color.into(),
                        ..value.clone()
                    })
                    .is_err()
            );
        }
        assert_eq!(Store::new(Ok(path.clone())).value, value);
        std::fs::write(&path, b"{\"version\":99}").unwrap();
        let mut broken = Store::new(Ok(path.clone()));
        assert!(broken.save(value).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"{\"version\":99}");
        assert!(serde_json::from_str::<Settings>(r#"{"language":"xx"}"#).is_err());
        assert_eq!(
            serde_json::from_str::<Settings>("{}").unwrap(),
            Settings::default()
        );
    }
}
