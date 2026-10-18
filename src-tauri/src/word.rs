use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;

#[derive(Default)]
pub struct WordJobs(Mutex<HashMap<String, Arc<AtomicBool>>>);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WordRequest {
    job_id: String,
    input_path: String,
    output_path: String,
}

fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}

fn engine_command() -> Result<Command, String> {
    let name = if cfg!(windows) {
        "pdf-word-engine.exe"
    } else {
        "pdf-word-engine"
    };
    let executable = std::env::current_exe().map_err(|e| e.to_string())?;
    let bundled = executable
        .parent()
        .ok_or("Missing executable directory")?
        .join(name);
    if bundled.is_file() {
        return Ok(hidden_command(bundled));
    }
    #[cfg(debug_assertions)]
    {
        let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let directory = manifest.join("binaries");
        // Use exactly the current build target's binary, never another architecture.
        let target = env!("PDF_WORD_TARGET");
        let binary = directory.join(format!(
            "pdf-word-engine-{target}{}",
            if cfg!(windows) { ".exe" } else { "" }
        ));
        if binary.is_file() {
            return Ok(hidden_command(binary));
        }
        let script = manifest.join("../engine/main.py");
        if script.is_file() {
            let programs = std::env::var("PDF_UTILS_PYTHON")
                .map(|p| vec![p])
                .unwrap_or_else(|_| vec!["python".into(), "python3".into(), "py".into()]);
            for program in programs {
                if hidden_command(&program)
                    .args(["-c", "import pymupdf, docx"])
                    .output()
                    .map(|o| o.status.success())
                    .unwrap_or(false)
                {
                    let mut command = hidden_command(program);
                    command.arg("-u").arg(script);
                    return Ok(command);
                }
            }
        }
    }
    Err("ENGINE_MISSING: build the bundled Word engine with npm run engine:build".into())
}

#[tauri::command]
pub async fn word_engine_status() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| match engine_command() {
        Ok(_) => json!({"ready": true}),
        Err(message) => json!({"ready": false, "message": message}),
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn cancel_word_conversion(
    job_id: String,
    jobs: tauri::State<'_, WordJobs>,
) -> Result<(), String> {
    let map = jobs.0.lock().map_err(|e| e.to_string())?;
    if let Some(flag) = map.get(&job_id) {
        flag.store(true, Ordering::SeqCst);
    }
    Ok(())
}

fn run_conversion(
    request: WordRequest,
    progress: Channel<Value>,
    cancel: Arc<AtomicBool>,
) -> Result<Value, String> {
    let input =
        std::fs::canonicalize(&request.input_path).map_err(|e| format!("INVALID_INPUT: {e}"))?;
    if !input.is_file()
        || input
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("pdf"))
            != Some(true)
    {
        return Err("INVALID_INPUT: select a PDF file".into());
    }
    let output = PathBuf::from(&request.output_path);
    if output
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.eq_ignore_ascii_case("docx"))
        != Some(true)
    {
        return Err("INVALID_OUTPUT: select a .docx output file".into());
    }
    let mut command = engine_command()?;
    let parent = output.parent().ok_or("INVALID_OUTPUT")?;
    let temporary = parent.join(format!(
        ".pdf-utils-{}-{}.docx",
        std::process::id(),
        request.job_id
    ));
    let cancel_path = temporary.with_extension("cancel");
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|e| format!("INVALID_OUTPUT: {e}"))?;
    struct Cleanup(PathBuf, PathBuf);
    impl Drop for Cleanup {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
            let _ = std::fs::remove_file(&self.1);
        }
    }
    let _cleanup = Cleanup(temporary.clone(), cancel_path.clone());
    let mut child = command
        .arg(&input)
        .arg(&output)
        .env("PDF_WORD_TEMP", &temporary)
        .env("PDF_WORD_CANCEL", &cancel_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
        .map_err(|e| format!("ENGINE_START_FAILED: {e}"))?;
    let stdout = child.stdout.take().ok_or("Missing engine stdout")?;
    let stderr = child.stderr.take().ok_or("Missing engine stderr")?;
    let reader = std::thread::spawn(move || {
        let mut result = None;
        let mut failure = None;
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if let Ok(event) = serde_json::from_str::<Value>(&line) {
                match event["kind"].as_str() {
                    Some("result") => result = Some(event),
                    Some("error") => failure = event["message"].as_str().map(str::to_owned),
                    Some("progress") => {
                        let _ = progress.send(event);
                    }
                    _ => {}
                }
            }
        }
        (result, failure)
    });
    let diagnostics = std::thread::spawn(move || {
        // Drain all stderr to avoid deadlock, retaining a bounded diagnostic tail.
        let mut reader = BufReader::new(stderr);
        let mut tail = Vec::new();
        let mut buffer = [0u8; 4096];
        while let Ok(size) = reader.read(&mut buffer) {
            if size == 0 {
                break;
            }
            tail.extend_from_slice(&buffer[..size]);
            if tail.len() > 16384 {
                tail.drain(..tail.len() - 16384);
            }
        }
        String::from_utf8_lossy(&tail).into_owned()
    });
    let mut cancelled = false;
    let mut cancel_started = None;
    let status = loop {
        // Completion wins over cancellation after the output has been committed.
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                let _ = diagnostics.join();
                return Err(error.to_string());
            }
            _ => {}
        }
        if cancel.load(Ordering::SeqCst) {
            cancelled = true;
            if cancel_started.is_none() {
                if std::fs::write(&cancel_path, b"cancel").is_err() {
                    let _ = child.kill();
                    break child.wait().map_err(|e| e.to_string())?;
                }
                cancel_started = Some(Instant::now());
            }
            if cancel_started.is_some_and(|t| t.elapsed() > Duration::from_secs(10)) {
                let _ = child.kill();
                break child.wait().map_err(|e| e.to_string())?;
            }
        }
        std::thread::sleep(Duration::from_millis(80));
    };
    let (result, failure) = reader.join().map_err(|_| "Engine output reader failed")?;
    let diagnostic = diagnostics.join().unwrap_or_default();
    if let Some(result) = result {
        if status.success() && output.is_file() {
            return Ok(result);
        }
    }
    if cancelled {
        return Err("CANCELLED".into());
    }
    Err(failure.unwrap_or_else(|| format!("CONVERSION_FAILED: {}", diagnostic.trim())))
}

#[tauri::command]
pub async fn convert_word(
    request: WordRequest,
    progress: Channel<Value>,
    jobs: tauri::State<'_, WordJobs>,
) -> Result<Value, String> {
    let id = request.job_id.clone();
    if id.is_empty()
        || id.len() > 128
        || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("Invalid job ID".into());
    }
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = jobs.0.lock().map_err(|e| e.to_string())?;
        if !map.is_empty() {
            return Err("CONVERSION_BUSY".into());
        }
        map.insert(id.clone(), flag.clone());
    }
    let result =
        tauri::async_runtime::spawn_blocking(move || run_conversion(request, progress, flag))
            .await
            .map_err(|e| e.to_string())
            .and_then(|r| r);
    jobs.0.lock().map_err(|e| e.to_string())?.remove(&id);
    result
}
