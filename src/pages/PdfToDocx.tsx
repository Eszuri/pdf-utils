import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { motion, AnimatePresence } from "framer-motion";
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

interface EngineStatus {
  ready: boolean;
  engine_type: "standalone" | "python" | "python_missing_deps" | "none";
  message: string;
}

export default function PdfToDocx() {
  const { pdfToDocxFile: file, setPdfToDocxFile: setFile } = useToolState();
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [engineStatus, setEngineStatus] = useState<EngineStatus | null>(null);
  const { showToast } = useToast();
  const { t, openExplorer } = useSettings();

  const checkStatus = useCallback(async () => {
    try {
      const res: any = await invoke("get_converter_status");
      setEngineStatus(res);
    } catch (e) {
      console.error("Failed to check converter status", e);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  async function handleAutoInstall() {
    setInstalling(true);
    try {
      showToast("info", t("pdfToWord.installing"));
      await invoke("auto_setup_dependencies");
      showToast("success", "Dependensi berhasil dipasang!");
      await checkStatus();
    } catch (e: any) {
      showToast("error", `Gagal memasang otomatis: ${e}`);
    }
    setInstalling(false);
  }

  const handleFileDrop = useCallback(async (paths: string[]) => {
    if (paths.length > 0) {
      const p = paths[0];
      const name = p.split("\\").pop() || p.split("/").pop() || p;
      const data: number[] = await invoke("read_pdf_bytes", { path: p });
      setFile({ path: p, name, size: formatBytes(data.length) });
    }
  }, []);

  const handleReject = useCallback(() => {
    showToast("error", t("pdfToWord.errFormat"));
  }, [showToast, t]);

  const { isHovering } = useFileDrop(handleFileDrop, ["pdf"], handleReject);

  async function selectFile() {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) return;

    const p = Array.isArray(selected) ? selected[0] : selected;
    const ext = p.split('.').pop()?.toLowerCase();
    
    if (ext !== "pdf") {
      handleReject();
      return;
    }

    const name = p.split("\\").pop() || p.split("/").pop() || p;
    const data: number[] = await invoke("read_pdf_bytes", { path: p });
    setFile({ path: p, name, size: formatBytes(data.length) });
  }

  async function handleConvert() {
    if (!file) return;

    let defaultName = file.name.replace(/\.pdf$/i, ".docx");
    const savePath = await save({
      filters: [{ name: "Word Document", extensions: ["docx"] }],
      defaultPath: defaultName,
    });
    if (!savePath) return;

    setLoading(true);
    try {
      await invoke("pdf_to_docx", { inputPath: file.path, outputPath: savePath });
      showToast("success", `Berhasil dikonversi ke: ${savePath}`);
      if (openExplorer) {
        invoke("show_in_folder", { path: savePath }).catch(e => console.error(e));
      }
    } catch (e: any) {
      showToast("error", `Gagal mengonversi: ${e}`);
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
          <h1>{t("pdfToWord.title")}</h1>
          <p className="sub-title">{t("pdfToWord.desc")}</p>
        </div>
      </div>

      {engineStatus && (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          marginBottom: "16px",
          borderRadius: "var(--radius)",
          background: engineStatus.ready ? "rgba(16, 185, 129, 0.08)" : "rgba(245, 158, 11, 0.1)",
          border: `1px solid ${engineStatus.ready ? "rgba(16, 185, 129, 0.25)" : "rgba(245, 158, 11, 0.3)"}`,
          fontSize: "13px"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span>{engineStatus.ready ? "⚡" : "⚠️"}</span>
            <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>
              {engineStatus.engine_type === "standalone"
                ? t("pdfToWord.statusStandalone")
                : engineStatus.engine_type === "python"
                ? t("pdfToWord.statusPython")
                : t("pdfToWord.statusMissing")}
            </span>
          </div>

          {engineStatus.engine_type === "python_missing_deps" && (
            <button
              className="btn-secondary"
              onClick={handleAutoInstall}
              disabled={installing || loading}
              style={{
                padding: "4px 14px",
                fontSize: "12px",
                background: "var(--accent)",
                color: "white",
                border: "none",
                cursor: "pointer",
                borderRadius: "6px"
              }}
            >
              {installing ? "⏳ Memasang..." : t("pdfToWord.btnAutoInstall")}
            </button>
          )}
        </div>
      )}

      <div className="converter-card" style={{ position: "relative", pointerEvents: loading ? "none" : "auto", opacity: loading ? 0.7 : 1 }}>
        {isHovering && !loading && !file && (
          <div style={{
            position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: "rgba(59, 130, 246, 0.9)", zIndex: 10,
            display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
            borderRadius: "var(--radius)", color: "white"
          }}>
            <div className="file-icon" style={{ fontSize: "48px", marginBottom: "16px" }}>📝</div>
            <h3 style={{ fontSize: "18px", fontWeight: "bold" }}>{t("pdfToWord.dropText")}</h3>
            <p>{t("pdfToWord.dropSub")}</p>
          </div>
        )}

        <AnimatePresence mode="wait">
          {!file ? (
            <motion.div
              key="dropzone"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="drop-zone"
              onClick={selectFile}
              style={{ padding: "60px 20px", marginBottom: "0" }}
            >
              <div className="file-icon">📝</div>
              <h3>{t("pdfToWord.dropText")}</h3>
              <p>{t("pdfToWord.dropSub")}</p>
              <button className="btn-secondary" style={{ marginTop: "20px" }} onClick={(e) => { e.stopPropagation(); selectFile(); }}>
                {t("pdfToWord.btnSelect")}
              </button>
            </motion.div>
          ) : (
            <motion.div
              key="file-info"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              <div style={{ marginBottom: "32px" }}>
                <h4 style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{t("pdfToWord.fileSelected")}</h4>
                <div style={{ display: "flex", alignItems: "center", gap: "16px", padding: "16px", background: "var(--bg-elevated)", borderRadius: "var(--radius)", border: "1px solid var(--border-color)" }}>
                  <div style={{ width: "40px", height: "40px", background: "var(--accent-soft)", color: "var(--accent)", borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px" }}>
                    📄
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 500, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "2px" }}>{file.size}</div>
                  </div>
                  <button className="btn-secondary" onClick={() => setFile(null)} disabled={loading} style={{ color: "var(--danger)", borderColor: "transparent", background: "rgba(244, 63, 94, 0.1)" }}>
                    {t("pdfToWord.btnRemove")}
                  </button>
                </div>
              </div>

              <button
                className="btn-convert"
                onClick={handleConvert}
                disabled={loading}
                style={{ width: "100%", padding: "16px", fontSize: "15px" }}
              >
                {loading ? (
                  <>
                    <span className="spinner-inline">⏳</span>
                    {t("pdfToWord.processing")}
                  </>
                ) : (
                  t("pdfToWord.btnExport")
                )}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
