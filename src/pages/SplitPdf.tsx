import { useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../components/Toast";
import { useFileDrop } from "../hooks/useFileDrop";
import { useSettings } from "../contexts/SettingsContext";
import { useToolState } from "../contexts/ToolStateContext";
import "./MergeSplit.css";
import "../styles/Converter.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

export default function SplitPdf() {
  const {
    splitPdfFilePath: filePath, setSplitPdfFilePath: setFilePath,
    splitPdfFileName: fileName, setSplitPdfFileName: setFileName,
    splitPdfPageCount: pageCount, setSplitPdfPageCount: setPageCount,
    splitPdfThumbs: pageThumbs, setSplitPdfThumbs: setPageThumbs,
    splitPdfSelectedPages: selectedPages, setSplitPdfSelectedPages: setSelectedPages
  } = useToolState();

  const [loading, setLoading] = useState(false);
  const [thumbsLoading, setThumbsLoading] = useState(false);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewToken = useRef(0);
  const { showToast } = useToast();
  const { t, openExplorer } = useSettings();

  const loadPdf = useCallback(async (p: string) => {
    setFilePath(p);
    const name = p.split("\\").pop() || p.split("/").pop() || p;
    setFileName(name);
    setPageThumbs([]);
    setSelectedPages([]);

    try {
      const info: any = await invoke("get_pdf_info", { inputPath: p });
      setPageCount(info.page_count);
    } catch (e) {
      showToast("error", `Gagal membaca PDF: ${e}`);
      return;
    }

    setThumbsLoading(true);
    try {
      const data: number[] = await invoke("read_pdf_bytes", { path: p });
      const pdfData = new Uint8Array(data);
      const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;

      const thumbs: { num: number; dataUrl: string }[] = [];
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
  }, [setFilePath, setFileName, setPageThumbs, setSelectedPages, setPageCount, showToast]);

  const handleFileDrop = useCallback((paths: string[]) => {
    if (paths.length > 0) {
      loadPdf(paths[0]);
    }
  }, [loadPdf]);

  const handleReject = useCallback(() => {
    showToast("error", t("splitPdf.errFormat"));
  }, [showToast, t]);

  const { isHovering } = useFileDrop(handleFileDrop, ["pdf"], handleReject);

  async function openFile() {
    const path = await open({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path) return;
    const p = Array.isArray(path) ? path[0] : path;
    
    const ext = p.split('.').pop()?.toLowerCase() || '';
    if (ext !== "pdf") {
      handleReject();
      return;
    }

    loadPdf(p);
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

  async function handleExtract() {
    if (selectedPages.length === 0) return;
    const path = await save({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      defaultPath: "extracted.pdf",
    });
    if (!path) return;

    setLoading(true);
    try {
      await invoke("split_pdf", { inputPath: filePath, pages: selectedPages.sort((a,b)=>a-b), outputPath: path });
      showToast("success", `PDF berhasil diekstrak: ${path}`);
      if (openExplorer) {
        invoke("show_in_folder", { path }).catch(e => console.error(e));
      }
    } catch (e) {
      showToast("error", `Gagal mengekstrak PDF: ${e}`);
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
          <h1>{t("splitPdf.title")}</h1>
          <p className="sub-title">{t("splitPdf.desc")}</p>
        </div>
      </div>

      <div className="converter-card">
        <div
          className={`drop-zone ${filePath ? "has-file" : ""} ${isHovering ? "is-hovering" : ""}`}
          onClick={openFile}
          style={{ pointerEvents: thumbsLoading ? "none" : "auto", opacity: thumbsLoading ? 0.7 : 1 }}
        >
          {thumbsLoading ? (
            <>
              <div className="file-icon"><span className="spinner-inline">⏳</span></div>
              <h3>Loading Thumbnails...</h3>
              <p>Mohon tunggu sebentar</p>
            </>
          ) : filePath ? (
            <>
              <div className="file-icon">📄</div>
              <h3 className="file-name">{fileName}</h3>
              <p className="file-path">{filePath}</p>
              <button className="btn-change">Ganti File</button>
            </>
          ) : (
            <>
              <div className="file-icon">📂</div>
              <h3>{t("splitPdf.dropText")}</h3>
              <p>{t("splitPdf.dropSub")}</p>
            </>
          )}
        </div>

        <AnimatePresence>
          {filePath && (
            <motion.div
              key="file-info"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              style={{ overflow: "hidden" }}
            >
              <div style={{ marginTop: 16 }}>
                <p
                  className={`file-info ${previewFile === filePath ? "previewing" : ""}`}
                  onClick={() => togglePreview(filePath)}
                  style={{ cursor: "pointer", color: "var(--accent)", fontSize: "13px" }}
                >
                  Lihat preview dokumen ({pageCount} halaman)
                </p>
              </div>
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
              transition={{ duration: 0.25 }}
            >
              <label className="select-all" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, marginBottom: 12, cursor: "pointer", color: "var(--text-primary)" }}>
                <input
                  type="checkbox"
                  checked={selectedPages.length === pageCount}
                  onChange={selectAll}
                  style={{ accentColor: "var(--accent)" }}
                />
                Select All Pages
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
            </motion.div>
          )}
        </AnimatePresence>

        <button
          className="btn-convert"
          onClick={handleExtract}
          disabled={loading || selectedPages.length === 0}
          style={{ marginTop: 12 }}
        >
          {loading ? (
            <>
              <span className="spinner-inline">⏳</span>
              {t("splitPdf.processing")}
            </>
          ) : (
            `Extract ${selectedPages.length} Pages`
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
