# PDF Maker & Viewer — Design Spec

## Overview
A Tauri v2 desktop app (React + TypeScript frontend, Rust backend) for creating and viewing PDFs. The app provides a clean interface with a sidebar navigation and tab-based workflow.

## Architecture

```
Frontend (React + TS)          Backend (Rust/Tauri)
┌─────────────────────┐        ┌──────────────────┐
│ PDF Maker (forms)   │ invoke │ printpdf (create) │
│ PDF Viewer (pdf.js) │───────▶│ lopdf (manip)    │
│ Home Menu           │        └──────────────────┘
└─────────────────────┘
```

## Tech Stack
- **Frontend:** React 19, TypeScript, Vite, react-router-dom
- **Viewer:** pdfjs-dist (Mozilla PDF.js) for rendering + search
- **Backend:** Rust with `printpdf` (PDF creation) and `lopdf` (PDF manipulation)
- **Desktop:** Tauri v2, @tauri-apps/api

## Routing
```
/              → Home (menu utama)
/maker/text    → Text → PDF
/maker/image   → Image → PDF
/maker/merge   → Merge PDF
/maker/split   → Split PDF
/viewer        → PDF Viewer
```

## PDF Maker Features

### Text → PDF
- Editor teks sederhana (judul + paragraf)
- Pilih ukuran halaman (A4, Letter, dll)
- Export ke PDF via `printpdf`

### Image → PDF
- Pilih file gambar (JPEG, PNG) via file dialog
- Atur urutan gambar (drag to reorder)
- Pilih ukuran halaman
- Export ke PDF via `printpdf` (setiap gambar = 1 halaman)

### Merge PDF
- Pilih multiple file PDF
- Gabung jadi satu file PDF via `lopdf`

### Split PDF
- Pilih file PDF → tampilkan daftar halaman
- Centang halaman yang ingin diekstrak
- Export halaman terpilih ke PDF baru via `lopdf`

## PDF Viewer
- Buka file PDF via file dialog
- Render dengan pdfjs-dist (canvas-based)
- Search text dengan highlight + prev/next navigation
- Pilih halaman dengan checkbox per halaman
- Download selected pages sebagai PDF baru (via `lopdf` split)

## Rust API Commands

| Command | Params | Returns | Description |
|---------|--------|---------|-------------|
| `text_to_pdf` | text, output_path | void | Create PDF from text |
| `images_to_pdf` | image_paths[], output_path | void | Create PDF from images |
| `merge_pdfs` | input_paths[], output_path | void | Merge multiple PDFs |
| `split_pdf` | input_path, pages[], output_path | void | Extract selected pages |
| `get_pdf_info` | input_path | { page_count, title } | Get PDF metadata |

## Frontend Components
- **Layout**: Sidebar + main content area
- **Home**: Grid menu with icons untuk setiap fitur
- **TextToPdf**: TextArea + size picker + export button
- **ImageToPdf**: File upload area + image list + reorder + export
- **PdfMerger**: File list + merge button
- **PdfSplitter**: Page list with checkboxes + extract button
- **PdfViewer**: iframe/pdfjs canvas + search bar + page selector + download
