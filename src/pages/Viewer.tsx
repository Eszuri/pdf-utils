import { useState, useRef, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../components/Toast";
import { useSettings } from "../contexts/SettingsContext";
import "../styles/Converter.css";
import "./Viewer.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

interface PageText {
  num: number;
  text: string;
}

interface PageThumb {
  num: number;
  dataUrl: string;
}

export default function Viewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<pdfjsLib.PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageText[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [filePath, setFilePath] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ page: number; text: string }[] | null>(null);
  const activeSearchRef = useRef("");
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const [pageThumbs, setPageThumbs] = useState<PageThumb[]>([]);
  const [loading, setLoading] = useState(false);
  const [scale, setScale] = useState(1.5);
  const scaleRef = useRef(1.5);
  const renderTaskId = useRef(0);
  const [renderKey, setRenderKey] = useState(0);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0, px: 0, py: 0 });
  const { showToast } = useToast();
  const { t } = useSettings();

  const renderPage = useCallback(async (pdfDoc: pdfjsLib.PDFDocumentProxy, pageNum: number) => {
    const taskId = ++renderTaskId.current;
    const page = await pdfDoc.getPage(pageNum);
    const s = scaleRef.current;
    const viewport = page.getViewport({ scale: s });
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.height = viewport.height;
    canvas.width = viewport.width;
    await page.render({ canvas, viewport }).promise;

    const term = activeSearchRef.current;
    if (term && taskId === renderTaskId.current) {
      const textContent = await page.getTextContent();
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "rgba(255, 200, 0, 0.35)";
      const lower = term.toLowerCase();
      for (const item of textContent.items) {
        if (!("str" in item)) continue;
        const str: string = (item as any).str;
        if (!str || !str.toLowerCase().includes(lower)) continue;
        const tx = (item as any).transform;
        const x = tx[4] * s;
        const y = viewport.height - tx[5] * s;
        const w = ((item as any).width * s) || 40;
        const h = ((item as any).height * s) || 10;
        ctx.fillRect(x, y - Math.abs(h), Math.max(w, 20), Math.abs(h));
      }
    }

    if (taskId !== renderTaskId.current) return;
  }, []);

  useEffect(() => {
    if (!pdf) return;
    renderPage(pdf, currentPage);
  }, [pdf, currentPage, renderKey]);

  async function openPdf() {
    const path = await open({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!path) return;
    const p = Array.isArray(path) ? path[0] : path;
    setFilePath(p);

    try {
      const data: number[] = await invoke("read_pdf_bytes", { path: p });
      const pdfData = new Uint8Array(data);
      const pdfDoc = await pdfjsLib.getDocument({ data: pdfData }).promise;
      setPdf(pdfDoc);
      setTotalPages(pdfDoc.numPages);
      setCurrentPage(1);
      setSelectedPages(new Set());
      setPageThumbs([]);
      setScale(1.5);
      scaleRef.current = 1.5;
      setPanX(0);
      setPanY(0);

      const allPages: PageText[] = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const tc = await page.getTextContent();
        const text = tc.items.map((item: any) => item.str).join(" ");
        allPages.push({ num: i, text });
      }
      setPages(allPages);

      const offscreen = document.createElement("canvas");
      const thumbScale = 0.15;
      const thumbs: PageThumb[] = [];
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const vp = page.getViewport({ scale: thumbScale });
        offscreen.height = vp.height;
        offscreen.width = vp.width;
        await page.render({ canvas: offscreen, viewport: vp }).promise;
        thumbs.push({ num: i, dataUrl: offscreen.toDataURL("image/png") });
      }
      setPageThumbs(thumbs);
    } catch (e) {
      showToast("error", `Gagal membuka PDF: ${e}`);
    }
  }

  function updateScale(newScale: number) {
    scaleRef.current = newScale;
    setScale(newScale);
    setRenderKey((k) => k + 1);
  }

  function goToPage(n: number) {
    if (!pdf || n < 1 || n > totalPages) return;
    setCurrentPage(n);
    setPanX(0);
    setPanY(0);
  }

  function handleSearch() {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      activeSearchRef.current = "";
      setRenderKey((k) => k + 1);
      return;
    }
    const q = searchQuery.toLowerCase();
    activeSearchRef.current = q;
    const results = pages
      .filter((p) => p.text.toLowerCase().includes(q))
      .map((p) => ({ page: p.num, text: p.text }));
    setSearchResults(results);
    setRenderKey((k) => k + 1);
  }

  function jumpToSearchResult(pageNum: number) {
    goToPage(pageNum);
  }

  function onMouseDown(e: React.MouseEvent) {
    if (!pdf) return;
    isDragging.current = true;
    setIsPanning(true);
    dragStart.current = { x: e.clientX, y: e.clientY, px: panX, py: panY };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  function onMouseMove(e: MouseEvent) {
    if (!isDragging.current) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setPanX(dragStart.current.px + dx);
    setPanY(dragStart.current.py + dy);
  }

  function onMouseUp() {
    isDragging.current = false;
    setIsPanning(false);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  }

  function toggleSelectAll() {
    if (selectedPages.size === totalPages) {
      setSelectedPages(new Set());
    } else {
      setSelectedPages(new Set(Array.from({ length: totalPages }, (_, i) => i + 1)));
    }
  }

  function togglePage(p: number) {
    setSelectedPages((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  }

  async function downloadSelectedPages() {
    if (selectedPages.size === 0) return;
    const path = await save({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      defaultPath: "selected-pages.pdf",
    });
    if (!path) return;

    setLoading(true);
    try {
      await invoke("split_pdf", {
        inputPath: filePath,
        pages: Array.from(selectedPages).sort((a, b) => a - b),
        outputPath: path,
      });
      showToast("success", `Halaman berhasil diekstrak: ${path}`);
    } catch (e) {
      showToast("error", `Gagal mengekstrak halaman: ${e}`);
    }
    setLoading(false);
  }

  return (
    <motion.div
      className="viewer-layout"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.25 }}
    >
      <motion.div
        className="viewer-sidebar"
        initial={{ opacity: 0, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        <h3>{t("viewer.title")}</h3>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 14, marginTop: -8 }}>{t("viewer.desc")}</p>
        <motion.button
          className="btn-primary"
          onClick={openPdf}
          style={{ width: "100%" }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
        >
          {t("viewer.btnSelect")}
        </motion.button>

        <div className="search-section">
          <h4>Search</h4>
          <div className="search-row">
            <input
              type="text"
              placeholder="Search text..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value) { setSearchResults(null); activeSearchRef.current = ""; setRenderKey((k) => k + 1); } }}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
            <motion.button
              className="btn-small"
              onClick={handleSearch}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              Go
            </motion.button>
          </div>

          <AnimatePresence mode="wait">
            {searchResults && searchResults.length > 0 && (
              <motion.div
                key="results"
                className="search-results"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2 }}
              >
                {searchResults.slice(0, 50).map((r) => (
                  <motion.div
                    key={r.page}
                    className="search-result"
                    onClick={() => jumpToSearchResult(r.page)}
                    whileHover={{ x: 4 }}
                    transition={{ duration: 0.15 }}
                  >
                    <strong>Page {r.page}:</strong> {r.text}
                  </motion.div>
                ))}
              </motion.div>
            )}
            {searchQuery && searchResults && searchResults.length === 0 && (
              <motion.p
                key="no-results"
                className="no-results"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                No results found
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {totalPages > 0 && (
            <motion.div
              key="page-select"
              className="page-select-section"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.25, delay: 0.05 }}
            >
              <h4>Select Pages</h4>
              <label className="page-check-all">
                <input
                  type="checkbox"
                  checked={selectedPages.size === totalPages}
                  onChange={toggleSelectAll}
                  style={{ accentColor: "var(--accent)" }}
                />
                Select All ({totalPages} pages)
              </label>
              <div className="page-select-list">
                {pageThumbs.length > 0
                  ? pageThumbs.map((thumb) => (
                      <label
                        key={thumb.num}
                        className={`page-thumb-item ${selectedPages.has(thumb.num) ? "checked" : ""}`}
                        onClick={() => goToPage(thumb.num)}
                      >
                        <img src={thumb.dataUrl} alt={`Page ${thumb.num}`} />
                        <span className="page-num">{thumb.num}</span>
                        <input
                          type="checkbox"
                          checked={selectedPages.has(thumb.num)}
                          onChange={() => togglePage(thumb.num)}
                          style={{ accentColor: "var(--accent)" }}
                        />
                      </label>
                    ))
                  : Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                      <label
                        key={p}
                        className={`page-check-item ${selectedPages.has(p) ? "checked" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedPages.has(p)}
                          onChange={() => togglePage(p)}
                          style={{ accentColor: "var(--accent)" }}
                        />
                        Page {p}
                      </label>
                    ))}
              </div>
              <motion.button
                className="btn-primary"
                onClick={downloadSelectedPages}
                disabled={loading || selectedPages.size === 0}
                style={{ width: "100%", marginTop: 8 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
              >
                {loading ? "Downloading..." : `Download Selected (${selectedPages.size})`}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <div
        className="viewer-main"
        style={{ cursor: pdf ? (isPanning ? "grabbing" : "grab") : "default" }}
        onMouseDown={onMouseDown}
      >
        <AnimatePresence>
          {!pdf ? (
            <motion.div
              key="empty"
              className="viewer-empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📄</div>
                <div style={{ color: "var(--text-muted)", fontSize: 15 }}>{t("viewer.desc")}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4, opacity: 0.6 }}>Klik "Open PDF" untuk memulai</div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="viewer"
              className="viewer-content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="viewer-toolbar">
                <motion.button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >← Prev</motion.button>
                <span className="page-indicator">Page {currentPage} of {totalPages}</span>
                <motion.button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >Next →</motion.button>
                <span className="zoom-controls">
                  <motion.button
                    onClick={() => updateScale(Math.max(0.5, scale - 0.25))}
                    whileTap={{ scale: 0.9 }}
                  >−</motion.button>
                  <span>{Math.round(scale * 100)}%</span>
                  <motion.button
                    onClick={() => updateScale(Math.min(3, scale + 0.25))}
                    whileTap={{ scale: 0.9 }}
                  >+</motion.button>
                </span>
              </div>
              <div className="viewer-canvas-wrapper" style={{ transform: `translate(${panX}px, ${panY}px)`, transition: isPanning ? "none" : "transform 0.15s ease-out" }}>
                <canvas ref={canvasRef}></canvas>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
