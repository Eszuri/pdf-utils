import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import { useToast } from "../components/Toast";
import { useFileDrop } from "../hooks/useFileDrop";
import "../styles/Converter.css";

export default function PdfToDocx() {
  const [filePath, setFilePath] = useState("");
  const [fileName, setFileName] = useState("");
  const [converting, setConverting] = useState(false);
  const { showToast } = useToast();

  const handleFileDrop = useCallback((paths: string[]) => {
    if (paths.length > 0) {
      const p = paths[0];
      const name = p.split("\\").pop() || p.split("/").pop() || p;
      setFilePath(p);
      setFileName(name);
    }
  }, []);

  const { isHovering } = useFileDrop(handleFileDrop, ["pdf"]);

  async function handleSelectPdf() {
    try {
      const selected = await open({
        filters: [{ name: "PDF Document", extensions: ["pdf"] }],
      });
      if (!selected) return;
      const p = Array.isArray(selected) ? selected[0] : selected;
      const name = p.split("\\").pop() || p.split("/").pop() || p;
      setFilePath(p);
      setFileName(name);
    } catch (err: any) {
      showToast("error", `Gagal memilih file: ${err.message || err}`);
    }
  }

  async function handleConvert() {
    if (!filePath) {
      showToast("error", "Pilih file PDF terlebih dahulu");
      return;
    }

    try {
      const defaultName = fileName.replace(/\.pdf$/i, ".docx");
      const outputPath = await save({
        defaultPath: defaultName,
        filters: [{ name: "Word Document", extensions: ["docx"] }],
      });
      if (!outputPath) return;

      setConverting(true);

      await invoke("pdf_to_docx", {
        inputPath: filePath,
        outputPath: outputPath,
      });

      showToast("success", "Dokumen Word (.docx) berhasil disimpan!");
    } catch (err: any) {
      showToast("error", `Gagal mengonversi: ${err.message || err}`);
    } finally {
      setConverting(false);
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
          <h1>PDF → Word</h1>
          <p className="sub-title">Konversi dokumen PDF ke Word (.docx) dengan kualitas tinggi</p>
        </div>
      </div>

      <div className="converter-card">
        <div
          className={`drop-zone ${filePath ? "has-file" : ""} ${isHovering ? "is-hovering" : ""}`}
          onClick={handleSelectPdf}
        >
          {filePath ? (
            <>
              <div className="file-icon">📄</div>
              <h3 className="file-name">{fileName}</h3>
              <p className="file-path">{filePath}</p>
              <button className="btn-change">Ganti File</button>
            </>
          ) : (
            <>
              <div className="file-icon">📂</div>
              <h3>Pilih atau Drop File PDF</h3>
              <p>Klik atau seret dokumen PDF ke area ini</p>
            </>
          )}
        </div>

        <button
          className="btn-convert"
          onClick={handleConvert}
          disabled={!filePath || converting}
        >
          {converting ? (
            <>
              <span className="spinner-inline">⏳</span>
              Mengonversi...
            </>
          ) : (
            "Konversi ke Word (.docx)"
          )}
        </button>

        <p className="engine-note">
          Menggunakan pdf2docx engine untuk hasil konversi berkualitas tinggi
        </p>
      </div>
    </motion.div>
  );
}

