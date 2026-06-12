import { useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../components/Toast";
import "./MergeSplit.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface PageThumb {
  num: number;
  dataUrl: string;
}

export default function SplitPdf() {
  const [filePath, setFilePath] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [pageThumbs, setPageThumbs] = useState<PageThumb[]>([]);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);
  const [thumbsLoading, setThumbsLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewToken = useRef(0);
  const { showToast } = useToast();

  async function openFile() {
    const path = await open({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path) return;
    const p = Array.isArray(path) ? path[0] : path;
    setFilePath(p);
    setPageThumbs([]);

    try {
      const info: any = await invoke("get_pdf_info", { inputPath: p });
      setPageCount(info.page_count);
    } catch (e) {
      showToast("error", `Gagal membaca PDF: ${e}`);
      return;
    }
    setSelectedPages([]);

    setThumbsLoading(true);
    try {
      const data: number[] = await invoke("read_pdf_bytes", { path: p });
      const pdfData = new Uint8Array(data);
      const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;

      const thumbs: PageThumb[] = [];
      const offscreen = document.createElement("canvas");
      const scale = 0.45;

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale });
        offscreen.height = viewport.height;
        offscreen.width = viewport.width;
        await page.render({ canvas: offscreen, viewport }).promise;
        thumbs.push({ num: i, dataUrl: offscreen.toDataURL("image/png") });
      }
      setPageThumbs(thumbs);
    } catch (e) {
      showToast("error", `Gagal render thumbnail: ${e}`);
    }
    setThumbsLoading(false);
  }

  function togglePage(page: number) {
    setSelectedPages((prev) =>
      prev.includes(page) ? prev.filter((p) => p !== page) : [...prev, page]
    );
  }

  function selectAll() {
    if (selectedPages.length === pageCount) {
      setSelectedPages([]);
    } else {
      setSelectedPages(Array.from({ length: pageCount }, (_, i) => i + 1));
    }
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
      showToast("success", `PDF berhasil diekstrak: ${path}`);
    } catch (e) {
      showToast("error", `Gagal mengekstrak PDF: ${e}`);
    }
    setLoading(false);
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
        Split PDF
      </motion.h2>
      <motion.p
        className="form-desc"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.08 }}
      >
        Pilih halaman yang ingin diekstrak dari PDF.
      </motion.p>
      <motion.button
        className="btn-primary"
        onClick={openFile}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        disabled={thumbsLoading}
      >
        {thumbsLoading ? "Loading..." : filePath ? "Change File" : "Open PDF"}
      </motion.button>

      <AnimatePresence>
        {filePath && (
          <motion.div
            key="file-info"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
          >
            <p
              className={`file-info ${previewFile === filePath ? "previewing" : ""}`}
              onClick={() => togglePreview(filePath)}
            >
              File: {filePath.split("\\").pop() || filePath.split("/").pop()} ({pageCount} pages) — klik untuk preview
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pageCount > 0 && (
          <motion.div
            key="page-section"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.25, delay: 0.05 }}
          >
            <label className="select-all" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginTop: 12, cursor: "pointer", color: "var(--text-primary)" }}>
              <input
                type="checkbox"
                checked={selectedPages.length === pageCount}
                onChange={selectAll}
                style={{ accentColor: "var(--accent)" }}
              />
              Select All
            </label>

            <motion.div
              className="page-grid page-thumb-grid"
              initial="hidden"
              animate="visible"
              variants={{
                hidden: { opacity: 0 },
                visible: { opacity: 1, transition: { staggerChildren: 0.03 } },
              }}
            >
              {pageThumbs.length > 0 ? pageThumbs.map((thumb) => (
                <motion.div
                  key={thumb.num}
                  className={`page-thumb-card ${selectedPages.includes(thumb.num) ? "checked" : ""}`}
                  variants={{
                    hidden: { opacity: 0, scale: 0.9 },
                    visible: { opacity: 1, scale: 1 },
                  }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => togglePage(thumb.num)}
                >
                  <div className="page-thumb-img">
                    <img src={thumb.dataUrl} alt={`Page ${thumb.num}`} />
                  </div>
                  <div className="page-thumb-label">
                    <input
                      type="checkbox"
                      checked={selectedPages.includes(thumb.num)}
                      onChange={() => togglePage(thumb.num)}
                      style={{ accentColor: "var(--accent)" }}
                    />
                    <span>Page {thumb.num}</span>
                  </div>
                </motion.div>
              )) : (
                Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                  <motion.label
                    key={p}
                    className={`page-check ${selectedPages.includes(p) ? "checked" : ""}`}
                    variants={{
                      hidden: { opacity: 0, scale: 0.9 },
                      visible: { opacity: 1, scale: 1 },
                    }}
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedPages.includes(p)}
                      onChange={() => togglePage(p)}
                      style={{ accentColor: "var(--accent)" }}
                    />
                    Page {p}
                  </motion.label>
                ))
              )}
            </motion.div>
            <motion.button
              className="btn-primary"
              onClick={handleExtract}
              disabled={loading || selectedPages.length === 0}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
            >
              {loading ? "Extracting..." : `Extract ${selectedPages.length} Pages`}
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
