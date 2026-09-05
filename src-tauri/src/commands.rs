use printpdf::{
    Mm, Op, PdfDocument, PdfPage, PdfSaveOptions, Pt, RawImage, RawImageData,
    RawImageFormat, XObjectTransform,
};
use lopdf::{Document, Object};
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::Manager;

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

    for path in &input_paths[1..] {
        let mut doc = Document::load(path).map_err(|e| e.to_string())?;
        doc.decompress();

        let offset = result.max_id;
        let old_ids: Vec<(u32, u16)> = doc.objects.keys().copied().collect();
        let mut id_map = HashMap::new();
        for (i, &old_id) in old_ids.iter().enumerate() {
            let new_id = (offset + 1 + i as u32, old_id.1);
            id_map.insert(old_id, new_id);
        }

        let doc_pages: Vec<(u32, (u32, u16))> = doc
            .get_pages()
            .into_iter()
            .map(|(page_num, page_id)| {
                let new_page_id = id_map[&page_id];
                (page_num, (new_page_id.0, new_page_id.1))
            })
            .collect();

        for (&old_id, obj) in &doc.objects {
            let &new_id = &id_map[&old_id];
            let remapped = remap_references(obj, &id_map);
            result.objects.insert(new_id, remapped);
        }
        result.max_id = offset + old_ids.len() as u32;

        let pages_root_id = {
            let catalog = result.catalog().map_err(|e| e.to_string())?;
            let pages_ref = catalog.get(b"Pages").map_err(|e| e.to_string())?;
            pages_ref.as_reference().map_err(|e| e.to_string())?
        };

        let pages_dict = result
            .get_dictionary(pages_root_id)
            .map_err(|e| e.to_string())?
            .clone();

        let mut kids: Vec<Object> = pages_dict
            .get(b"Kids")
            .ok()
            .and_then(|o| o.as_array().ok())
            .cloned()
            .unwrap_or_default();

        let old_count = pages_dict
            .get(b"Count")
            .ok()
            .and_then(|o| o.as_i64().ok())
            .unwrap_or(0);

        for &(_, new_page_id) in &doc_pages {
            if let Ok(page_dict) = result.get_dictionary_mut(new_page_id) {
                page_dict.set("Parent", Object::Reference(pages_root_id));
            }
            kids.push(Object::Reference(new_page_id));
        }

        if let Ok(pages_dict) = result.get_dictionary_mut(pages_root_id) {
            pages_dict.set("Kids", Object::Array(kids));
            pages_dict.set("Count", old_count + doc_pages.len() as i64);
        }
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


pub fn find_standalone_engine(app: &tauri::AppHandle) -> Option<PathBuf> {
    let bin_name = if cfg!(windows) { "pdf2docx-engine.exe" } else { "pdf2docx-engine" };

    // 1. Check in Tauri resource directory
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("resources").join(bin_name);
        if candidate.is_file() {
            return Some(candidate);
        }
        let candidate2 = resource_dir.join(bin_name);
        if candidate2.is_file() {
            return Some(candidate2);
        }
    }

    // 2. Check next to current running executable
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            let candidate = parent.join(bin_name);
            if candidate.is_file() {
                return Some(candidate);
            }
            let candidate_res = parent.join("resources").join(bin_name);
            if candidate_res.is_file() {
                return Some(candidate_res);
            }
        }
    }

    // 3. Check development paths relative to current directory
    let dev_candidates = [
        PathBuf::from("src-tauri").join("resources").join(bin_name),
        PathBuf::from("resources").join(bin_name),
        PathBuf::from("..").join("src-tauri").join("resources").join(bin_name),
    ];
    for dev_path in &dev_candidates {
        if dev_path.is_file() {
            return Some(dev_path.clone());
        }
    }

    None
}

pub fn find_converter_script(app: &tauri::AppHandle) -> Option<PathBuf> {
    let script_name = "converter_cli.py";

    // 1. Check in Tauri resource directory
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("resources").join(script_name);
        if candidate.is_file() {
            return Some(candidate);
        }
        let candidate2 = resource_dir.join(script_name);
        if candidate2.is_file() {
            return Some(candidate2);
        }
    }

    // 2. Check next to current running executable
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            let candidate = parent.join(script_name);
            if candidate.is_file() {
                return Some(candidate);
            }
            let candidate_res = parent.join("resources").join(script_name);
            if candidate_res.is_file() {
                return Some(candidate_res);
            }
        }
    }

    // 3. Check development paths relative to current directory
    let dev_candidates = [
        PathBuf::from("src-tauri").join("resources").join(script_name),
        PathBuf::from("resources").join(script_name),
        PathBuf::from("scripts").join(script_name),
        PathBuf::from("..").join("scripts").join(script_name),
        PathBuf::from("..").join("src-tauri").join("resources").join(script_name),
    ];
    for dev_path in &dev_candidates {
        if dev_path.is_file() {
            return Some(dev_path.clone());
        }
    }

    None
}

#[tauri::command]
pub fn get_converter_status(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    if let Some(path) = find_standalone_engine(&app) {
        return Ok(serde_json::json!({
            "ready": true,
            "engine_type": "standalone",
            "path": path.to_string_lossy(),
            "message": "Standalone Engine Siap (Zero Configuration)"
        }));
    }

    let python_paths = ["python", "python3", "py"];
    if let Some(python) = python_paths.iter().find(|p| {
        let mut cmd = std::process::Command::new(p);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        cmd.arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }) {
        let mut check_cmd = std::process::Command::new(python);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            check_cmd.creation_flags(0x08000000);
        }
        let check = check_cmd
            .args(["-c", "import pdf2docx, fitz, docx"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);

        if check {
            return Ok(serde_json::json!({
                "ready": true,
                "engine_type": "python",
                "message": "Python Sistem Siap (pdf2docx, PyMuPDF, docx terdeteksi)"
            }));
        } else {
            return Ok(serde_json::json!({
                "ready": false,
                "engine_type": "python_missing_deps",
                "message": "Python terdeteksi tetapi modul konversi belum lengkap."
            }));
        }
    }

    Ok(serde_json::json!({
        "ready": false,
        "engine_type": "none",
        "message": "Engine mandiri atau Python tidak ditemukan."
    }))
}

#[tauri::command]
pub fn auto_setup_dependencies() -> Result<String, String> {
    let python_paths = ["python", "python3", "py"];
    let python = python_paths.iter().find(|p| {
        let mut cmd = std::process::Command::new(p);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        cmd.arg("--version")
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }).ok_or_else(|| "Python tidak ditemukan di sistem.".to_string())?;

    let mut cmd = std::process::Command::new(python);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let output = cmd
        .args(["-m", "pip", "install", "pdf2docx", "PyMuPDF", "python-docx"])
        .output()
        .map_err(|e| format!("Gagal menjalankan pip: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Instalasi modul gagal: {}", stderr.trim()));
    }

    Ok("Dependensi berhasil dipasang otomatis!".to_string())
}

#[tauri::command]
pub fn pdf_to_docx(app: tauri::AppHandle, input_path: String, output_path: String) -> Result<(), String> {
    // Priority 1: Standalone engine (100% Zero-Configuration)
    if let Some(engine_path) = find_standalone_engine(&app) {
        let mut cmd = std::process::Command::new(engine_path);
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        let output = cmd
            .arg(&input_path)
            .arg(&output_path)
            .output()
            .map_err(|e| format!("Gagal menjalankan standalone engine: {}", e))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("Konversi gagal: {}", stderr.trim()));
        }

        if !std::path::Path::new(&output_path).exists() {
            return Err("File docx hasil konversi tidak ditemukan.".to_string());
        }

        return Ok(());
    }

    // Priority 2: Fallback to system Python
    let python_paths = ["python", "python3", "py"];
    let python = python_paths
        .iter()
        .find(|p| {
            let mut cmd = std::process::Command::new(p);
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x08000000);
            }
            cmd.arg("--version")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        })
        .ok_or_else(|| "Engine konversi tidak ditemukan. Silakan bangun standalone engine atau instal Python.".to_string())?;

    let mut cmd = std::process::Command::new(python);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    if let Some(script_path) = find_converter_script(&app) {
        cmd.arg(script_path).arg(&input_path).arg(&output_path);
    } else {
        let script = format!(
            "from pdf2docx import Converter; cv = Converter(r'{}'); cv.convert(r'{}'); cv.close()",
            input_path.replace('\'', "\\'"),
            output_path.replace('\'', "\\'")
        );
        cmd.arg("-c").arg(&script);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Gagal menjalankan Python: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr_trimmed = stderr.trim();
        if stderr_trimmed.contains("No module named") || stderr_trimmed.contains("ModuleNotFoundError") {
            return Err("Modul Python belum lengkap. Gunakan tombol 'Pasang Otomatis' atau jalankan: pip install pdf2docx PyMuPDF python-docx".to_string());
        }
        return Err(format!("Konversi gagal: {}", stderr_trimmed));
    }

    if !std::path::Path::new(&output_path).exists() {
        return Err("File docx hasil konversi tidak ditemukan.".to_string());
    }

    Ok(())
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


#[tauri::command]
pub fn toggle_context_menu(enable: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use winreg::enums::*;
        use winreg::RegKey;
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let path = "Software\\Classes\\SystemFileAssociations\\.pdf\\shell\\PDFUtilsToWord";
        
        if enable {
            let (key, _) = hkcu.create_subkey(path).map_err(|e| e.to_string())?;
            key.set_value("", &"PDF to Word (PDF Utils)").map_err(|e| e.to_string())?;
            key.set_value("Icon", &"shell32.dll,-167").unwrap_or(()); // optional icon
            
            let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
            let exe_str = exe_path.to_string_lossy();
            
            let (command_key, _) = key.create_subkey("command").map_err(|e| e.to_string())?;
            let command_val = format!("\"{}\" --context-pdf2word \"%1\"", exe_str);
            command_key.set_value("", &command_val).map_err(|e| e.to_string())?;
        } else {
            let _ = hkcu.delete_subkey_all(path);
        }
    }
    Ok(())
}

