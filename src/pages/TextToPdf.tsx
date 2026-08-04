import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import { useToast } from "../components/Toast";
import { useFileDrop } from "../hooks/useFileDrop";
import "./TextToPdf.css";
import "../styles/Converter.css";

export default function TextToPdf() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const { showToast } = useToast();

  const handleFileDrop = useCallback(async (paths: string[]) => {
    if (paths.length > 0) {
      try {
        const data: number[] = await invoke("read_pdf_bytes", { path: paths[0] });
        const decoded = new TextDecoder("utf-8").decode(new Uint8Array(data));
        setText(decoded);
        showToast("success", "Teks berhasil dimuat dari file");
      } catch (e) {
        showToast("error", "Gagal memuat teks dari file");
      }
    }
  }, [showToast]);

  const { isHovering } = useFileDrop(handleFileDrop, ["txt", "md", "csv"]);

  async function handleExport() {
    if (!text.trim()) return;

    const path = await save({
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      defaultPath: "document.pdf",
    });
    if (!path) return;

    setLoading(true);
    try {
      await invoke("text_to_pdf", { text, outputPath: path });
      showToast("success", `PDF berhasil dibuat: ${path}`);
    } catch (e) {
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
          <h1>Text → PDF</h1>
          <p className="sub-title">Konversi teks biasa menjadi dokumen PDF yang rapi</p>
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
            <div className="file-icon" style={{ fontSize: "48px", marginBottom: "16px" }}>📄</div>
            <h3 style={{ fontSize: "18px", fontWeight: "bold" }}>Drop file teks di sini</h3>
            <p>File .txt, .md, atau .csv</p>
          </div>
        )}

        <textarea
          className="text-input"
          placeholder="Tulis teks di sini atau drop file .txt..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={15}
          style={{
            width: "100%", padding: "16px", borderRadius: "8px",
            border: "1px solid var(--border-color)", background: "var(--bg-body)",
            color: "var(--text-primary)", fontSize: "14px", fontFamily: "inherit",
            resize: "vertical", minHeight: "200px"
          }}
        />

        <button
          className="btn-convert"
          onClick={handleExport}
          disabled={loading || !text.trim()}
        >
          {loading ? (
            <>
              <span className="spinner-inline">⏳</span>
              Memproses...
            </>
          ) : (
            "Export to PDF"
          )}
        </button>
      </div>
    </motion.div>
  );
}

