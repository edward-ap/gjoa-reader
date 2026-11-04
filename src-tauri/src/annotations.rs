use crate::{reader::document::Result, state::ReaderState};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
    sync::Mutex,
};
use tauri::Manager;

const MAX_BYTES: usize = 8 * 1024 * 1024;
pub fn identity(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
pub struct Store {
    connection: Connection,
    // Issued page capabilities hold geometry, never documents or native file handles.
    issued: BTreeMap<(String, usize), (u32, u32)>,
}
pub struct AnnotationState(pub Mutex<Result<Store>>);
#[derive(Serialize)]
pub struct PageAnnotations {
    key: String,
    document: Option<Value>,
}
impl Store {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let connection = Connection::open(path).map_err(|e| e.to_string())?;
        let version: u32 = connection
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .map_err(|e| e.to_string())?;
        if version > 1 {
            return Err("Unsupported annotation database; original preserved".into());
        }
        connection.execute_batch("PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS page_annotations (edition TEXT NOT NULL, page INTEGER NOT NULL, model TEXT NOT NULL, PRIMARY KEY(edition,page)); PRAGMA user_version=1;").map_err(|e| e.to_string())?;
        Ok(Self {
            connection,
            issued: BTreeMap::new(),
        })
    }
    fn read(&mut self, key: &str, page: usize, width: u32, height: u32) -> Result<PageAnnotations> {
        let bytes: Option<String> = self
            .connection
            .query_row(
                "SELECT model FROM page_annotations WHERE edition=?1 AND page=?2",
                params![key, page as i64],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let document = bytes
            .map(|s| -> Result<Value> {
                if s.len() > MAX_BYTES {
                    return Err("Annotation page exceeds size limit".into());
                }
                let model: Value = serde_json::from_str(&s)
                    .map_err(|e| format!("Invalid saved annotations; original preserved: {e}"))?;
                validate(&model, width, height)?;
                Ok(model)
            })
            .transpose()?;
        self.issued.insert((key.to_owned(), page), (width, height));
        Ok(PageAnnotations {
            key: key.to_owned(),
            document,
        })
    }
    fn save(&mut self, key: &str, page: usize, document: &Value) -> Result<()> {
        let &(width, height) = self
            .issued
            .get(&(key.to_owned(), page))
            .ok_or("Annotation page was not opened successfully")?;
        validate(document, width, height)?;
        let json = serde_json::to_string(document).map_err(|e| e.to_string())?;
        if json.len() > MAX_BYTES {
            return Err("Annotation page exceeds size limit".into());
        }
        self.connection.execute("INSERT INTO page_annotations(edition,page,model) VALUES (?1,?2,?3) ON CONFLICT(edition,page) DO UPDATE SET model=excluded.model", params![key, page as i64, json]).map_err(|e| e.to_string())?;
        Ok(())
    }
}
fn number(value: &Value, min: f64, max: f64) -> Result<f64> {
    value
        .as_f64()
        .filter(|n| n.is_finite() && *n >= min && *n <= max)
        .ok_or_else(|| "Invalid annotation coordinate/style".into())
}
fn validate(model: &Value, width: u32, height: u32) -> Result<()> {
    let (w, h) = (f64::from(width), f64::from(height));
    if model["kind"] != "DenseUI.Painter"
        || model["version"] != 1
        || model["width"].as_f64() != Some(w)
        || model["height"].as_f64() != Some(h)
    {
        return Err("Unsupported annotation schema or page geometry".into());
    }
    let objects = model["objects"]
        .as_array()
        .ok_or("Invalid annotation objects")?;
    if objects.len() > 5000 {
        return Err("Too many annotation objects".into());
    }
    let mut ids = BTreeSet::new();
    let mut count = 0;
    for object in objects {
        let id = object["id"].as_str().ok_or("Invalid annotation ID")?;
        if id.is_empty() || id.len() > 128 || !ids.insert(id) {
            return Err("Invalid/duplicate annotation ID".into());
        }
        let style = &object["style"];
        let color = style["color"].as_str().ok_or("Invalid annotation color")?;
        if color.len() != 7
            || !color.starts_with('#')
            || !color[1..].bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Invalid annotation color".into());
        }
        number(&style["strokeWidth"], 0.1, 1000.0)?;
        number(&style["opacity"], 0.0, 1.0)?;
        number(&style["fontSize"], 1.0, 1000.0)?;
        if let Some(dash) = style.get("dash")
            && !matches!(dash.as_str(), Some("solid" | "dashed"))
        {
            return Err("Invalid annotation stroke dash".into());
        }
        match object["type"].as_str() {
            Some(kind @ ("pen" | "marker" | "line" | "arrow")) => {
                let points = object["points"]
                    .as_array()
                    .ok_or("Invalid annotation points")?;
                count += points.len();
                if points.is_empty()
                    || points.len() > 10000
                    || count > 200000
                    || (matches!(kind, "line" | "arrow") && points.len() != 2)
                {
                    return Err("Invalid annotation point count".into());
                }
                for point in points {
                    number(&point["x"], 0.0, w)?;
                    number(&point["y"], 0.0, h)?;
                }
            }
            Some(kind @ ("rectangle" | "ellipse" | "text")) => {
                let x = number(&object["x"], 0.0, w)?;
                let y = number(&object["y"], 0.0, h)?;
                let ow = number(&object["width"], 0.0, w)?;
                let oh = number(&object["height"], 0.0, h)?;
                if x + ow > w + 1e-7 || y + oh > h + 1e-7 {
                    return Err("Annotation outside page".into());
                }
                if kind == "text"
                    && object["text"]
                        .as_str()
                        .is_none_or(|s| s.encode_utf16().count() > 10000)
                {
                    return Err("Invalid annotation text".into());
                }
            }
            _ => return Err("Invalid annotation type".into()),
        }
    }
    Ok(())
}
#[tauri::command]
pub async fn read_page_annotations(
    app: tauri::AppHandle,
    document_id: u64,
    page_index: usize,
) -> Result<PageAnnotations> {
    let doc = app.state::<ReaderState>().get(document_id)?;
    if page_index >= doc.info.page_count {
        return Err("Annotation page out of range".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let info = doc.document.page_info(page_index)?;
        let state = app.state::<AnnotationState>();
        let mut state = state.0.lock().map_err(|e| e.to_string())?;
        state
            .as_mut()
            .map_err(|e| format!("Annotations unavailable: {e}"))?
            .read(&doc.annotation_key, page_index, info.width, info.height)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn save_page_annotations(
    app: tauri::AppHandle,
    key: String,
    page_index: usize,
    document: Value,
) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AnnotationState>();
        let mut state = state.0.lock().map_err(|e| e.to_string())?;
        state
            .as_mut()
            .map_err(|e| format!("Annotations unavailable: {e}"))?
            .save(&key, page_index, &document)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn model() -> Value {
        json!({"kind":"DenseUI.Painter","version":1,"width":800,"height":1120,"objects":[{"id":"a","type":"line","points":[{"x":20,"y":30},{"x":200,"y":30}],"style":{"color":"#247d39","strokeWidth":2,"opacity":1,"fontSize":20}}]})
    }
    #[test]
    fn durable_reopen_isolated_pages_delete_and_rejected_writes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("annotations.sqlite");
        let mut s = Store::open(&path).unwrap();
        assert!(s.save("a", 0, &model()).is_err());
        s.read("a", 0, 800, 1120).unwrap();
        s.save("a", 0, &model()).unwrap();
        let mut bad = model();
        bad["objects"][0]["points"][0]["x"] = json!(-1);
        assert!(s.save("a", 0, &bad).is_err());
        drop(s);
        let mut s = Store::open(&path).unwrap();
        assert_eq!(s.read("a", 0, 800, 1120).unwrap().document, Some(model()));
        assert!(s.read("a", 1, 800, 1120).unwrap().document.is_none());
        assert!(s.read("b", 0, 800, 1120).unwrap().document.is_none());
        let mut blank = model();
        blank["objects"] = json!([]);
        s.save("a", 0, &blank).unwrap();
        drop(s);
        assert_eq!(
            Store::open(&path)
                .unwrap()
                .read("a", 0, 800, 1120)
                .unwrap()
                .document,
            Some(blank)
        );
    }
    #[test]
    fn malformed_saved_data_is_preserved_and_not_authorized_for_overwrite() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = Store::open(&dir.path().join("notes.sqlite")).unwrap();
        s.connection
            .execute("INSERT INTO page_annotations VALUES ('a',0,'broken')", [])
            .unwrap();
        assert!(s.read("a", 0, 800, 1120).is_err());
        assert!(s.save("a", 0, &model()).is_err());
        let text: String = s
            .connection
            .query_row("SELECT model FROM page_annotations", [], |r| r.get(0))
            .unwrap();
        assert_eq!(text, "broken");
        assert!(validate(&model(), 801, 1120).is_err());
        let mut bad = model();
        bad["objects"][0]["type"] = json!("script");
        assert!(validate(&bad, 800, 1120).is_err());
    }
    #[test]
    fn optional_dash_survives_restart_and_invalid_dash_preserves_last_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("notes.sqlite");
        let mut store = Store::open(&path).unwrap();
        store.read("a", 0, 800, 1120).unwrap();
        let mut dashed = model();
        dashed["objects"][0]["style"]["dash"] = json!("dashed");
        store.save("a", 0, &dashed).unwrap();
        let mut invalid = dashed.clone();
        invalid["objects"][0]["style"]["dash"] = json!("unknown");
        assert!(store.save("a", 0, &invalid).is_err());
        drop(store);
        assert_eq!(
            Store::open(&path)
                .unwrap()
                .read("a", 0, 800, 1120)
                .unwrap()
                .document,
            Some(dashed)
        );
        assert!(validate(&model(), 800, 1120).is_ok());
    }
}
