//! Private document export uses an explicit native save dialog, never an
//! arbitrary renderer-supplied filesystem path or a public media URL.
use base64::{engine::general_purpose::STANDARD, Engine as _};

use super::{export_util::save_bytes_with_dialog, media::sanitize_filename};

const MAX_BYTES: usize = 10 * 1024 * 1024;

fn decode_document(encoded: &str, filename: &str) -> Result<Vec<u8>, String> {
    if encoded.len() > MAX_BYTES.div_ceil(3) * 4 {
        return Err("Knowledge document exceeds 10 MB".into());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid document encoding")?;
    if bytes.is_empty() || bytes.len() > MAX_BYTES {
        return Err("Invalid knowledge document size".into());
    }
    let extension = filename
        .rsplit('.')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let valid = match extension.as_str() {
        "pdf" => bytes.starts_with(b"%PDF-"),
        "docx" => bytes.starts_with(b"PK\x03\x04"),
        "txt" | "md" => std::str::from_utf8(&bytes).is_ok() && !bytes.contains(&0),
        _ => false,
    };
    if !valid {
        return Err("Unsupported knowledge document".into());
    }
    Ok(bytes)
}

/// Save an already-authorized private original or Markdown through the OS dialog.
#[tauri::command]
pub async fn save_knowledge_document(
    app: tauri::AppHandle,
    filename: String,
    content_base64: String,
) -> Result<bool, String> {
    let filename = sanitize_filename(&filename);
    let bytes = decode_document(&content_base64, &filename)?;
    let extension = filename.rsplit('.').next().unwrap_or("txt");
    save_bytes_with_dialog(&app, &filename, "Knowledge document", &[extension], &bytes).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn private_export_is_bounded_and_cannot_save_executable_types() {
        assert_eq!(
            decode_document(&STANDARD.encode("Вода"), "guide.md").unwrap(),
            "Вода".as_bytes()
        );
        for name in ["script.js", "program.exe", "fake.pdf", "fake.docx"] {
            assert!(decode_document(&STANDARD.encode("Text"), name).is_err());
        }
        assert!(decode_document("", "empty.txt").is_err());
        assert!(decode_document(&"A".repeat(MAX_BYTES.div_ceil(3) * 4 + 4), "big.txt").is_err());
    }
}
