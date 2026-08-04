import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../components/Toast";
import { useFileDrop } from "../hooks/useFileDrop";
import "./ImageToPdf.css";
import "../styles/Converter.css";

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

  const handleFileDrop = useCallback(async (paths: string[]) => {
    if (paths.length > 0) {
      const items = await Promise.all(
        paths.map((p) => {
          const name = p.split("\\").pop() || p.split("/").pop() || p;
          return loadImageData(p, name);
        })
      );
      setImages((prev) => [...prev, ...items]);
    }
  }, []);

  const handleReject = useCallback(() => {
    showToast("error", "Format gambar tidak didukung (harus PNG, JPG, WEBP, atau BMP)");
  }, [showToast]);

  const { isHovering } = useFileDrop(handleFileDrop, ["png", "jpg", "jpeg", "webp", "bmp"], handleReject);

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
    const allowed = ["png", "jpg", "jpeg", "webp", "bmp"];
    const validPaths = paths.filter(p => {
      const ext = p.split('.').pop()?.toLowerCase() || '';
      return allowed.includes(ext);
    });

    if (validPaths.length !== paths.length) {
      handleReject();
    }
    
    if (validPaths.length === 0) return;

    const items = await Promise.all(
      validPaths.map((p) => {
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
      className="converter-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div className="page-header">
        <div>
          <h1>Image → PDF</h1>
          <p className="sub-title">Konversi kumpulan gambar menjadi dokumen PDF</p>
        </div>
      </div>

      <div className="converter-card">
        <div
          className={`drop-zone ${images.length > 0 ? "has-file" : ""} ${isHovering ? "is-hovering" : ""}`}
          onClick={addImages}
        >
          <div className="file-icon">🖼️</div>
          <h3>Pilih atau Drop Gambar</h3>
          <p>Klik atau seret gambar ke area ini (PNG, JPG, WEBP, BMP)</p>
        </div>

        <AnimatePresence mode="popLayout">
          {images.length > 0 && (
            <motion.div
              key="image-section"
              className="image-section"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              style={{ overflow: "hidden", marginTop: "12px" }}
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
                      style={{
                        background: "var(--bg-surface)",
                        border: "1px solid var(--border-color)",
                        padding: "8px 12px",
                        borderRadius: "8px",
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        marginBottom: "8px"
                      }}
                    >
                      <motion.img
                        className="image-thumb"
                        src={img.dataUrl}
                        alt={img.name}
                        onClick={() => setZoomImg(img)}
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        style={{ width: "40px", height: "40px", objectFit: "cover", borderRadius: "4px", cursor: "pointer" }}
                      />
                      <span className="image-name" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "13px" }}>
                        {img.name}
                      </span>
                      <div className="image-actions" style={{ display: "flex", gap: "4px" }}>
                        <button
                          onClick={() => moveImage(i, i - 1)}
                          disabled={i === 0}
                          style={{ border: "none", background: "none", cursor: i === 0 ? "not-allowed" : "pointer", opacity: i === 0 ? 0.3 : 1, color: "var(--text-primary)" }}
                        >↑</button>
                        <button
                          onClick={() => moveImage(i, i + 1)}
                          disabled={i === images.length - 1}
                          style={{ border: "none", background: "none", cursor: i === images.length - 1 ? "not-allowed" : "pointer", opacity: i === images.length - 1 ? 0.3 : 1, color: "var(--text-primary)" }}
                        >↓</button>
                        <button
                          className="btn-remove"
                          onClick={() => removeImage(i)}
                          style={{ marginLeft: "8px" }}
                        >×</button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          className="btn-convert"
          onClick={handleExport}
          disabled={loading || images.length === 0}
        >
          {loading ? (
            <>
              <span className="spinner-inline">⏳</span>
              Memproses...
            </>
          ) : (
            "Export to PDF"
          )}
        </button>
      </div>

      <AnimatePresence>
        {zoomImg && (
          <motion.div
            className="zoom-overlay"
            onClick={() => setZoomImg(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: "rgba(0,0,0,0.8)", zIndex: 1000,
              display: "flex", justifyContent: "center", alignItems: "center", padding: "40px"
            }}
          >
            <motion.div
              className="zoom-content"
              onClick={(e) => e.stopPropagation()}
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", position: "relative", maxWidth: "90%", maxHeight: "90%" }}
            >
              <button
                className="zoom-close"
                onClick={() => setZoomImg(null)}
                style={{
                  position: "absolute", top: "-40px", right: "0", background: "none", border: "none",
                  color: "white", fontSize: "30px", cursor: "pointer"
                }}
              >×</button>
              <img src={zoomImg.dataUrl} alt={zoomImg.name} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain", borderRadius: "8px", boxShadow: "0 10px 30px rgba(0,0,0,0.5)" }} />
              <p className="zoom-label" style={{ color: "white", marginTop: "16px", fontSize: "14px" }}>{zoomImg.name}</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
