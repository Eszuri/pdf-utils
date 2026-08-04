use printpdf::{
    BuiltinFont, Mm, Op, PdfDocument, PdfPage, PdfSaveOptions, Point, Pt, RawImage, RawImageData,
    RawImageFormat, TextItem, XObjectTransform,
};
use lopdf::{Document, Object};
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
pub fn text_to_pdf(text: String, output_path: String) -> Result<(), String> {
    let mut doc = PdfDocument::new("Document");

    let mut ops = Vec::new();
    ops.push(Op::SaveGraphicsState);
    ops.push(Op::StartTextSection);
    ops.push(Op::SetFontSizeBuiltinFont {
        size: Pt(11.0),
        font: BuiltinFont::Helvetica,
    });
    ops.push(Op::SetLineHeight { lh: Pt(5.0) });

    let mut y_pos = 280.0;
    for line in text.lines() {
        ops.push(Op::SetTextCursor {
            pos: Point::new(Mm(20.0), Mm(y_pos)),
        });
        ops.push(Op::WriteTextBuiltinFont {
            items: vec![TextItem::Text(line.to_string())],
            font: BuiltinFont::Helvetica,
        });
        y_pos -= 5.0;
        if y_pos < 20.0 {
            break;
        }
    }

    ops.push(Op::EndTextSection);
    ops.push(Op::RestoreGraphicsState);

    let page = PdfPage::new(Mm(210.0), Mm(297.0), ops);
    let bytes = doc
        .with_pages(vec![page])
        .save(&PdfSaveOptions::default(), &mut Vec::new());

    std::fs::write(&output_path, &bytes).map_err(|e| e.to_string())?;
    Ok(())
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

        let max_width_mm = 170.0;
        let scale = max_width_mm / w as f32;
        let img_width_mm = w as f32 * scale;
        let img_height_mm = h as f32 * scale;
        let x_mm = (210.0 - img_width_mm) / 2.0;
        let y_mm = (297.0 - img_height_mm) / 2.0;

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

        pages.push(PdfPage::new(Mm(210.0), Mm(297.0), ops));
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

#[tauri::command]
pub fn write_file_bytes(output_path: String, bytes: Vec<u8>) -> Result<(), String> {
    std::fs::write(&output_path, &bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pdf_to_docx(input_path: String, output_path: String) -> Result<(), String> {
    // Use pdf2docx Python library for high-quality PDF to DOCX conversion
    let python_paths = ["python", "python3", "py"];

    let python = python_paths
        .iter()
        .find(|p| {
            std::process::Command::new(p)
                .arg("--version")
                .output()
                .map(|o| o.status.success())
                .unwrap_or(false)
        })
        .ok_or_else(|| "Python tidak ditemukan. Install Python terlebih dahulu.".to_string())?;

    let script = format!(
        "from pdf2docx import Converter; cv = Converter(r'{}'); cv.convert(r'{}'); cv.close()",
        input_path.replace('\'', "\\'"),
        output_path.replace('\'', "\\'")
    );

    let output = std::process::Command::new(python)
        .arg("-c")
        .arg(&script)
        .output()
        .map_err(|e| format!("Gagal menjalankan Python: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Konversi gagal: {}", stderr.trim()));
    }

    // Verify output file was created
    if !std::path::Path::new(&output_path).exists() {
        return Err("File docx hasil konversi tidak ditemukan.".to_string());
    }

    Ok(())
}
