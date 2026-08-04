mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::images_to_pdf,
            commands::merge_pdfs,
            commands::split_pdf,
            commands::get_pdf_info,
            commands::read_pdf_bytes,
            commands::pdf_to_docx,
            commands::show_in_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
