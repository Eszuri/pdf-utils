mod commands;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if let Some(pos) = args.iter().position(|a| a == "--context-pdf2word") {
                if let Some(file_path) = args.get(pos + 1) {
                    let path = std::path::Path::new(file_path);
                    let stem = path.file_stem().unwrap_or_default().to_string_lossy();
                    let parent = path.parent().unwrap_or(std::path::Path::new(""));
                    let output_path = parent.join(format!("{}_convert.docx", stem)).to_string_lossy().into_owned();
                    
                    // Run conversion synchronously since we exit right after
                    let _ = commands::pdf_to_docx(file_path.clone(), output_path.clone());
                    let _ = commands::show_in_folder(output_path);
                    
                    app.handle().exit(0);
                    return Ok(());
                }
            }

            // Normal launch: show the main window (because it's hidden by default in tauri.conf.json)
            if let Some(window) = app.get_webview_window("main") {
                window.show().unwrap();
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::images_to_pdf,
            commands::merge_pdfs,
            commands::split_pdf,
            commands::get_pdf_info,
            commands::read_pdf_bytes,
            commands::pdf_to_docx,
            commands::show_in_folder,
            commands::toggle_context_menu,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
