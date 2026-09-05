import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { motion, Reorder, AnimatePresence } from "framer-motion";
import { useToast } from "../components/Toast";
import { useFileDrop } from "../hooks/useFileDrop";
import { useSettings } from "../contexts/SettingsContext";
import { useToolState } from "../contexts/ToolStateContext";
import "../styles/Converter.css";

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function MergePdf() {
  const { mergePdfFiles: pdfs, setMergePdfFiles: setPdfs } = useToolState();
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();
  const { t, openExplorer } = useSettings();

  const handleFileDrop = useCallback(async (paths: string[]) => {
    if (paths.length > 0) {
      const newItems = await Promise.all(
        paths.map(async (p) => {
          const name = p.split("\\").pop() || p.split("/").pop() || p;
          const data: number[] = await invoke("read_pdf_bytes", { path: p });
          return { path: p, name, size: formatBytes(data.length) };
        })
      );
      setPdfs((prev) => [...prev, ...newItems]);
    }
  }, []);

  const handleReject = useCallback(() => {
    showToast("error", t("mergePdf.errFormat"));
  }, [showToast, t]);

  const { isHovering } = useFileDrop(handleFileDrop, ["pdf"], handleReject);

  async function addPdfs() {
    const files = await open({
      multiple: true,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!files) return;

    const paths = Array.isArray(files) ? files : [files];
    const allowed = ["pdf"];
    const validPaths = paths.filter(p => {
      const ext = p.split('.').pop()?.toLowerCase() || '';
      return allowed.includes(ext);
    });

    if (validPaths.length !== paths.length) {
      handleReject();
    }
    
    if (validPaths.length === 0) return;

    const newItems = await Promise.all(
      validPaths.map(async (p) => {
        const name = p.split("\\").pop() || p.split("/").pop() || p;
        const data: number[] = await invoke("read_pdf_bytes", { path: p });
        return { path: p, name, size: formatBytes(data.length) };
      })
    );
    setPdfs((prev) => [...prev, ...newItems]);
  }

  function removePdf(index: number) {
    setPdfs((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleMerge() {
    if (pdfs.length < 2) {
      showToast("error", "Minimal 2 file PDF untuk digabung.");
      return;
    }
    const savePath = await save({
      filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      defaultPath: "merged.pdf",
    });
    if (!savePath) return;

    setLoading(true);
    try {
      const paths = pdfs.map((p) => p.path);
      await invoke("merge_pdfs", { inputPaths: paths, outputPath: savePath });
      showToast("success", `PDF berhasil digabung ke: ${savePath}`);
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
          <h1>{t("mergePdf.title")}</h1>
          <p className="sub-title">{t("mergePdf.desc")}</p>
        </div>
      </div>

      <div className="converter-card" style={{ position: "relative", pointerEvents: loading ? "none" : "auto", opacity: loading ? 0.7 : 1 }}>
        {isHovering && !loading && (
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: "rgba(99, 102, 241, 0.9)", zIndex: 10,
            display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
            borderRadius: "var(--radius)", color: "white"
          }}>
            <div className="file-icon" style={{ fontSize: "48px", marginBottom: "16px" }}>📑</div>
            <h3 style={{ fontSize: "18px", fontWeight: "bold" }}>{t("mergePdf.dropText")}</h3>
            <p>{t("mergePdf.dropSub")}</p>
          </div>
        )}

        <div className="drop-zone" onClick={addPdfs} style={{ margin: "0 0 20px 0" }}>
          <div className="file-icon">📑</div>
          <h3>{t("mergePdf.dropText")}</h3>
          <p>{t("mergePdf.dropSub")}</p>
        </div>

        {pdfs.length > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <span style={{ fontSize: "13px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {pdfs.length} File terpilih
            </span>
            <button className="btn-secondary" onClick={() => setPdfs([])} disabled={loading} style={{ color: "var(--danger)", borderColor: "transparent", background: "rgba(244, 63, 94, 0.1)", padding: "6px 12px", fontSize: "12px" }}>
              🗑 {t("mergePdf.btnClear")}
            </button>
          </div>
        )}

        {pdfs.length > 0 && (
          <div className="file-scroll-container">
            <Reorder.Group axis="y" values={pdfs} onReorder={setPdfs} className="file-list">
              <AnimatePresence>
                {pdfs.map((pdf, i) => (
                <Reorder.Item key={pdf.path + pdf.name} value={pdf} className="file-item">
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", width: "100%" }}>
                    <div style={{ width: "32px", height: "32px", background: "var(--bg-elevated)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>
                      📄
                    </div>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px", minWidth: 0 }}>
                      <span className="file-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{pdf.name}</span>
                      <span className="file-size" style={{ fontSize: "12px", color: "var(--text-muted)" }}>{pdf.size}</span>
                    </div>
                    <div className="file-actions" style={{ display: "flex", gap: "4px" }}>
                      <button
                        onClick={() => {
                          const arr = [...pdfs];
                          [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                          setPdfs(arr);
                        }}
                        disabled={i === 0 || loading}
                        style={{ border: "none", background: "none", cursor: i === 0 ? "not-allowed" : "pointer", opacity: i === 0 ? 0.3 : 1, color: "var(--text-primary)" }}
                      >
                        ▲
                      </button>
                      <button
                        onClick={() => {
                          const arr = [...pdfs];
                          [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
                          setPdfs(arr);
                        }}
                        disabled={i === pdfs.length - 1 || loading}
                        style={{ border: "none", background: "none", cursor: i === pdfs.length - 1 ? "not-allowed" : "pointer", opacity: i === pdfs.length - 1 ? 0.3 : 1, color: "var(--text-primary)" }}
                      >
                        ▼
                      </button>
                      <button className="btn-remove" onClick={() => removePdf(i)} disabled={loading} style={{ background: "none", border: "none", cursor: "pointer", marginLeft: "8px" }}>
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
          onClick={handleMerge}
          disabled={pdfs.length < 2 || loading}
        >
          {loading ? (
            <>
              <span className="spinner-inline">⏳</span>
              {t("mergePdf.processing")}
            </>
          ) : (
            t("mergePdf.btnExport")
          )}
        </button>
      </div>
    </motion.div>
  );
}
