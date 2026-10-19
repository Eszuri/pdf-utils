use printpdf::{
    Mm, Op, PdfDocument, PdfPage, PdfSaveOptions, Pt, RawImage, RawImageData,
    RawImageFormat, XObjectTransform,
};
use lopdf::{dictionary, Document, Object};
use std::collections::HashMap;

fn remap_references(obj: &Object, id_map: &HashMap<(u32, u16), (u32, u16)>) -> Object {
    match obj {
        Object::Reference((n, g)) => {
            if let Some(&new_id) = id_map.get(&(*n, *g)) {
                Object::Reference(new_id)
            } else {
                obj.clone()
            }
        }
        Object::Array(items) => Object::Array(
            items.iter().map(|i| remap_references(i, id_map)).collect(),
        ),
        Object::Dictionary(dict) => {
            let mut new_dict = dict.clone();
            for (_, v) in new_dict.iter_mut() {
                *v = remap_references(v, id_map);
            }
            Object::Dictionary(new_dict)
        }
        Object::Stream(stream) => {
            let mut new_stream = stream.clone();
            new_stream.dict = match remap_references(&Object::Dictionary(stream.dict.clone()), id_map)
            {
                Object::Dictionary(d) => d,
                _ => stream.dict.clone(),
            };
            Object::Stream(new_stream)
        }
        _ => obj.clone(),
    }
}


#[tauri::command]
pub fn images_to_pdf(image_paths: Vec<String>, output_path: String) -> Result<(), String> {
    if image_paths.is_empty() {
        return Err("No images selected".to_string());
    }

    let mut doc = PdfDocument::new("Images");
    let mut pages = Vec::new();

    for path in &image_paths {
        let img_bytes = std::fs::read(path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
        let img = image::load_from_memory(&img_bytes)
            .map_err(|e| format!("Image decode error for {}: {}", path, e))?;
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();

        let raw_image = RawImage {
            pixels: RawImageData::U8(rgba.into_raw()),
            width: w as usize,
            height: h as usize,
            data_format: RawImageFormat::RGBA8,
            tag: Vec::new(),
        };

        let is_landscape = w > h;
        let (page_w_mm, page_h_mm) = if is_landscape {
            (297.0, 210.0)
        } else {
            (210.0, 297.0)
        };

        let margin_mm = 15.0;
        let max_w_mm = page_w_mm - (2.0 * margin_mm);
        let max_h_mm = page_h_mm - (2.0 * margin_mm);

        let scale_w = max_w_mm / w as f32;
        let scale_h = max_h_mm / h as f32;
        let scale = scale_w.min(scale_h);

        let img_width_mm = w as f32 * scale;
        let img_height_mm = h as f32 * scale;
        let x_mm = (page_w_mm - img_width_mm) / 2.0;
        let y_mm = (page_h_mm - img_height_mm) / 2.0;

        let img_width_pt = img_width_mm * 72.0 / 25.4;
        let img_height_pt = img_height_mm * 72.0 / 25.4;

        let image_id = doc.add_image(&raw_image);

        let ops = vec![Op::UseXobject {
            id: image_id,
            transform: XObjectTransform {
                translate_x: Some(Pt(x_mm * 72.0 / 25.4)),
                translate_y: Some(Pt(y_mm * 72.0 / 25.4)),
                scale_x: Some(img_width_pt / w as f32),
                scale_y: Some(img_height_pt / h as f32),
                dpi: Some(72.0),
                ..Default::default()
            },
        }];

        pages.push(PdfPage::new(Mm(page_w_mm), Mm(page_h_mm), ops));
    }

    let bytes = doc
        .with_pages(pages)
        .save(&PdfSaveOptions::default(), &mut Vec::new());

    if bytes.is_empty() {
        return Err("Generated PDF is empty".to_string());
    }
    std::fs::write(&output_path, &bytes).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn merge_pdfs(input_paths: Vec<String>, output_path: String) -> Result<(), String> {
    if input_paths.is_empty() {
        return Err("No PDFs selected".to_string());
    }

    let mut result = Document::load(&input_paths[0]).map_err(|e| e.to_string())?;
    result.decompress();

    // Keep each document's page tree intact under a neutral root. Reparenting
    // individual pages loses inherited Resources, MediaBox, CropBox and Rotate.
    let first_root = result
        .catalog()
        .and_then(|c| c.get(b"Pages"))
        .and_then(Object::as_reference)
        .map_err(|e| e.to_string())?;
    let mut page_count = result.get_pages().len() as i64;
    let pages_root_id = result.add_object(dictionary! {
        "Type" => "Pages",
        "Kids" => vec![Object::Reference(first_root)],
        "Count" => page_count,
    });
    result
        .get_dictionary_mut(first_root)
        .map_err(|e| e.to_string())?
        .set("Parent", pages_root_id);
    result
        .catalog_mut()
        .map_err(|e| e.to_string())?
        .set("Pages", pages_root_id);

    for path in &input_paths[1..] {
        let mut doc = Document::load(path).map_err(|e| e.to_string())?;
        doc.decompress();
        let source_root = doc
            .catalog()
            .and_then(|c| c.get(b"Pages"))
            .and_then(Object::as_reference)
            .map_err(|e| e.to_string())?;
        page_count += doc.get_pages().len() as i64;

        let offset = result.max_id;
        let old_ids: Vec<(u32, u16)> = doc.objects.keys().copied().collect();
        let mut id_map = HashMap::new();
        for (i, &old_id) in old_ids.iter().enumerate() {
            let new_id = (offset + 1 + i as u32, old_id.1);
            id_map.insert(old_id, new_id);
        }

        let imported_root = id_map[&source_root];

        for (&old_id, obj) in &doc.objects {
            let &new_id = &id_map[&old_id];
            let remapped = remap_references(obj, &id_map);
            result.objects.insert(new_id, remapped);
        }
        result.max_id = offset + old_ids.len() as u32;

        result
            .get_dictionary_mut(imported_root)
            .map_err(|e| e.to_string())?
            .set("Parent", pages_root_id);
        let pages_dict = result
            .get_dictionary_mut(pages_root_id)
            .map_err(|e| e.to_string())?;
        pages_dict
            .get_mut(b"Kids")
            .and_then(Object::as_array_mut)
            .map_err(|e| e.to_string())?
            .push(Object::Reference(imported_root));
        pages_dict.set("Count", page_count);
    }

    result.save(&output_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn split_pdf(input_path: String, pages: Vec<u32>, output_path: String) -> Result<(), String> {
    if pages.is_empty() {
        return Err("No pages selected".to_string());
    }

    let mut doc = Document::load(&input_path).map_err(|e| e.to_string())?;
    let total_pages = doc.get_pages().len() as u32;

    for &page_num in &pages {
        if page_num == 0 || page_num > total_pages {
            return Err(format!(
                "Invalid page number: {}. Total pages: {}",
                page_num, total_pages
            ));
        }
    }

    let all_pages: Vec<u32> = (1..=total_pages).collect();
    let to_delete: Vec<u32> = all_pages
        .iter()
        .filter(|p| !pages.contains(p))
        .copied()
        .collect();

    doc.delete_pages(&to_delete);
    doc.prune_objects();
    doc.save(&output_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_pdf_info(input_path: String) -> Result<serde_json::Value, String> {
    let doc = Document::load(&input_path).map_err(|e| e.to_string())?;
    let page_count = doc.get_pages().len();
    Ok(serde_json::json!({
        "page_count": page_count
    }))
}

#[tauri::command]
pub fn read_pdf_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_reader_file(data: Vec<u8>, output_path: String) -> Result<(), String> {
    use std::io::Write;
    let output = std::path::PathBuf::from(output_path);
    let parent = output.parent().ok_or("Invalid output directory")?;
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let temporary = parent.join(format!(".pdf-utils-save-{}-{nonce}.tmp", std::process::id()));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| e.to_string())?;
    struct Cleanup(std::path::PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) { let _ = std::fs::remove_file(&self.0); }
    }
    let _cleanup = Cleanup(temporary.clone());
    let write_result = file.write_all(&data).and_then(|_| file.sync_all());
    drop(file);
    write_result.map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, &output).map_err(|e| e.to_string())
}


#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }
    
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| format!("Failed to open finder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::process::Command::new("xdg-open")
                .arg(parent)
                .spawn()
                .map_err(|e| format!("Failed to open file manager: {}", e))?;
        }
    }
    
    Ok(())
}

#[derive(Default, Clone, serde::Serialize, serde::Deserialize)]
pub struct LaunchAction {
    pub mode: String,
    pub file: String,
}

#[derive(Default)]
pub struct LaunchState(pub std::sync::Mutex<Option<LaunchAction>>);

#[tauri::command]
pub fn get_launch_action(state: tauri::State<'_, LaunchState>) -> Option<LaunchAction> {
    state.0.lock().ok()?.take()
}

#[tauri::command]
pub fn get_launch_file(state: tauri::State<'_, LaunchState>) -> Option<String> {
    state.0.lock().ok()?.as_ref().map(|a| a.file.clone())
}

const IMAGE_EXTENSIONS: &[&str] = &[".png", ".jpg", ".jpeg", ".webp", ".bmp"];

#[tauri::command]
pub fn is_context_menu_enabled() -> Result<bool, String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let path = "Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\PDFUtils";
        match hkcu.open_subkey(path) {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(false)
    }
}

#[tauri::command]
pub fn toggle_context_menu(enable: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let pdf_menu_path = "Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\PDFUtils";
        let legacy_word = "Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\PDFUtilsToWord";
        let legacy_open = "Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\PDFUtilsOpen";

        // Clean up legacy keys
        let _ = hkcu.delete_subkey_all(legacy_word);
        let _ = hkcu.delete_subkey_all(legacy_open);

        if enable {
            let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe_str = exe_path.to_string_lossy();
            let icon_val = format!("\"{}\",0", exe_str);

            // 1. Cascading Context Menu for .pdf
            let (pdf_key, _) = hkcu.create_subkey(pdf_menu_path).map_err(|e| e.to_string())?;
            pdf_key.set_value("", &"PDF Utils").map_err(|e| e.to_string())?;
            pdf_key.set_value("MUIVerb", &"PDF Utils").map_err(|e| e.to_string())?;
            pdf_key.set_value("Icon", &icon_val).unwrap_or(());
            pdf_key.set_value("SubCommands", &"").map_err(|e| e.to_string())?;

            // Subkey 1: PDF Viewer
            let (v_key, _) = pdf_key.create_subkey("shell\\01_viewer").map_err(|e| e.to_string())?;
            v_key.set_value("", &"Buka di PDF Viewer").map_err(|e| e.to_string())?;
            v_key.set_value("MUIVerb", &"Buka di PDF Viewer").map_err(|e| e.to_string())?;
            let (v_cmd, _) = v_key.create_subkey("command").map_err(|e| e.to_string())?;
            v_cmd.set_value("", &format!("\"{}\" --viewer \"%1\"", exe_str)).map_err(|e| e.to_string())?;

            // Subkey 2: PDF to Word
            let (w_key, _) = pdf_key.create_subkey("shell\\02_word").map_err(|e| e.to_string())?;
            w_key.set_value("", &"Konversi ke Word (.docx)").map_err(|e| e.to_string())?;
            w_key.set_value("MUIVerb", &"Konversi ke Word (.docx)").map_err(|e| e.to_string())?;
            let (w_cmd, _) = w_key.create_subkey("command").map_err(|e| e.to_string())?;
            w_cmd.set_value("", &format!("\"{}\" --context-pdf2word \"%1\"", exe_str)).map_err(|e| e.to_string())?;

            // Subkey 3: Split PDF
            let (s_key, _) = pdf_key.create_subkey("shell\\03_split").map_err(|e| e.to_string())?;
            s_key.set_value("", &"Pisahkan Halaman (Split PDF)").map_err(|e| e.to_string())?;
            s_key.set_value("MUIVerb", &"Pisahkan Halaman (Split PDF)").map_err(|e| e.to_string())?;
            let (s_cmd, _) = s_key.create_subkey("command").map_err(|e| e.to_string())?;
            s_cmd.set_value("", &format!("\"{}\" --split \"%1\"", exe_str)).map_err(|e| e.to_string())?;

            // Subkey 4: Merge PDF
            let (m_key, _) = pdf_key.create_subkey("shell\\04_merge").map_err(|e| e.to_string())?;
            m_key.set_value("", &"Gabungkan File (Merge PDF)").map_err(|e| e.to_string())?;
            m_key.set_value("MUIVerb", &"Gabungkan File (Merge PDF)").map_err(|e| e.to_string())?;
            let (m_cmd, _) = m_key.create_subkey("command").map_err(|e| e.to_string())?;
            m_cmd.set_value("", &format!("\"{}\" --merge \"%1\"", exe_str)).map_err(|e| e.to_string())?;

            // 2. Direct Context Menu for Image files (.png, .jpg, .jpeg, .webp, .bmp)
            for ext in IMAGE_EXTENSIONS {
                let img_path = format!("Software\\Classes\\SystemFileAssociations\\{}\\shell\\PDFUtilsImage", ext);
                let (img_key, _) = hkcu.create_subkey(&img_path).map_err(|e| e.to_string())?;
                img_key.set_value("", &"Konversi ke PDF (PDF Utils)").map_err(|e| e.to_string())?;
                img_key.set_value("MUIVerb", &"Konversi ke PDF (PDF Utils)").map_err(|e| e.to_string())?;
                img_key.set_value("Icon", &icon_val).unwrap_or(());
                let (img_cmd, _) = img_key.create_subkey("command").map_err(|e| e.to_string())?;
                img_cmd.set_value("", &format!("\"{}\" --image \"%1\"", exe_str)).map_err(|e| e.to_string())?;
            }
        } else {
            let _ = hkcu.delete_subkey_all(pdf_menu_path);
            for ext in IMAGE_EXTENSIONS {
                let img_path = format!("Software\\Classes\\SystemFileAssociations\\{}\\shell\\PDFUtilsImage", ext);
                let _ = hkcu.delete_subkey_all(&img_path);
            }
        }
    }
    Ok(())
}


