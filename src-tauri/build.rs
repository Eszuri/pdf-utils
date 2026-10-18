fn main() {
    println!(
        "cargo:rustc-env=PDF_WORD_TARGET={}",
        std::env::var("TARGET").unwrap()
    );
    tauri_build::build()
}
