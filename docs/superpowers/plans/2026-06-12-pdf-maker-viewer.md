# PDF Maker & Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Tauri desktop app with PDF creation (text→PDF, image→PDF, merge, split) and a PDF viewer with search + page selection.

**Architecture:** Rust backend (printpdf for creation, lopdf for manipulation) exposes Tauri commands; React frontend with react-router-dom for navigation and pdfjs-dist for PDF rendering.

**Tech Stack:** Tauri v2, Rust (printpdf, lopdf, image), React 19, TypeScript, pdfjs-dist, react-router-dom

---

### Task 1: Add Rust Dependencies

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Update Cargo.toml with new dependencies**

Replace the `[dependencies]` section in `src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
tauri-plugin-dialog = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
printpdf = "0.8"
lopdf = { version = "0.34", features = ["paged_flate"] }
image = "0.25"
```

- [ ] **Step 2: Register dialog plugin in lib.rs**

Replace `src-tauri/src/lib.rs` with:

```rust
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![greet])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Add dialog permissions to capabilities**

Replace `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default"
  ]
}
```

- [ ] **Step 4: Verify build compiles**

Run: `cd src-tauri && cargo build`
Expected: Compiles successfully with new dependencies

---

### Task 2: Implement Rust PDF Commands

**Files:**
- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Create commands.rs with all PDF commands**

Create `src-tauri/src/commands.rs`:

```rust
use printpdf::*;
use lopdf::Document;
use std::fs::File;
use std::io::BufWriter;
use image::GenericImageView;

#[tauri::command]
pub fn text_to_pdf(text: String, output_path: String) -> Result<(), String> {
    let (doc, page, layer) = PdfDocument::new(
        "Document",
        Mm(210.0),
        Mm(297.0),
        "Layer 1",
    );

    let font = doc.add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| format!("Font error: {}", e))?;

    let mut y_pos = 280.0_f32;
    for line in text.lines() {
        layer.use_text(line, 11.0, Mm(20.0), Mm(y_pos), &font);
        y_pos -= 5.0;
    }

    doc.save(&mut BufWriter::new(
        File::create(&output_path).map_err(|e| e.to_string())?
    )).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn images_to_pdf(image_paths: Vec<String>, output_path: String) -> Result<(), String> {
    if image_paths.is_empty() {
        return Err("No images selected".to_string());
    }

    let (doc, page, layer) = PdfDocument::new(
        "Images",
        Mm(210.0),
        Mm(297.0),
        "Layer 1",
    );
    let mut current_page = page;
    let mut current_layer = layer;

    for (i, path) in image_paths.iter().enumerate() {
        if i > 0 {
            let (new_page, new_layer) = doc.add_page(Mm(210.0), Mm(297.0), format!("Layer {}", i + 1));
            current_page = new_page;
            current_layer = new_layer;
        }

        let img = image::open(path).map_err(|e| format!("Image error for {}: {}", path, e))?;
        let (w, h) = img.dimensions();
        let img_rgb = img.to_rgb8();
        let img_data = img_rgb.into_raw();

        let image = Image::from_rgb(&img_data, w, h);
        let (image_ref, _) = doc.add_image(image, ImageCompression::None);

        // Scale image to fit page width (with 20mm margins)
        let max_width = 170.0; // mm
        let scale = max_width / (w as f32);
        let img_width = w as f32 * scale;
        let img_height = h as f32 * scale;
        let x = (210.0 - img_width) / 2.0;
        let y = (297.0 - img_height) / 2.0;

        current_layer.use_image(image_ref, Mm(x), Mm(y), Mm(img_width), Mm(img_height));
    }

    doc.save(&mut BufWriter::new(
        File::create(&output_path).map_err(|e| e.to_string())?
    )).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn merge_pdfs(input_paths: Vec<String>, output_path: String) -> Result<(), String> {
    if input_paths.is_empty() {
        return Err("No PDFs selected".to_string());
    }

    let mut result = Document::new();
    for path in &input_paths {
        let doc = Document::load(path).map_err(|e| format!("Failed to load {}: {}", path, e))?;
        result.append(&doc);
    }
    result.save(&output_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn split_pdf(input_path: String, pages: Vec<u32>, output_path: String) -> Result<(), String> {
    if pages.is_empty() {
        return Err("No pages selected".to_string());
    }

    let doc = Document::load(&input_path).map_err(|e| e.to_string())?;
    let page_count = doc.get_pages().len() as u32;

    let mut out = Document::new();
    for &page_num in &pages {
        if page_num == 0 || page_num > page_count {
            return Err(format!("Invalid page number: {}. Total pages: {}", page_num, page_count));
        }
        out.append_document(doc.clone(), page_num..=page_num);
    }
    out.save(&output_path).map_err(|e| e.to_string())?;
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
```

- [ ] **Step 2: Update lib.rs to register new commands**

Replace `src-tauri/src/lib.rs`:

```rust
mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::text_to_pdf,
            commands::images_to_pdf,
            commands::merge_pdfs,
            commands::split_pdf,
            commands::get_pdf_info,
            commands::read_pdf_bytes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Verify build compiles**

Run: `cd src-tauri && cargo build`
Expected: Compiles successfully

---

### Task 3: Frontend Dependencies & Routing Setup

**Files:**
- Modify: `package.json`
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Create: `src/components/Layout.tsx`
- Create: `src/pages/Home.tsx`

- [ ] **Step 1: Install npm dependencies**

Run: `npm install react-router-dom pdfjs-dist @tauri-apps/plugin-dialog`

- [ ] **Step 2: Set up routing in main.tsx**

Replace `src/main.tsx`:

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
```

- [ ] **Step 3: Create Layout component**

Create `src/components/Layout.tsx`:

```tsx
import { Outlet, NavLink, useNavigate } from "react-router-dom";
import "./Layout.css";

export default function Layout() {
  const navigate = useNavigate();

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <h2 className="sidebar-title" onClick={() => navigate("/")}>PDF Utils</h2>
        <nav className="sidebar-nav">
          <span className="nav-section">PDF Maker</span>
          <NavLink to="/maker/text" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
            Text → PDF
          </NavLink>
          <NavLink to="/maker/image" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
            Image → PDF
          </NavLink>
          <NavLink to="/maker/merge" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
            Merge PDF
          </NavLink>
          <NavLink to="/maker/split" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
            Split PDF
          </NavLink>
          <span className="nav-section">Tools</span>
          <NavLink to="/viewer" className={({ isActive }) => isActive ? "nav-link active" : "nav-link"}>
            PDF Viewer
          </NavLink>
        </nav>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Create Layout CSS**

Create `src/components/Layout.css`:

```css
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: 220px;
  background: #1a1a2e;
  color: #eee;
  display: flex;
  flex-direction: column;
  padding: 16px 0;
  flex-shrink: 0;
}

.sidebar-title {
  font-size: 20px;
  font-weight: bold;
  padding: 8px 20px 16px;
  cursor: pointer;
  color: #fff;
  margin: 0;
  border-bottom: 1px solid #333;
}

.nav-section {
  padding: 12px 20px 4px;
  font-size: 11px;
  text-transform: uppercase;
  color: #888;
  letter-spacing: 1px;
}

.nav-link {
  display: block;
  padding: 8px 20px;
  color: #ccc;
  text-decoration: none;
  font-size: 14px;
  transition: background 0.2s;
}

.nav-link:hover {
  background: #16213e;
  color: #fff;
}

.nav-link.active {
  background: #0f3460;
  color: #fff;
  border-right: 3px solid #e94560;
}

.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
  background: #f5f5f5;
}
```

- [ ] **Step 5: Create Home page**

Create `src/pages/Home.tsx`:

```tsx
import { useNavigate } from "react-router-dom";
import "./Home.css";

const menuItems = [
  { path: "/maker/text", title: "Text → PDF", desc: "Buat PDF dari teks" },
  { path: "/maker/image", title: "Image → PDF", desc: "Konversi gambar ke PDF" },
  { path: "/maker/merge", title: "Merge PDF", desc: "Gabung beberapa PDF" },
  { path: "/maker/split", title: "Split PDF", desc: "Ekstrak halaman PDF" },
  { path: "/viewer", title: "PDF Viewer", desc: "Lihat dan cari PDF" },
];

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="home">
      <h1>PDF Utils</h1>
      <p className="home-subtitle">Pilih alat yang ingin digunakan</p>
      <div className="menu-grid">
        {menuItems.map((item) => (
          <div key={item.path} className="menu-card" onClick={() => navigate(item.path)}>
            <h3>{item.title}</h3>
            <p>{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create Home CSS**

Create `src/pages/Home.css`:

```css
.home {
  text-align: center;
  padding-top: 40px;
}

.home h1 {
  font-size: 32px;
  margin-bottom: 8px;
  color: #1a1a2e;
}

.home-subtitle {
  color: #666;
  margin-bottom: 40px;
}

.menu-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  max-width: 800px;
  margin: 0 auto;
}

.menu-card {
  background: white;
  border-radius: 8px;
  padding: 24px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  transition: transform 0.2s, box-shadow 0.2s;
}

.menu-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
}

.menu-card h3 {
  margin: 0 0 8px;
  color: #1a1a2e;
}

.menu-card p {
  margin: 0;
  color: #666;
  font-size: 13px;
}
```

- [ ] **Step 7: Update App.tsx with routing**

Replace `src/App.tsx`:

```tsx
import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import "./App.css";

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="maker/text" element={<div className="page-placeholder">Text → PDF</div>} />
        <Route path="maker/image" element={<div className="page-placeholder">Image → PDF</div>} />
        <Route path="maker/merge" element={<div className="page-placeholder">Merge PDF</div>} />
        <Route path="maker/split" element={<div className="page-placeholder">Split PDF</div>} />
        <Route path="viewer" element={<div className="page-placeholder">PDF Viewer</div>} />
      </Route>
    </Routes>
  );
}

export default App;
```

- [ ] **Step 8: Update App.css**

Replace `src/App.css`:

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
}

.page-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 24px;
  color: #999;
}
```

---

### Task 4: Text → PDF Page

**Files:**
- Create: `src/pages/TextToPdf.tsx`
- Create: `src/pages/TextToPdf.css`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create TextToPdf component**

Create `src/pages/TextToPdf.tsx`:

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import "./TextToPdf.css";

export default function TextToPdf() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleExport() {
    if (!text.trim()) return;
    
    const path = await save({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      defaultPath: "document.pdf",
    });
    if (!path) return;

    setLoading(true);
    try {
      await invoke("text_to_pdf", { text, outputPath: path });
    } catch (e) {
      alert("Error: " + e);
    }
    setLoading(false);
  }

  return (
    <div className="text-to-pdf">
      <h2>Text → PDF</h2>
      <textarea
        className="text-input"
        placeholder="Tulis teks di sini..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={15}
      />
      <button className="btn-primary" onClick={handleExport} disabled={loading || !text.trim()}>
        {loading ? "Processing..." : "Export to PDF"}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create TextToPdf CSS**

Create `src/pages/TextToPdf.css`:

```css
.text-to-pdf {
  max-width: 700px;
  margin: 0 auto;
}

.text-to-pdf h2 {
  margin-bottom: 16px;
  color: #1a1a2e;
}

.text-input {
  width: 100%;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  min-height: 200px;
}

.text-input:focus {
  outline: none;
  border-color: #0f3460;
}

.btn-primary {
  margin-top: 16px;
  padding: 10px 24px;
  background: #0f3460;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary:hover {
  background: #1a5276;
}

.btn-primary:disabled {
  background: #999;
  cursor: not-allowed;
}
```

- [ ] **Step 3: Register route in App.tsx**

Replace the Text → PDF placeholder in `src/App.tsx` with `<TextToPdf />` and add import:

```tsx
import TextToPdf from "./pages/TextToPdf";
// ...
<Route path="maker/text" element={<TextToPdf />} />
```

---

### Task 5: Image → PDF Page

**Files:**
- Create: `src/pages/ImageToPdf.tsx`
- Create: `src/pages/ImageToPdf.css`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create ImageToPdf component**

Create `src/pages/ImageToPdf.tsx`:

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import "./ImageToPdf.css";

interface ImageItem {
  path: string;
  name: string;
}

export default function ImageToPdf() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(false);

  async function addImages() {
    const files = await open({
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
    });
    if (!files) return;
    const paths = Array.isArray(files) ? files : [files];
    const newImages = paths.map((p) => ({
      path: p,
      name: p.split("\\").pop() || p.split("/").pop() || p,
    }));
    setImages((prev) => [...prev, ...newImages]);
  }

  function removeImage(index: number) {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }

  function moveImage(from: number, to: number) {
    if (to < 0 || to >= images.length) return;
    const copy = [...images];
    const [item] = copy.splice(from, 1);
    copy.splice(to, 0, item);
    setImages(copy);
  }

  async function handleExport() {
    if (images.length === 0) return;

    const path = await save({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      defaultPath: "images.pdf",
    });
    if (!path) return;

    setLoading(true);
    try {
      await invoke("images_to_pdf", { imagePaths: images.map((i) => i.path), outputPath: path });
    } catch (e) {
      alert("Error: " + e);
    }
    setLoading(false);
  }

  return (
    <div className="image-to-pdf">
      <h2>Image → PDF</h2>
      <button className="btn-primary" onClick={addImages}>Add Images</button>
      {images.length > 0 && (
        <>
          <div className="image-list">
            {images.map((img, i) => (
              <div key={i} className="image-item">
                <span className="image-name">{img.name}</span>
                <div className="image-actions">
                  <button onClick={() => moveImage(i, i - 1)} disabled={i === 0}>↑</button>
                  <button onClick={() => moveImage(i, i + 1)} disabled={i === images.length - 1}>↓</button>
                  <button className="btn-remove" onClick={() => removeImage(i)}>×</button>
                </div>
              </div>
            ))}
          </div>
          <button className="btn-primary" onClick={handleExport} disabled={loading}>
            {loading ? "Processing..." : "Export to PDF"}
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create ImageToPdf CSS**

Create `src/pages/ImageToPdf.css`:

```css
.image-to-pdf {
  max-width: 600px;
  margin: 0 auto;
}

.image-to-pdf h2 {
  margin-bottom: 16px;
  color: #1a1a2e;
}

.image-list {
  margin: 16px 0;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
}

.image-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #eee;
}

.image-item:last-child {
  border-bottom: none;
}

.image-name {
  font-size: 13px;
  color: #333;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-actions button {
  padding: 4px 8px;
  margin-left: 4px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 13px;
}

.image-actions button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-remove {
  color: #e74c3c;
  font-weight: bold;
}
```

- [ ] **Step 3: Register route in App.tsx**

Replace Image → PDF placeholder with `<ImageToPdf />` and add import.

---

### Task 6: Merge & Split PDF Pages

**Files:**
- Create: `src/pages/MergePdf.tsx`
- Create: `src/pages/SplitPdf.tsx`
- Create: `src/pages/MergeSplit.css`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create MergePdf component**

Create `src/pages/MergePdf.tsx`:

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import "./MergeSplit.css";

export default function MergePdf() {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function addFiles() {
    const selected = await open({
      multiple: true,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    setFiles((prev) => [...prev, ...paths]);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleMerge() {
    if (files.length < 2) return;
    const path = await save({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      defaultPath: "merged.pdf",
    });
    if (!path) return;

    setLoading(true);
    try {
      await invoke("merge_pdfs", { inputPaths: files, outputPath: path });
    } catch (e) {
      alert("Error: " + e);
    }
    setLoading(false);
  }

  return (
    <div className="page-form">
      <h2>Merge PDF</h2>
      <p className="form-desc">Gabung beberapa file PDF menjadi satu.</p>
      <button className="btn-primary" onClick={addFiles}>Add PDF Files</button>
      {files.length > 0 && (
        <>
          <div className="file-list">
            {files.map((f, i) => (
              <div key={i} className="file-item">
                <span>{f.split("\\").pop() || f.split("/").pop()}</span>
                <button className="btn-remove" onClick={() => removeFile(i)}>×</button>
              </div>
            ))}
          </div>
          <button className="btn-primary" onClick={handleMerge} disabled={loading || files.length < 2}>
            {loading ? "Merging..." : `Merge ${files.length} Files`}
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create SplitPdf component**

Create `src/pages/SplitPdf.tsx`:

```tsx
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import "./MergeSplit.css";

export default function SplitPdf() {
  const [filePath, setFilePath] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);

  async function openFile() {
    const path = await open({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path) return;
    const p = Array.isArray(path) ? path[0] : path;
    setFilePath(p);
    const info: any = await invoke("get_pdf_info", { inputPath: p });
    setPageCount(info.page_count);
    setSelectedPages([]);
  }

  function togglePage(page: number) {
    setSelectedPages((prev) =>
      prev.includes(page) ? prev.filter((p) => p !== page) : [...prev, page]
    );
  }

  async function handleExtract() {
    if (selectedPages.length === 0) return;
    const path = await save({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      defaultPath: "extracted.pdf",
    });
    if (!path) return;

    setLoading(true);
    try {
      await invoke("split_pdf", { inputPath: filePath, pages: selectedPages, outputPath: path });
    } catch (e) {
      alert("Error: " + e);
    }
    setLoading(false);
  }

  return (
    <div className="page-form">
      <h2>Split PDF</h2>
      <p className="form-desc">Pilih halaman yang ingin diekstrak dari PDF.</p>
      <button className="btn-primary" onClick={openFile}>
        {filePath ? "Change File" : "Open PDF"}
      </button>
      {filePath && (
        <p className="file-info">File: {filePath.split("\\").pop() || filePath.split("/").pop()} ({pageCount} pages)</p>
      )}
      {pageCount > 0 && (
        <>
          <div className="page-grid">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
              <label key={p} className={`page-check ${selectedPages.includes(p) ? "checked" : ""}`}>
                <input
                  type="checkbox"
                  checked={selectedPages.includes(p)}
                  onChange={() => togglePage(p)}
                />
                Page {p}
              </label>
            ))}
          </div>
          <button className="btn-primary" onClick={handleExtract} disabled={loading || selectedPages.length === 0}>
            {loading ? "Extracting..." : `Extract ${selectedPages.length} Pages`}
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create shared CSS**

Create `src/pages/MergeSplit.css`:

```css
.page-form {
  max-width: 600px;
  margin: 0 auto;
}

.page-form h2 {
  margin-bottom: 8px;
  color: #1a1a2e;
}

.form-desc {
  color: #666;
  font-size: 14px;
  margin-bottom: 16px;
}

.file-list {
  margin: 16px 0;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: white;
}

.file-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid #eee;
  font-size: 13px;
}

.file-item:last-child {
  border-bottom: none;
}

.file-info {
  margin-top: 12px;
  font-size: 13px;
  color: #555;
}

.page-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
  gap: 8px;
  margin: 16px 0;
}

.page-check {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  background: white;
  transition: background 0.2s;
}

.page-check:hover {
  background: #f0f0f0;
}

.page-check.checked {
  background: #e3f0ff;
  border-color: #0f3460;
}
```

- [ ] **Step 4: Register routes in App.tsx**

Replace Merge and Split placeholders with `<MergePdf />` and `<SplitPdf />`, add imports.

---

### Task 7: PDF Viewer with Search & Page Selection

**Files:**
- Create: `src/pages/Viewer.tsx`
- Create: `src/pages/Viewer.css`
- Modify: `src/App.tsx`

- [ ] **Step 1: Create Viewer component**

Create `src/pages/Viewer.tsx`:

```tsx
import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./Viewer.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface PageInfo {
  num: number;
  text: string;
}

export default function Viewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [filePath, setFilePath] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ page: number; text: string }[]>([]);
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(false);
  const renderTask = useRef<number>(0);

  const renderPage = useCallback(async (pdfDoc: pdfjsLib.PDFDocumentProxy, pageNum: number) => {
    const taskId = ++renderTask.current;
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.height = viewport.height;
    canvas.width = viewport.width;
    const ctx = canvas.getContext("2d")!;
    const renderContext = { canvasContext: ctx, viewport };

    await page.render(renderContext).promise;
    if (taskId !== renderTask.current) return;

    // Extract text for search
    const textContent = await page.getTextContent();
    const text = textContent.items.map((item: any) => item.str).join(" ");
    return text;
  }, []);

  async function openPdf() {
    const path = await open({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path) return;
    const p = Array.isArray(path) ? path[0] : path;
    setFilePath(p);

    const data: number[] = await invoke("read_pdf_bytes", { path: p });
    const pdfData = new Uint8Array(data);
    const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
    setPdf(pdfDoc);
    setTotalPages(pdfDoc.numPages);
    setCurrentPage(1);
    setSelectedPages(new Set());

    // Extract text from all pages for search
    const allPages: PageInfo[] = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      const tc = await page.getTextContent();
      const text = tc.items.map((item: any) => item.str).join(" ");
      allPages.push({ num: i, text });
    }
    setPages(allPages);

    renderPage(pdfDoc, 1);
  }

  function goToPage(n: number) {
    if (!pdf || n < 1 || n > totalPages) return;
    setCurrentPage(n);
    renderPage(pdf, n);
  }

  function handleSearch() {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const q = searchQuery.toLowerCase();
    const results = pages
      .filter((p) => p.text.toLowerCase().includes(q))
      .map((p) => ({ page: p.num, text: p.text.slice(0, 100) }));
    setSearchResults(results);
  }

  function toggleSelectAll() {
    if (selectedPages.size === totalPages) {
      setSelectedPages(new Set());
    } else {
      setSelectedPages(new Set(Array.from({ length: totalPages }, (_, i) => i + 1)));
    }
  }

  function togglePage(p: number) {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function downloadSelectedPages() {
    if (selectedPages.size === 0) return;
    const path = await save({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      defaultPath: "selected-pages.pdf",
    });
    if (!path) return;

    setLoading(true);
    try {
      await invoke("split_pdf", {
        inputPath: filePath,
        pages: Array.from(selectedPages).sort((a, b) => a - b),
        outputPath: path,
      });
    } catch (e) {
      alert("Error: " + e);
    }
    setLoading(false);
  }

  return (
    <div className="viewer-layout">
      <div className="viewer-sidebar">
        <h3>PDF Viewer</h3>
        <button className="btn-primary" onClick={openPdf}>
          {filePath ? "Open Another PDF" : "Open PDF"}
        </button>

        {/* Search */}
        <div className="search-section">
          <input
            type="text"
            placeholder="Search text..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          />
          <button className="btn-small" onClick={handleSearch}>Search</button>
          {searchResults.length > 0 && (
            <div className="search-results">
              {searchResults.map((r) => (
                <div key={r.page} className="search-result" onClick={() => goToPage(r.page)}>
                  <strong>Page {r.page}:</strong> {r.text}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Page selection */}
        {totalPages > 0 && (
          <div className="page-select-section">
            <label className="page-check-all">
              <input type="checkbox" checked={selectedPages.size === totalPages} onChange={toggleSelectAll} />
              Select All ({totalPages} pages)
            </label>
            <div className="page-select-list">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <label key={p} className={`page-check-item ${selectedPages.has(p) ? "checked" : ""}`}>
                  <input type="checkbox" checked={selectedPages.has(p)} onChange={() => togglePage(p)} />
                  Page {p}
                </label>
              ))}
            </div>
            <button className="btn-primary" onClick={downloadSelectedPages} disabled={loading || selectedPages.size === 0}>
              {loading ? "Downloading..." : `Download Selected (${selectedPages.size})`}
            </button>
          </div>
        )}
      </div>

      <div className="viewer-main">
        {!pdf ? (
          <div className="viewer-empty">Open a PDF file to view</div>
        ) : (
          <>
            <div className="viewer-toolbar">
              <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage <= 1}>← Prev</button>
              <span>Page {currentPage} of {totalPages}</span>
              <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage >= totalPages}>Next →</button>
            </div>
            <div className="viewer-canvas-wrapper">
              <canvas ref={canvasRef}></canvas>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create Viewer CSS**

Create `src/pages/Viewer.css`:

```css
.viewer-layout {
  display: flex;
  height: 100%;
  gap: 0;
}

.viewer-sidebar {
  width: 260px;
  flex-shrink: 0;
  background: white;
  border-radius: 8px;
  padding: 16px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  overflow-y: auto;
}

.viewer-sidebar h3 {
  margin-bottom: 12px;
  color: #1a1a2e;
}

.search-section {
  margin-top: 16px;
}

.search-section input {
  width: 100%;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 13px;
  margin-bottom: 8px;
}

.btn-small {
  padding: 6px 12px;
  background: #0f3460;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.search-results {
  margin-top: 8px;
  max-height: 200px;
  overflow-y: auto;
}

.search-result {
  padding: 6px 8px;
  cursor: pointer;
  font-size: 12px;
  border-bottom: 1px solid #f0f0f0;
  color: #333;
}

.search-result:hover {
  background: #f0f0f0;
}

.page-select-section {
  margin-top: 16px;
}

.page-check-all {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  margin-bottom: 8px;
  cursor: pointer;
}

.page-select-list {
  max-height: 150px;
  overflow-y: auto;
  border: 1px solid #eee;
  border-radius: 4px;
  margin-bottom: 12px;
}

.page-check-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}

.page-check-item:hover {
  background: #f5f5f5;
}

.page-check-item.checked {
  background: #e3f0ff;
}

.viewer-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  overflow-y: auto;
  padding-left: 16px;
}

.viewer-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  font-size: 18px;
}

.viewer-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding: 8px 16px;
  background: white;
  border-radius: 6px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}

.viewer-toolbar button {
  padding: 6px 14px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: white;
  cursor: pointer;
  font-size: 13px;
}

.viewer-toolbar button:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.viewer-canvas-wrapper {
  background: white;
  box-shadow: 0 2px 12px rgba(0,0,0,0.1);
  border-radius: 4px;
}

.viewer-canvas-wrapper canvas {
  display: block;
}
```

- [ ] **Step 3: Handle Vite worker import for pdfjs-dist**

If the `?url` import doesn't work, add a `vite.config.ts` update to handle worker files:

Ensure `vite.config.ts` has:

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
```

(The `?url` import is supported by Vite by default, so no changes needed.)

- [ ] **Step 4: Register route in App.tsx**

Replace PDF Viewer placeholder with `<Viewer />` and add import.

---

### Self-Review Checklist

1. **Spec coverage:** All features from spec are covered: text→PDF (Task 4), image→PDF (Task 5), merge PDF (Task 6), split PDF (Task 6), PDF viewer with search & page selection (Task 7), Rust API commands (Task 2)
2. **Placeholder scan:** No TBD, TODO, or vague steps
3. **Type consistency:** All command names match between Rust (kebab_case) and frontend invoke (camelCase per Tauri convention)
