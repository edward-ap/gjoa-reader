//! Bounded owned structure evidence, extracted only on the PDFium worker.
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};
#[derive(Default, Serialize, Deserialize)]
pub struct SemanticPage {
    pub groups: Vec<SemanticGroup>,
    pub char_mcids: Vec<i32>,
}
#[derive(Serialize, Deserialize)]
pub struct SemanticGroup {
    pub role: String,
    pub mcids: Vec<i32>,
}
pub fn extract(b: &dyn PdfiumLibraryBindings, path: &Path) -> Result<Vec<SemanticPage>, String> {
    // All raw handles are local to this worker invocation and closed before return.
    unsafe {
        let doc = b.FPDF_LoadDocument(path.to_str().ok_or("Non-Unicode PDF path")?, None);
        if doc.is_null() {
            return Err("Cannot open PDF structure".into());
        }
        let result = (|| {
            let count = b.FPDF_GetPageCount(doc);
            if !(1..=3000).contains(&count) {
                return Err("Structure page budget".into());
            }
            let mut pages = vec![];
            for index in 0..count {
                let page = b.FPDF_LoadPage(doc, index);
                if page.is_null() {
                    return Err("Cannot load structure page".into());
                }
                let tp = b.FPDFText_LoadPage(page);
                let tree = b.FPDF_StructTree_GetForPage(page);
                let one: Result<SemanticPage, String> = (|| {
                    if tp.is_null() {
                        return Err("Cannot load structure text".into());
                    }
                    let mut data = SemanticPage::default();
                    let n = b.FPDFText_CountChars(tp);
                    if !(0..=30000).contains(&n) {
                        return Err("Structure character budget".into());
                    }
                    for i in 0..n {
                        let obj = b.FPDFText_GetTextObject(tp, i);
                        data.char_mcids.push(if obj.is_null() {
                            -1
                        } else {
                            b.FPDFPageObj_GetMarkedContentID(obj)
                        });
                    }
                    let mut budget = 0;
                    if !tree.is_null() {
                        for i in 0..b.FPDF_StructTree_CountChildren(tree) {
                            walk(
                                b,
                                b.FPDF_StructTree_GetChildAtIndex(tree, i).cast(),
                                0,
                                &mut budget,
                                &mut data.groups,
                            )?;
                        }
                    }
                    Ok(data)
                })();
                if !tree.is_null() {
                    b.FPDF_StructTree_Close(tree);
                }
                if !tp.is_null() {
                    b.FPDFText_ClosePage(tp);
                }
                b.FPDF_ClosePage(page);
                pages.push(one?);
            }
            Ok(pages)
        })();
        b.FPDF_CloseDocument(doc);
        result
    }
}
unsafe fn walk(
    b: &dyn PdfiumLibraryBindings,
    raw: *mut std::ffi::c_void,
    depth: usize,
    budget: &mut usize,
    out: &mut Vec<SemanticGroup>,
) -> Result<Vec<i32>, String> {
    if raw.is_null() {
        return Ok(vec![]);
    }
    let e = raw.cast();
    *budget += 1;
    if depth > 32 || *budget > 20000 {
        return Err("Structure node budget".into());
    }
    unsafe {
        let len = b.FPDF_StructElement_GetType(e, std::ptr::null_mut(), 0);
        if len > 1024 {
            return Err("Structure type budget".into());
        }
        let mut bytes = vec![0u8; len as usize];
        b.FPDF_StructElement_GetType(e, bytes.as_mut_ptr().cast(), len);
        let role = String::from_utf16_lossy(
            &bytes
                .chunks_exact(2)
                .map(|v| u16::from_le_bytes([v[0], v[1]]))
                .collect::<Vec<_>>(),
        )
        .trim_end_matches('\0')
        .to_owned();
        let mut ids = BTreeMap::new();
        let n = b.FPDF_StructElement_GetMarkedContentIdCount(e);
        if n > 100000 {
            return Err("Structure content budget".into());
        }
        for i in 0..n {
            let id = b.FPDF_StructElement_GetMarkedContentIdAtIndex(e, i);
            if id >= 0 {
                ids.insert(id, ());
            }
        }
        let begin = out.len();
        for i in 0..b.FPDF_StructElement_CountChildren(e) {
            for id in walk(
                b,
                b.FPDF_StructElement_GetChildAtIndex(e, i).cast(),
                depth + 1,
                budget,
                out,
            )? {
                ids.insert(id, ());
            }
        }
        let ids: Vec<_> = ids.into_keys().collect();
        if (role == "P" || role.starts_with('H') || role == "Figure") && !ids.is_empty() {
            out.truncate(begin);
            out.push(SemanticGroup {
                role,
                mcids: ids.clone(),
            });
        }
        Ok(ids)
    }
}
