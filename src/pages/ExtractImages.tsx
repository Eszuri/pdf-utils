import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as pdfjsLib from "pdfjs-dist";
import workerSrc from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../components/Toast";
import { useFileDrop } from "../hooks/useFileDrop";
import { useSettings } from "../contexts/SettingsContext";
import { useToolState, type ExtractedImageItem } from "../contexts/ToolStateContext";
import "../styles/Converter.css";
import "./ExtractImages.css";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

function dataUrlToBytes(dataUrl: string): number[] {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return Array.from(bytes);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\-.]/g, "_");
}

export default function ExtractImages() {
  const {
    extractPdfFilePath: filePath,
    setExtractPdfFilePath: setFilePath,
    extractPdfFileName: fileName,
    setExtractPdfFileName: setFileName,
    extractPdfPageCount: pageCount,
    setExtractPdfPageCount: setPageCount,
    extractedImages,
    setExtractedImages,
    extractSelectedIds: selectedIds,
    setExtractSelectedIds: setSelectedIds,
  } = useToolState();

  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ current: number; total: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [previewImage, setPreviewImage] = useState<ExtractedImageItem | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const { showToast } = useToast();
  const { t, openExplorer } = useSettings();
  const cachedPath = useRef<string | null>(extractedImages.length ? filePath : null);

  const scanPdfImages = useCallback(
    async (path: string) => {
      const name = path.split(/[\\/]/).pop() || path;
      setFileName(name);
      setExtractedImages([]);
      setSelectedIds([]);
      setScanProgress(null);
      setScanning(true);

      try {
        const info = await invoke<{ page_count: number }>("get_pdf_info", { inputPath: path });
        const total = info.page_count;
        setPageCount(total);

        const data: number[] = await invoke("read_pdf_bytes", { path });
        const loadingTask = pdfjsLib.getDocument({
          data: new Uint8Array(data),
          standardFontDataUrl: "/pdfjs/standard_fonts/",
          cMapUrl: "/pdfjs/cmaps/",
          cMapPacked: true,
        });

        const pdfDoc = await loadingTask.promise;
        const foundImages: ExtractedImageItem[] = [];
        const seenIds = new Map<string, ExtractedImageItem>();

        for (let i = 1; i <= pdfDoc.numPages; i++) {
          setScanProgress({ current: i, total: pdfDoc.numPages });
          const page = await pdfDoc.getPage(i);
          const ops = await page.getOperatorList();

          for (let j = 0; j < ops.fnArray.length; j++) {
            const fn = ops.fnArray[j];
            let imgObj: any = null;
            let imageKey = "";

            if (fn === pdfjsLib.OPS.paintImageXObject) {
              const id = ops.argsArray[j][0];
              imageKey = id;

              // Check if we've already extracted this common object
              if (seenIds.has(id)) {
                const existing = seenIds.get(id)!;
                if (!existing.pages.includes(i)) {
                  existing.pages.push(i);
                }
                continue;
              }

              const isCommon = id.startsWith("g_");
              const container = isCommon ? page.commonObjs : page.objs;
              try {
                imgObj = await new Promise((resolve) => container.get(id, resolve));
              } catch (e) {
                console.warn(`Failed to resolve image ${id} on page ${i}:`, e);
                continue;
              }
            } else if (fn === pdfjsLib.OPS.paintInlineImageXObject) {
              imgObj = ops.argsArray[j][0];
              imageKey = `inline_p${i}_${j}`;
            }

            if (!imgObj || !imgObj.width || !imgObj.height || imgObj.width <= 2 || imgObj.height <= 2) {
              continue;
            }

            const width = imgObj.width;
            const height = imgObj.height;
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext("2d");

            if (ctx) {
              if (imgObj.bitmap) {
                ctx.drawImage(imgObj.bitmap, 0, 0);
              } else if (imgObj.data) {
                const expectedRgba = width * height * 4;
                const len = imgObj.data.length;
                let rgbaData: Uint8ClampedArray;

                if (imgObj.kind === 3 || len === expectedRgba) {
                  rgbaData =
                    imgObj.data instanceof Uint8ClampedArray
                      ? imgObj.data
                      : new Uint8ClampedArray(imgObj.data);
                } else if (imgObj.kind === 2 || len === width * height * 3) {
                  rgbaData = new Uint8ClampedArray(expectedRgba);
                  let s = 0,
                    d = 0;
                  const totalPixels = width * height;
                  for (let p = 0; p < totalPixels; p++) {
                    rgbaData[d] = imgObj.data[s];
                    rgbaData[d + 1] = imgObj.data[s + 1];
                    rgbaData[d + 2] = imgObj.data[s + 2];
                    rgbaData[d + 3] = 255;
                    s += 3;
                    d += 4;
                  }
                } else if (imgObj.kind === 1 || len === width * height) {
                  rgbaData = new Uint8ClampedArray(expectedRgba);
                  let s = 0,
                    d = 0;
                  const totalPixels = width * height;
                  for (let p = 0; p < totalPixels; p++) {
                    const v = imgObj.data[s++];
                    rgbaData[d] = v;
                    rgbaData[d + 1] = v;
                    rgbaData[d + 2] = v;
                    rgbaData[d + 3] = 255;
                    d += 4;
                  }
                } else {
                  rgbaData = new Uint8ClampedArray(expectedRgba);
                  rgbaData.fill(255);
                }

                const imageData = new ImageData(rgbaData, width, height);
                ctx.putImageData(imageData, 0, 0);
              }
            }

            const dataUrl = canvas.toDataURL("image/png");
            const item: ExtractedImageItem = {
              id: imageKey,
              name: `image_${foundImages.length + 1}`,
              pages: [i],
              width,
              height,
              dataUrl,
            };

            foundImages.push(item);
            seenIds.set(imageKey, item);
          }
        }

        setExtractedImages(foundImages);
        // By default, select all found images
        setSelectedIds(foundImages.map((img) => img.id));

        if (foundImages.length === 0) {
          showToast("error", t("extractImages.noImages"));
        } else {
          showToast("success", `${foundImages.length} ${t("word.images")} ditemukan!`);
        }
      } catch (e: any) {
        showToast("error", `Gagal memindai gambar PDF: ${e}`);
      } finally {
        setScanning(false);
        setScanProgress(null);
      }
    },
    [setExtractedImages, setFileName, setPageCount, setSelectedIds, showToast, t]
  );

  useEffect(() => {
    if (!filePath) return;
    if (cachedPath.current === filePath && reloadKey === 0) return;
    cachedPath.current = filePath;
    void scanPdfImages(filePath);
  }, [filePath, reloadKey, scanPdfImages]);

  const handleSelectFile = useCallback(
    (paths: string[]) => {
      if (paths.length === 0) return;
      const path = paths[0];
      if (!path.toLowerCase().endsWith(".pdf")) {
        showToast("error", t("splitPdf.errFormat"));
        return;
      }
      setFilePath(path);
      setReloadKey((k) => k + 1);
    },
    [setFilePath, showToast, t]
  );

  const { isHovering } = useFileDrop(handleSelectFile, ["pdf"], () =>
    showToast("error", t("splitPdf.errFormat"))
  );

  async function openPdfDialog() {
    if (scanning || exporting) return;
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (selected && typeof selected === "string") {
        handleSelectFile([selected]);
      }
    } catch (e) {
      showToast("error", String(e));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  }

  function handleSelectAll() {
    if (selectedIds.length === extractedImages.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(extractedImages.map((img) => img.id));
    }
  }

  // Single image save
  async function saveSingleImage(img: ExtractedImageItem) {
    if (exporting) return;
    try {
      const stem = fileName.replace(/\.pdf$/i, "");
      const pageStr = img.pages.join("-");
      const defaultName = `${sanitizeFileName(stem)}_hal${pageStr}_${img.name}.png`;

      const outputPath = await save({
        defaultPath: defaultName,
        filters: [{ name: "PNG Image", extensions: ["png"] }],
      });

      if (!outputPath) return;
      const targetPath = outputPath.toLowerCase().endsWith(".png") ? outputPath : `${outputPath}.png`;

      setExporting(true);
      const bytes = dataUrlToBytes(img.dataUrl);
      await invoke("save_reader_file", { data: bytes, outputPath: targetPath });

      showToast("success", t("extractImages.extractSingleSuccess").replace("{path}", targetPath));

      if (openExplorer) {
        invoke("show_in_folder", { path: targetPath }).catch(console.error);
      }
    } catch (e: any) {
      showToast("error", `Gagal menyimpan gambar: ${e}`);
    } finally {
      setExporting(false);
    }
  }

  // Batch extract selected images
  async function handleBatchExtract() {
    if (exporting || selectedIds.length === 0) return;

    const selectedItems = extractedImages.filter((img) => selectedIds.includes(img.id));
    if (selectedItems.length === 0) return;

    try {
      if (selectedItems.length === 1) {
        await saveSingleImage(selectedItems[0]);
        return;
      }

      // Pick folder for multiple images
      const selectedDir = await open({
        directory: true,
        multiple: false,
      });

      if (!selectedDir || typeof selectedDir !== "string") return;

      setExporting(true);
      const stem = fileName.replace(/\.pdf$/i, "");
      const baseDir = selectedDir.replace(/[\\/]+$/, "");

      for (let i = 0; i < selectedItems.length; i++) {
        const item = selectedItems[i];
        const pageStr = item.pages.join("-");
        const safeStem = sanitizeFileName(stem);
        const fileName = `${safeStem}_hal${pageStr}_img${i + 1}.png`;
        const filePath = `${baseDir}\\${fileName}`;
        const bytes = dataUrlToBytes(item.dataUrl);
        await invoke("save_reader_file", { data: bytes, outputPath: filePath });
      }

      showToast(
        "success",
        t("extractImages.extractSuccess")
          .replace("{count}", String(selectedItems.length))
          .replace("{path}", baseDir)
      );

      if (openExplorer) {
        invoke("show_in_folder", { path: `${baseDir}\\${sanitizeFileName(stem)}_hal${selectedItems[0].pages.join("-")}_img1.png` }).catch(() => {
          invoke("show_in_folder", { path: baseDir }).catch(console.error);
        });
      }
    } catch (e: any) {
      showToast("error", `Gagal mengekstrak gambar: ${e}`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <motion.div
      className="extract-images-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div className="extract-header">
        <div>
          <h1>{t("extractImages.title")}</h1>
          <p className="sub-title">{t("extractImages.desc")}</p>
        </div>
      </div>

      <div className="extract-card">
        {/* Drop zone or active file bar */}
        {!filePath ? (
          <div
            className={`drop-zone ${isHovering ? "is-hovering" : ""}`}
            onClick={openPdfDialog}
          >
            <div className="file-icon">📸</div>
            <h3>{t("extractImages.dropText")}</h3>
            <p>{t("extractImages.dropSub")}</p>
            <button
              type="button"
              className="btn-change"
              style={{ marginTop: 14 }}
              onClick={(e) => {
                e.stopPropagation();
                openPdfDialog();
              }}
            >
              {t("extractImages.btnSelect")}
            </button>
          </div>
        ) : (
          <div className="extract-file-bar">
            <div className="extract-file-info">
              <span className="extract-file-icon">📄</span>
              <div className="extract-file-details">
                <span className="extract-file-name" title={filePath}>
                  {fileName}
                </span>
                <span className="extract-file-meta">
                  {pageCount > 0 ? `${pageCount} ${t("word.pages")}` : ""}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="btn-change"
              onClick={openPdfDialog}
              disabled={scanning || exporting}
            >
              {t("extractImages.changeFile")}
            </button>
          </div>
        )}

        {/* Scanning State */}
        {scanning && (
          <div className="extract-scan-progress">
            <span style={{ fontSize: 24 }}>🔍</span>
            <p style={{ margin: 0, fontWeight: 500, color: "var(--text-primary)" }}>
              {scanProgress
                ? t("extractImages.scanningPage")
                    .replace("{current}", String(scanProgress.current))
                    .replace("{total}", String(scanProgress.total))
                : t("extractImages.scanning")}
            </p>
            {scanProgress && (
              <div className="extract-progress-bar-bg">
                <div
                  className="extract-progress-bar-fill"
                  style={{
                    width: `${Math.round((scanProgress.current / scanProgress.total) * 100)}%`,
                  }}
                />
              </div>
            )}
          </div>
        )}

        {/* Extracted Images Gallery */}
        {!scanning && filePath && extractedImages.length > 0 && (
          <>
            <div className="extract-toolbar">
              <div className="extract-toolbar-left">
                <span className="extract-badge">
                  {t("extractImages.foundCount").replace("{count}", String(extractedImages.length))}
                </span>
                <label className="extract-select-all">
                  <input
                    type="checkbox"
                    checked={
                      selectedIds.length > 0 && selectedIds.length === extractedImages.length
                    }
                    onChange={handleSelectAll}
                    style={{ accentColor: "var(--accent)" }}
                  />
                  <span>
                    {selectedIds.length === extractedImages.length
                      ? t("extractImages.deselectAll")
                      : t("extractImages.selectAll")}
                  </span>
                </label>
              </div>

              <div className="extract-toolbar-right">
                <button
                  type="button"
                  className="btn-extract-action"
                  onClick={handleBatchExtract}
                  disabled={exporting || selectedIds.length === 0}
                >
                  {exporting ? (
                    <>
                      <span>⏳</span>
                      {t("extractImages.processing")}
                    </>
                  ) : (
                    <>
                      <span>💾</span>
                      {t("extractImages.extractSelected").replace(
                        "{count}",
                        String(selectedIds.length)
                      )}
                    </>
                  )}
                </button>
              </div>
            </div>

            <motion.div
              className="extract-grid"
              initial="hidden"
              animate="visible"
              variants={{
                hidden: { opacity: 0 },
                visible: { opacity: 1, transition: { staggerChildren: 0.02 } },
              }}
            >
              {extractedImages.map((img) => {
                const isSelected = selectedIds.includes(img.id);
                return (
                  <motion.div
                    key={img.id}
                    className={`extract-card-item ${isSelected ? "selected" : ""}`}
                    variants={{
                      hidden: { opacity: 0, scale: 0.94 },
                      visible: { opacity: 1, scale: 1 },
                    }}
                  >
                    <div className="extract-card-topbar">
                      <label
                        className="extract-check-label"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(img.id)}
                          style={{ accentColor: "var(--accent)" }}
                        />
                      </label>
                      <span className="extract-page-badge">
                        {t("extractImages.page")} {img.pages.join(", ")}
                      </span>
                    </div>

                    <div
                      className="extract-thumb-wrap"
                      onClick={() => toggleSelect(img.id)}
                    >
                      <img
                        src={img.dataUrl}
                        alt={img.name}
                        className="extract-thumb-img"
                        loading="lazy"
                      />
                      <div className="extract-thumb-overlay">
                        <button
                          type="button"
                          className="extract-zoom-btn"
                          title={t("extractImages.preview")}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewImage(img);
                          }}
                        >
                          🔍
                        </button>
                      </div>
                    </div>

                    <div className="extract-card-info">
                      <span className="extract-dim-text">
                        {img.width} × {img.height} px
                      </span>
                      <button
                        type="button"
                        className="extract-btn-save"
                        title={t("extractImages.saveSingle")}
                        onClick={(e) => {
                          e.stopPropagation();
                          saveSingleImage(img);
                        }}
                        disabled={exporting}
                      >
                        💾 {t("extractImages.saveSingle")}
                      </button>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </>
        )}

        {/* Empty state when scanned but 0 images */}
        {!scanning && filePath && extractedImages.length === 0 && (
          <div className="extract-empty-state">
            <span className="extract-empty-icon">🖼️</span>
            <h3>{t("extractImages.noImages")}</h3>
          </div>
        )}
      </div>

      {/* Lightbox Modal Preview */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            className="extract-lightbox-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewImage(null)}
          >
            <motion.div
              className="extract-lightbox-content"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="extract-lightbox-header">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h3 style={{ margin: 0, fontSize: 16 }}>
                    {previewImage.name} (
                    {t("extractImages.page")} {previewImage.pages.join(", ")})
                  </h3>
                  <span className="extract-badge">
                    {previewImage.width} × {previewImage.height} px
                  </span>
                </div>
                <button
                  type="button"
                  style={{
                    background: "none",
                    border: "none",
                    fontSize: 22,
                    cursor: "pointer",
                    color: "var(--text-primary)",
                  }}
                  onClick={() => setPreviewImage(null)}
                >
                  ×
                </button>
              </div>

              <div className="extract-lightbox-body">
                <img
                  src={previewImage.dataUrl}
                  alt={previewImage.name}
                  className="extract-lightbox-img"
                />
              </div>

              <div className="extract-lightbox-footer">
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  PNG • {previewImage.width} × {previewImage.height} px
                </span>
                <div style={{ display: "flex", gap: 10 }}>
                  <button
                    type="button"
                    className="btn-change"
                    onClick={() => setPreviewImage(null)}
                  >
                    {t("extractImages.close")}
                  </button>
                  <button
                    type="button"
                    className="btn-extract-action"
                    onClick={() => saveSingleImage(previewImage)}
                  >
                    💾 {t("extractImages.saveSingle")}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
