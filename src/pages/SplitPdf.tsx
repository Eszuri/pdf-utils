import { useState, useRef, useCallback, useEffect } from "react";
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
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [loadedPath, setLoadedPath] = useState(pageThumbs.length ? filePath : "");
  const cachedPath = useRef(pageThumbs.length ? filePath : null);
  const [previewFile, setPreviewFile] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewToken = useRef(0);
  const { showToast } = useToast();
  const { t, openExplorer } = useSettings();

  useEffect(() => {
    if (!filePath || (cachedPath.current === filePath && reloadKey === 0)) return;
    cachedPath.current = null;
    let disposed = false;
    let task: pdfjsLib.PDFDocumentLoadingTask | undefined;
    const name = filePath.split(/[\\/]/).pop() || filePath;
    setFileName(name);
    setLoadedPath("");
    setPageCount(0);
    setPageThumbs([]);
    setSelectedPages([]);
    setLoadError("");
    setThumbsLoading(true);

    async function loadPdf() {
      try {
        const info = await invoke<{ page_count: number }>("get_pdf_info", { inputPath: filePath });
        if (disposed) return;
        setPageCount(info.page_count);
        setLoadedPath(filePath);
        const data: number[] = await invoke("read_pdf_bytes", { path: filePath });
        if (disposed) return;
        const pdfData = new Uint8Array(data);
        task = pdfjsLib.getDocument({ data: pdfData });
        const pdfDoc = await task.promise;
        if (disposed) return;

        const thumbs: { num: number; dataUrl: string }[] = [];
        const offscreen = document.createElement("canvas");
        const scale = 0.45;

        for (let i = 1; i <= pdfDoc.numPages; i++) {
          const page = await pdfDoc.getPage(i);
          if (disposed) return;
          const viewport = page.getViewport({ scale });
          offscreen.height = viewport.height;
          offscreen.width = viewport.width;
          await page.render({ canvas: offscreen, viewport }).promise;
          if (disposed) return;
          thumbs.push({ num: i, dataUrl: offscreen.toDataURL("image/png") });
        }
        setPageThumbs(thumbs);
      } catch (e) {
        if (!disposed) {
          const message = `Gagal memuat PDF: ${e}`;
          setLoadError(message);
          showToast("error", message);
        }
      } finally {
        if (!disposed) setThumbsLoading(false);
      }
    }
    void loadPdf();
    return () => {
      disposed = true;
      void task?.destroy().catch(console.error);
    };
  }, [filePath, reloadKey, setFileName, setPageThumbs, setSelectedPages, setPageCount, showToast]);

  const selectPdf = useCallback((path: string) => {
    setFilePath(path);
    setReloadKey((key) => key + 1);
  }, [setFilePath]);

  const handleFileDrop = useCallback((paths: string[]) => {
    if (paths.length > 0) {
      selectPdf(paths[0]);
    }
  }, [selectPdf]);

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

    selectPdf(p);
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
    if (loading || thumbsLoading || loadedPath !== filePath || selectedPages.length === 0) return;
    const inputPath = loadedPath;
    const pages = [...selectedPages].sort((a, b) => a - b);
    const path = await save({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      defaultPath: "extracted.pdf",
    });
    if (!path) return;

    setLoading(true);
    try {
      await invoke("split_pdf", { inputPath, pages, outputPath: path });
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

      <div className="converter-card" style={{ pointerEvents: loading ? "none" : "auto", opacity: loading ? 0.7 : 1 }}>
        <div
          className={`drop-zone ${filePath ? "has-file" : ""} ${isHovering && !loading ? "is-hovering" : ""}`}
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

        {loadError && (
          <div role="alert">
            <p>{loadError}</p>
            <button className="btn-secondary" onClick={() => setReloadKey((key) => key + 1)}>
              {t("splitPdf.retry")}
            </button>
          </div>
        )}

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
                {t("splitPdf.selectAll")}
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
                      <span>{t("splitPdf.page")} {thumb.num}</span>
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
                      {t("splitPdf.page")} {p}
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
          disabled={loading || thumbsLoading || loadedPath !== filePath || selectedPages.length === 0}
          style={{ marginTop: 12 }}
        >
          {loading ? (
            <>
              <span className="spinner-inline">⏳</span>
              {t("splitPdf.processing")}
            </>
          ) : (
            t("splitPdf.extractPages").replace("{count}", String(selectedPages.length))
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
