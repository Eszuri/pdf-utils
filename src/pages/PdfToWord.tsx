import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import { useSettings } from "../contexts/SettingsContext";
import { useWord } from "../contexts/WordContext";
import { useFileDrop } from "../hooks/useFileDrop";
import { useToast } from "../components/Toast";
import "../styles/Converter.css";

export default function PdfToWord() {
  const { t } = useSettings();
  const { showToast } = useToast();
  const word = useWord();
  const [selecting, setSelecting] = useState(false);
  const selection = useRef(0);
  const busy = word.status === "converting" || word.status === "cancelling";

  const loadFile = useCallback(
    async (paths: string[]) => {
      if (busy || !paths.length) return;
      if (paths.length !== 1 || !/\.pdf$/i.test(paths[0])) {
        showToast("error", t("word.invalidFile"));
        return;
      }
      const token = ++selection.current;
      setSelecting(true);
      try {
        const info = await invoke<{ page_count: number }>("get_pdf_info", {
          inputPath: paths[0],
        });
        if (token === selection.current) {
          word.setFile({
            path: paths[0],
            name: paths[0].split(/[\\/]/).pop() || paths[0],
            pages: info.page_count,
          });
        }
      } catch (failure) {
        if (token === selection.current) {
          showToast("error", `${t("word.openFailed")}: ${failure}`);
        }
      } finally {
        if (token === selection.current) setSelecting(false);
      }
    },
    [busy, word.setFile, showToast, t]
  );

  const reject = useCallback(
    () => showToast("error", t("word.invalidFile")),
    [showToast, t]
  );

  const { isHovering } = useFileDrop(loadFile, ["pdf"], reject);

  async function selectFile() {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (selected) {
        await loadFile(Array.isArray(selected) ? selected : [selected]);
      }
    } catch (failure) {
      showToast("error", String(failure));
    }
  }

  async function convert() {
    if (!word.file || busy) return;
    try {
      const output = await save({
        defaultPath: word.file.name.replace(/\.pdf$/i, ".docx"),
        filters: [{ name: "Word Document", extensions: ["docx"] }],
      });
      if (output) {
        await word.convert(/\.docx$/i.test(output) ? output : `${output}.docx`);
      }
    } catch (failure) {
      showToast("error", String(failure));
    }
  }

  useEffect(() => {
    if (word.status === "done" && word.result) {
      showToast("success", `PDF berhasil dikonversi ke: ${word.result.outputPath}`);
    }
  }, [word.status, word.result, showToast]);

  useEffect(() => {
    if (word.error) {
      let error = word.error;
      if (error.includes("OCR_REQUIRED")) error = t("word.ocrRequired");
      else if (error.includes("PASSWORD_REQUIRED")) error = t("word.passwordRequired");
      else if (error.includes("ENGINE_MISSING")) error = t("word.engineMissing");
      showToast("error", error);
    }
  }, [word.error, showToast, t]);

  return (
    <motion.div
      className="converter-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div className="page-header">
        <div>
          <h1>{t("word.title")}</h1>
          <p className="sub-title">{t("word.description")}</p>
        </div>
      </div>

      <div
        className="converter-card"
        style={{
          position: "relative",
          pointerEvents: busy ? "none" : "auto",
          opacity: busy ? 0.7 : 1,
        }}
      >
        {isHovering && !busy && (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(59, 130, 246, 0.9)",
              zIndex: 10,
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
              alignItems: "center",
              borderRadius: "var(--radius)",
              color: "white",
            }}
          >
            <div className="file-icon" style={{ fontSize: "48px", marginBottom: "16px" }}>
              📝
            </div>
            <h3 style={{ fontSize: "18px", fontWeight: "bold" }}>Drop PDF di sini</h3>
            <p>Hanya menerima file .pdf</p>
          </div>
        )}

        <div
          className={`drop-zone ${word.file ? "has-file" : ""} ${
            isHovering && !busy ? "is-hovering" : ""
          }`}
          onClick={selectFile}
          style={{ margin: "0 0 20px 0" }}
        >
          {selecting ? (
            <>
              <div className="file-icon">
                <span className="spinner-inline">⏳</span>
              </div>
              <h3>{t("word.reading")}</h3>
              <p>Mohon tunggu sebentar</p>
            </>
          ) : word.file ? (
            <>
              <div className="file-icon">📄</div>
              <h3 className="file-name">{word.file.name}</h3>
              <p className="file-path">
                {word.file.pages} {t("word.pages")}
              </p>
              <button
                className="btn-change"
                onClick={(e) => {
                  e.stopPropagation();
                  selectFile();
                }}
              >
                Ganti File
              </button>
            </>
          ) : (
            <>
              <div className="file-icon">📝</div>
              <h3>{t("word.select")}</h3>
              <p>{t("word.drop")}</p>
            </>
          )}
        </div>

        {word.file && (
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
            }}
          >
            <span
              style={{
                fontSize: "13px",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              1 File terpilih
            </span>
            <button
              className="btn-secondary"
              onClick={() => word.setFile(null)}
              disabled={busy}
              style={{
                color: "var(--danger)",
                borderColor: "transparent",
                background: "rgba(244, 63, 94, 0.1)",
                padding: "6px 12px",
                fontSize: "12px",
              }}
            >
              🗑 {t("word.remove")}
            </button>
          </div>
        )}

        <button
          className="btn-convert"
          onClick={convert}
          disabled={!word.file || busy || selecting}
        >
          {busy ? (
            <>
              <span className="spinner-inline">⏳</span>
              {t("word.converting")}
            </>
          ) : (
            t("word.convert")
          )}
        </button>
      </div>
    </motion.div>
  );
}
