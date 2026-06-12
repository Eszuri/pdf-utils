import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../components/Toast";
import "./ImageToPdf.css";

interface ImageItem {
  path: string;
  name: string;
  dataUrl: string;
}

function mimeFromExt(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "jpg": case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    default: return "image/png";
  }
}

export default function ImageToPdf() {
  const [images, setImages] = useState<ImageItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [zoomImg, setZoomImg] = useState<ImageItem | null>(null);
  const { showToast } = useToast();

  async function loadImageData(path: string, name: string): Promise<ImageItem> {
    const data: number[] = await invoke("read_pdf_bytes", { path });
    const blob = new Blob([new Uint8Array(data)], { type: mimeFromExt(name) });
    return { path, name, dataUrl: URL.createObjectURL(blob) };
  }

  async function addImages() {
    const files = await open({
      multiple: true,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "bmp"] }],
    });
    if (!files) return;
    const paths = Array.isArray(files) ? files : [files];
    const items = await Promise.all(
      paths.map((p) => {
        const name = p.split("\\").pop() || p.split("/").pop() || p;
        return loadImageData(p, name);
      })
    );
    setImages((prev) => [...prev, ...items]);
  }

  function removeImage(index: number) {
    const removed = images[index];
    URL.revokeObjectURL(removed.dataUrl);
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
      showToast("success", `PDF berhasil dibuat: ${path}`);
    } catch (e) {
      showToast("error", `Gagal membuat PDF: ${e}`);
    }
    setLoading(false);
  }

  return (
    <motion.div
      className="image-to-pdf"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.25 }}
    >
      <motion.h2
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        Image → PDF
      </motion.h2>
      <motion.p className="form-desc" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.07 }}>
        Konversi gambar ke PDF. Drag gambar untuk atur urutan.
      </motion.p>
      <motion.button
        className="btn-primary"
        onClick={addImages}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        Add Images
      </motion.button>

      <AnimatePresence mode="popLayout">
        {images.length > 0 && (
          <motion.div
            key="image-section"
            className="image-section"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
          >
            <motion.div className="image-list" layout>
              <AnimatePresence mode="popLayout">
                {images.map((img, i) => (
                  <motion.div
                    key={img.path + img.name}
                    className="image-item"
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.2 }}
                  >
                    <motion.img
                      className="image-thumb"
                      src={img.dataUrl}
                      alt={img.name}
                      onClick={() => setZoomImg(img)}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                    />
                    <span className="image-name">{img.name}</span>
                    <div className="image-actions">
                      <motion.button
                        onClick={() => moveImage(i, i - 1)}
                        disabled={i === 0}
                        whileTap={{ scale: 0.9 }}
                      >↑</motion.button>
                      <motion.button
                        onClick={() => moveImage(i, i + 1)}
                        disabled={i === images.length - 1}
                        whileTap={{ scale: 0.9 }}
                      >↓</motion.button>
                      <motion.button
                        className="btn-remove"
                        onClick={() => removeImage(i)}
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.9 }}
                      >×</motion.button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>

            <motion.button
              className="btn-primary"
              onClick={handleExport}
              disabled={loading}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              {loading ? "Processing..." : "Export to PDF"}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {zoomImg && (
          <motion.div
            className="zoom-overlay"
            onClick={() => setZoomImg(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <motion.div
              className="zoom-content"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <motion.button
                className="zoom-close"
                onClick={() => setZoomImg(null)}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >×</motion.button>
              <img src={zoomImg.dataUrl} alt={zoomImg.name} />
              <p className="zoom-label">{zoomImg.name}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
