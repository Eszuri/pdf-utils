mod commands;
mod word;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(word::WordJobs::default())
        .manage(commands::LaunchFile::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            if let Some(pos) = args.iter().position(|a| a == "--context-pdf2word") {
                if let Some(file_path) = args.get(pos + 1) {
                    let path = std::path::Path::new(file_path);
                    if path.is_file() {
                        let stem = path.file_stem().unwrap_or_default().to_string_lossy();
                        let parent = path.parent().unwrap_or(std::path::Path::new(""));
                        let output_path = parent.join(format!("{}_convert.docx", stem)).to_string_lossy().into_owned();

                        let app_handle = app.handle().clone();
                        let file_path = file_path.clone();
                        let output_path_clone = output_path.clone();

                        tauri::async_runtime::spawn(async move {
                            if let Ok(mut cmd) = word::engine_command(&app_handle) {
                                let _ = cmd.arg(&file_path).arg(&output_path_clone).output();
                                let _ = commands::show_in_folder(output_path_clone);
                            }
                            app_handle.exit(0);
                        });

                        return Ok(());
                    }
                }
            }

            // Check if opened with a PDF file (e.g. "Buka dengan PDF Utils")
            if let Some(file_arg) = args.iter().skip(1).find(|a| !a.starts_with("--") && a.to_lowercase().ends_with(".pdf")) {
                let path = std::path::Path::new(file_arg);
                if path.is_file() {
                    if let Some(launch_file) = app.try_state::<commands::LaunchFile>() {
                        if let Ok(mut guard) = launch_file.0.lock() {
                            *guard = Some(file_arg.clone());
                        }
                    }
                }
            }

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
            commands::is_context_menu_enabled,
            commands::toggle_context_menu,
            commands::get_launch_file,
            word::word_engine_status,
            word::convert_word,
            word::cancel_word_conversion,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
