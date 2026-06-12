import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../components/Toast";
import "./MergeSplit.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export default function MergePdf() {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewToken = useRef(0);
  const { showToast } = useToast();

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
    
    // Show loading immediately
    setTimeout(() => {
      const container = previewRef.current;
      if (container && token === previewToken.current) {
        container.innerHTML = `<div class="pdf-loading"><div class="pdf-spinner"></div><span>Loading PDF...</span></div>`;
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
      className="page-form"
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
        Merge PDF
      </motion.h2>
      <motion.p
        className="form-desc"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08 }}
      >
        Gabung beberapa file PDF menjadi satu.
      </motion.p>
      <motion.button
        className="btn-primary"
        onClick={addFiles}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
      >
        Add PDF Files
      </motion.button>

      <AnimatePresence>
        {files.length > 0 && (
          <motion.div
            key="file-section"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="file-list">
              <AnimatePresence mode="popLayout">
                {files.map((f, i) => (
                  <motion.div
                    key={f}
                    className={`file-item ${previewFile === f ? "previewing" : ""}`}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ duration: 0.2 }}
                    onClick={() => togglePreview(f)}
                  >
                    <span>{f.split("\\").pop() || f.split("/").pop()}</span>
                    <motion.button
                      className="btn-remove"
                      onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                    >×</motion.button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
            <motion.button
              className="btn-primary"
              onClick={handleMerge}
              disabled={loading || files.length < 2}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              {loading ? "Merging..." : `Merge ${files.length} Files`}
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {previewFile && (
          <motion.div
            className="zoom-overlay"
            onClick={closePreview}
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
                onClick={closePreview}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
              >×</motion.button>
              <div className="pdf-preview-scroll" ref={previewRef}></div>
              <p className="zoom-label">
                {previewFile.split("\\").pop() || previewFile.split("/").pop()}
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
