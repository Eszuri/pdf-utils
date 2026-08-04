import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { motion, Reorder, AnimatePresence } from "framer-motion";
import { useToast } from "../components/Toast";
import { useFileDrop } from "../hooks/useFileDrop";
import { useSettings } from "../contexts/SettingsContext";
import { useToolState, ImageItem } from "../contexts/ToolStateContext";
import "./ImageToPdf.css";
import "../styles/Converter.css";

export default function ImageToPdf() {
  const { imgToPdfImages: images, setImgToPdfImages: setImages } = useToolState();
  const [loading, setLoading] = useState(false);
  const [zoomImg, setZoomImg] = useState<ImageItem | null>(null);
  const { showToast } = useToast();
  const { t, openExplorer } = useSettings();

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
    showToast("error", t("imgToPdf.errFormat"));
  }, [showToast, t]);

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
    setImages((prev) => {
      const newImages = [...prev];
      URL.revokeObjectURL(newImages[index].dataUrl);
      newImages.splice(index, 1);
      return newImages;
    });
  }

  function mimeFromExt(name: string) {
    const ext = name.split(".").pop()?.toLowerCase();
    switch (ext) {
      case "png": return "image/png";
      case "jpg":
      case "jpeg": return "image/jpeg";
      case "webp": return "image/webp";
      case "bmp": return "image/bmp";
      default: return "application/octet-stream";
    }
  }

  async function handleExport() {
    if (images.length === 0) return;
    const savePath = await save({
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      defaultPath: "images.pdf",
    });
    if (!savePath) return;

    setLoading(true);
    try {
      const paths = images.map((img) => img.path);
      await invoke("images_to_pdf", { imagePaths: paths, outputPath: savePath });
      showToast("success", `PDF berhasil disimpan ke: ${savePath}`);
      if (openExplorer) {
        invoke("show_in_folder", { path: savePath }).catch(e => console.error(e));
      }
    } catch (e: any) {
      showToast("error", `Error: ${e}`);
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
          <h1>{t("imgToPdf.title")}</h1>
          <p className="sub-title">{t("imgToPdf.desc")}</p>
        </div>
      </div>

      <div className="converter-card" style={{ position: "relative" }}>
        {isHovering && (
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: "rgba(59, 130, 246, 0.9)", zIndex: 10,
            display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
            borderRadius: "var(--radius)", color: "white"
          }}>
            <div className="file-icon" style={{ fontSize: "48px", marginBottom: "16px" }}>📸</div>
            <h3 style={{ fontSize: "18px", fontWeight: "bold" }}>{t("imgToPdf.dropText")}</h3>
            <p>{t("imgToPdf.dropSub")}</p>
          </div>
        )}

        <div className="drop-zone" onClick={addImages} style={{ margin: "0 0 20px 0" }}>
          <div className="file-icon">🖼️</div>
          <h3>{t("imgToPdf.dropText")}</h3>
          <p>{t("imgToPdf.dropSub")}</p>
        </div>

        {images.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "13px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {images.length} File terpilih
            </span>
            <button className="btn-secondary" onClick={() => setImages([])} disabled={loading} style={{ color: "var(--danger)", borderColor: "transparent", background: "rgba(244, 63, 94, 0.1)", padding: "6px 12px", fontSize: "12px" }}>
              🗑 {t("imgToPdf.btnClear")}
            </button>
          </div>
        )}

        {images.length > 0 && (
          <div className="file-scroll-container">
            <Reorder.Group axis="y" values={images} onReorder={setImages} className="file-list">
              <AnimatePresence>
                {images.map((img, i) => (
                <Reorder.Item key={img.path} value={img} className="file-item">
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%" }}>
                    <img
                      src={img.dataUrl}
                      className="image-thumb"
                      onClick={() => setZoomImg(img)}
                      alt={img.name}
                    />
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }}>
                      <span className="image-name" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "13px" }}>
                        {img.name}
                      </span>
                    </div>
                    <div className="image-actions">
                      <button
                        onClick={() => {
                          const arr = [...images];
                          [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                          setImages(arr);
                        }}
                        disabled={i === 0 || loading}
                        style={{ border: "none", background: "none", cursor: i === 0 ? "not-allowed" : "pointer", opacity: i === 0 ? 0.3 : 1, color: "var(--text-primary)" }}
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => {
                          const arr = [...images];
                          [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
                          setImages(arr);
                        }}
                        disabled={i === images.length - 1 || loading}
                        style={{ border: "none", background: "none", cursor: i === images.length - 1 ? "not-allowed" : "pointer", opacity: i === images.length - 1 ? 0.3 : 1, color: "var(--text-primary)" }}
                      >
                        ▼
                      </button>
                      <button className="btn-remove" onClick={() => removeImage(i)} disabled={loading} style={{ background: "none", border: "none", cursor: "pointer" }}>
                        ✖
                      </button>
                    </div>
                  </div>
                </Reorder.Item>
                ))}
              </AnimatePresence>
            </Reorder.Group>
          </div>
        )}

        <button
          className="btn-convert"
          onClick={handleExport}
          disabled={images.length === 0 || loading}
        >
          {loading ? (
            <>
              <span className="spinner-inline">⏳</span>
              {t("imgToPdf.processing")}
            </>
          ) : (
            t("imgToPdf.btnExport")
          )}
        </button>
      </div>

      <AnimatePresence>
        {zoomImg && (
          <motion.div
            className="zoom-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setZoomImg(null)}
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
