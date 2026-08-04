import { useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../components/Toast";
import { useFileDrop } from "../hooks/useFileDrop";
import "../styles/Converter.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export default function MergePdf() {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewToken = useRef(0);
  const { showToast } = useToast();

  const handleFileDrop = useCallback((paths: string[]) => {
    if (paths.length > 0) {
      setFiles((prev) => [...prev, ...paths]);
    }
  }, []);

  const { isHovering } = useFileDrop(handleFileDrop, ["pdf"]);

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
      showToast("success", `PDF berhasil digabung: ${path}`);
    } catch (e) {
      showToast("error", `Gagal menggabung PDF: ${e}`);
    }
    setLoading(false);
  }

  async function togglePreview(path: string) {
    if (previewFile === path) {
      closePreview();
      return;
    }

    const token = ++previewToken.current;
    setPreviewFile(path);
    
    setTimeout(() => {
      const container = previewRef.current;
      if (container && token === previewToken.current) {
        container.innerHTML = `<div class="pdf-loading" style="text-align: center; padding: 20px;"><span class="spinner-inline">⏳</span> Loading PDF...</div>`;
      }
    }, 0);

    try {
      const data: number[] = await invoke("read_pdf_bytes", { path });
      if (token !== previewToken.current) return;

      const pdfData = new Uint8Array(data);
      const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
      if (token !== previewToken.current) return;

      const container = previewRef.current;
      if (!container) return;
      container.innerHTML = "";

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        if (token !== previewToken.current) return;
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: 1.0 });
        const canvas = document.createElement("canvas");
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.style.display = "block";
        canvas.style.margin = "0 auto 12px";
        canvas.style.boxShadow = "0 2px 12px rgba(0,0,0,0.3)";
        canvas.style.borderRadius = "4px";
        container.appendChild(canvas);
        await page.render({ canvas, viewport }).promise;
      }
    } catch (e) {
      if (token === previewToken.current) {
        showToast("error", `Gagal menampilkan preview: ${e}`);
        closePreview();
      }
    }
  }

  function closePreview() {
    setPreviewFile(null);
    if (previewRef.current) {
      previewRef.current.innerHTML = "";
    }
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
          <h1>Merge PDF</h1>
          <p className="sub-title">Gabung beberapa file PDF menjadi satu</p>
        </div>
      </div>

      <div className="converter-card">
        <div
          className={`drop-zone ${files.length > 0 ? "has-file" : ""} ${isHovering ? "is-hovering" : ""}`}
          onClick={addFiles}
        >
          <div className="file-icon">📂</div>
          <h3>Pilih atau Drop File PDF</h3>
          <p>Klik atau seret dokumen PDF ke area ini</p>
        </div>

        <AnimatePresence>
          {files.length > 0 && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              style={{ overflow: "hidden" }}
            >
              <div className="file-list">
                <AnimatePresence mode="popLayout">
                  {files.map((f, i) => (
                    <motion.div
                      key={`${f}-${i}`}
                      className="file-item"
                      layout
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      onClick={() => togglePreview(f)}
                    >
                      <span title={f}>{f.split("\\").pop() || f.split("/").pop()}</span>
                      <button
                        className="btn-remove"
                        onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                        title="Hapus file"
                      >
                        ×
                      </button>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          className="btn-convert"
          onClick={handleMerge}
          disabled={loading || files.length < 2}
        >
          {loading ? (
            <>
              <span className="spinner-inline">⏳</span>
              Merging...
            </>
          ) : (
            `Merge ${files.length} Files`
          )}
        </button>
      </div>

      <AnimatePresence>
        {previewFile && (
          <motion.div
            className="zoom-overlay"
            onClick={closePreview}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            style={{
              position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: "rgba(0,0,0,0.6)", zIndex: 1000,
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
              style={{
                background: "var(--bg-surface)", padding: "20px", borderRadius: "12px",
                width: "100%", maxWidth: "800px", maxHeight: "100%", display: "flex", flexDirection: "column"
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h4 style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {previewFile.split("\\").pop() || previewFile.split("/").pop()}
                </h4>
                <button
                  onClick={closePreview}
                  style={{ background: "none", border: "none", fontSize: "24px", cursor: "pointer", color: "var(--text-primary)" }}
                >
                  ×
                </button>
              </div>
              <div className="pdf-preview-scroll" ref={previewRef} style={{ overflowY: "auto", flex: 1, background: "#e5e7eb", borderRadius: "8px", padding: "20px" }}></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

