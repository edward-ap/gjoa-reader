use flate2::{Compression, write::ZlibEncoder};
use sha2::{Digest, Sha256};
use std::{env, fs, io::Write, path::PathBuf};
fn main() {
    let out = PathBuf::from(env::var_os("OUT_DIR").unwrap());
    let names = [
        "PT_Serif-Web-Regular.ttf",
        "PT_Serif-Web-Italic.ttf",
        "PT_Serif-Web-Bold.ttf",
        "PT_Serif-Web-BoldItalic.ttf",
        "NotoEmoji.ttf",
        "NotoSansMono-Regular.ttf",
        "NotoSerifJP-Regular.ttf",
        "Literata-Regular.ttf",
        "Literata-Italic.ttf",
        "Literata-Bold.ttf",
        "Literata-BoldItalic.ttf",
    ];
    let mut generated = String::from("static PACKED: [PackedFont; 11] = [\n");
    for (index, name) in names.iter().enumerate() {
        let path = PathBuf::from("assets/fonts").join(name);
        println!("cargo:rerun-if-changed={}", path.display());
        let bytes = fs::read(path).unwrap();
        let hash = format!("{:x}", Sha256::digest(&bytes));
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(&bytes).unwrap();
        let packed = encoder.finish().unwrap();
        fs::write(out.join(format!("font-{index}.zlib")), packed).unwrap();
        generated.push_str(&format!("PackedFont {{ data: include_bytes!(concat!(env!(\"OUT_DIR\"), \"/font-{index}.zlib\")), length: {}, hash: \"{hash}\" }},\n", bytes.len()));
    }
    generated.push_str("];\n");
    fs::write(out.join("packed_fonts.rs"), generated).unwrap();
    tauri_build::build()
}
