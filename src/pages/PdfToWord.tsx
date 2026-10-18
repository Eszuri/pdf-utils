import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import { useSettings } from "../contexts/SettingsContext";
import { useWord } from "../contexts/WordContext";
import { useFileDrop } from "../hooks/useFileDrop";
import { useToast } from "../components/Toast";
import "../styles/Converter.css";
import "./PdfToWord.css";

export default function PdfToWord() {
  const { t } = useSettings();
  const { showToast } = useToast();
  const word = useWord();
  const [ready, setReady] = useState<boolean | null>(null);
  const [selecting, setSelecting] = useState(false);
  const selection = useRef(0);
  const busy = word.status === "converting" || word.status === "cancelling";
  useEffect(() => {
    let mounted = true;
    invoke<{ ready: boolean }>("word_engine_status").then(s => { if (mounted) setReady(s.ready); })
      .catch(() => { if (mounted) setReady(false); });
    return () => { mounted = false; };
  }, []);
  const loadFile = useCallback(async (paths: string[]) => {
    if (busy || !paths.length) return;
    if (paths.length !== 1 || !/\.pdf$/i.test(paths[0])) {
      showToast("error", t("word.invalidFile")); return;
    }
    const token = ++selection.current;
    setSelecting(true);
    try {
      const info = await invoke<{ page_count: number }>("get_pdf_info", { inputPath: paths[0] });
      if (token === selection.current) word.setFile({ path: paths[0], name: paths[0].split(/[\\/]/).pop() || paths[0], pages: info.page_count });
    } catch (failure) { if (token === selection.current) showToast("error", `${t("word.openFailed")}: ${failure}`); }
    finally { if (token === selection.current) setSelecting(false); }
  }, [busy, word.setFile, showToast, t]);
  const reject = useCallback(() => showToast("error", t("word.invalidFile")), [showToast, t]);
  const { isHovering } = useFileDrop(loadFile, ["pdf"], reject);
  async function selectFile() {
    try {
      const selected = await open({ multiple: false, filters: [{ name: "PDF", extensions: ["pdf"] }] });
      if (selected) await loadFile(Array.isArray(selected) ? selected : [selected]);
    } catch (failure) { showToast("error", String(failure)); }
  }
  async function convert() {
    if (!word.file || busy) return;
    try {
      const output = await save({ defaultPath: word.file.name.replace(/\.pdf$/i, ".docx"), filters: [{ name: "Word", extensions: ["docx"] }] });
      if (output) await word.convert(/\.docx$/i.test(output) ? output : `${output}.docx`);
    } catch (failure) { showToast("error", String(failure)); }
  }
  const phase = word.progress?.phase;
  const percent = word.progress ? Math.min(99, Math.round(word.progress.page / Math.max(1, word.progress.total) * 95)) : 0;
  let error = word.error;
  if (error.includes("OCR_REQUIRED")) error = t("word.ocrRequired");
  else if (error.includes("PASSWORD_REQUIRED")) error = t("word.passwordRequired");
  else if (error.includes("ENGINE_MISSING")) error = t("word.engineMissing");
  return (
    <motion.div className="converter-page word-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <div className="page-header"><h1>{t("word.title")}</h1><p className="sub-title">{t("word.description")}</p></div>
      <div className="converter-card">
        <p className="word-help">{t("word.scope")}</p>
        {ready === false && <p className="word-message error" role="alert">{t("word.engineMissing")}</p>}
        <button type="button" className={`drop-zone word-drop ${isHovering ? "is-hovering" : ""}`} onClick={selectFile} disabled={busy || selecting}>
          <span className="file-icon">📝</span>
          <strong>{selecting ? t("word.reading") : word.file?.name || t("word.select")}</strong>
          <span>{word.file ? `${word.file.pages} ${t("word.pages")}` : t("word.drop")}</span>
        </button>
        {word.file && !busy && <button className="btn-secondary" onClick={() => word.setFile(null)}>{t("word.remove")}</button>}
        {busy && <div className="word-progress" role="status" aria-live="polite">
          <span>{word.status === "cancelling" ? t("word.cancelling") : phase === "validating" ? t("word.validating") : phase === "converting" ? t("word.converting") : t("word.starting")}</span>
          <progress max={100} value={percent} aria-label={t("word.converting")} />
          {word.progress && <small>{word.progress.page} / {word.progress.total} {t("word.pages")}</small>}
        </div>}
        {word.status === "done" && word.result && <div className="word-message success" role="status">
          <strong>{t("word.complete")}</strong>
          <span>{word.result.pages} {t("word.pages")} · {word.result.tables} {t("word.tables")} · {word.result.images} {t("word.images")}</span>
          <span className="word-output">{word.result.outputPath}</span>
          <button className="btn-secondary" onClick={() => invoke("show_in_folder", { path: word.result!.outputPath }).catch(e => showToast("error", String(e)))}>{t("word.openFolder")}</button>
          {word.result.warnings.length > 0 && <details><summary>{t("word.warnings")} ({word.result.warnings.length})</summary><ul>{word.result.warnings.map((w,i) => <li key={i}>{w}</li>)}</ul></details>}
        </div>}
        {error && <p className="word-message error" role="alert">{error}</p>}
        {word.status === "cancelled" && <p role="status">{t("word.cancelled")}</p>}
        <div className="word-actions">
          <button className="btn-convert" onClick={convert} disabled={!word.file || busy || selecting || ready !== true}>{t("word.convert")}</button>
          {busy && <button className="btn-secondary" onClick={() => void word.cancel()} disabled={word.status === "cancelling"}>{t("word.cancel")}</button>}
        </div>
      </div>
    </motion.div>
  );
}
