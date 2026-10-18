mod commands;
mod word;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(word::WordJobs::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
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
            commands::show_in_folder,
            word::word_engine_status,
            word::convert_word,
            word::cancel_word_conversion,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
