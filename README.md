# 📄 PDF Utils

Aplikasi desktop modern, ringan, dan cepat untuk pengolahan dokumen PDF berbasis **Tauri v2 (Rust)** dan **React 19 (TypeScript)**.

Tersedia dalam bentuk **Single Portable Executable** dan installer resmi Windows — **Zero Configuration** (tanpa perlu menginstal Python atau dependensi tambahan).

![PDF Utils Preview](docs/preview.png)

---

## ✨ Fitur Utama

- 🖼️ **Image to PDF**: Konversi dan gabungkan gambar (PNG, JPG, WEBP, BMP) ke ukuran standar A4 secara otomatis.
- 🔗 **Merge PDF**: Gabungkan beberapa dokumen PDF menjadi satu file berurutan dengan mudah.
- ✂️ **Split PDF**: Pratinjau visual thumbnail dan ekstrak halaman tertentu ke dokumen baru.
- 📝 **PDF to Word (.docx)**: Konversi PDF ke dokumen Word yang dapat diedit dengan rekonstruksi tabel, tata letak, dan gaya teks presisi.
- 👁️ **PDF Viewer**: Penampil dokumen PDF bawaan dengan navigasi halaman dan pencarian teks.
- 🌐 **Multi-bahasa & Tema**: Antarmuka Bahasa Indonesia & English dengan pilihan warna aksen kustom.

---

## 🚀 Memulai Cepat (Development)

### Prasyarat
- **Node.js** (v18+) & **Rust** (v1.75+)
- **Python 3.12+** *(hanya diperlukan jika ingin memodifikasi kode engine Word di `engine/`)*

### Menjalankan Aplikasi
```bash
# 1. Kloning repositori
git clone https://github.com/Eszuri/pdf-utils.git
cd pdf-utils

# 2. Instalasi dependensi
npm install

# 3. Jalankan mode pengembangan
npm run tauri dev
```

---

## 📦 Build & Rilis (Production)

| Perintah | Fungsi |
| :--- | :--- |
| `npm run tauri build` | Merakit installer (`.msi`) dan standalone `.exe` utama menggunakan engine yang sudah ada. |
| `npm run engine:build` | Merakit ulang biner Python engine (`pdf-word-engine.exe`) dari folder `engine/`. |
| `npm run build:all` | Merakit engine Python terlebih dahulu, lalu mem-build aplikasi Tauri secara penuh. |

Hasil build biner Windows akan berada di:
- **Portable Single `.exe`**: `src-tauri/target/release/pdf-utils.exe`
- **Installer MSI**: `src-tauri/target/release/bundle/msi/`

> **CI/CD Auto-Release**: Repositori ini telah dilengkapi GitHub Actions. Setiap kali git tag dipush (contoh: `git tag v1.0.0 && git push origin --tags`), GitHub akan otomatis mem-build dan merilis installer `.msi` serta file portable `.exe`.

---

## 🛠️ Tech Stack

- **Frontend**: [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/), [Framer Motion](https://www.framer.com/motion/), [PDF.js](https://mozilla.github.io/pdf.js/)
- **Backend Core**: [Tauri v2](https://tauri.app/), [Rust](https://www.rust-lang.org/) (`lopdf`, `printpdf`)
- **Word Engine**: PyMuPDF, python-docx, PyInstaller (*embedded standalone binary*)

---

## 📜 Lisensi

Dilisensikan di bawah [MIT License](LICENSE).
