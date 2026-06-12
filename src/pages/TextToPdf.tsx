import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { motion } from "framer-motion";
import "./TextToPdf.css";

export default function TextToPdf() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);

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
    } catch (e) {
      alert("Error: " + e);
    }
    setLoading(false);
  }

  return (
    <motion.div
      className="text-to-pdf"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ duration: 0.25 }}
    >
      <motion.h2
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.25, delay: 0.05 }}
      >
        Text → PDF
      </motion.h2>
      <motion.textarea
        className="text-input"
        placeholder="Tulis teks di sini..."
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={15}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, delay: 0.1 }}
        whileFocus={{ borderColor: "var(--accent)" }}
      />
      <motion.button
        className="btn-primary"
        onClick={handleExport}
        disabled={loading || !text.trim()}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
      >
        {loading ? "Processing..." : "Export to PDF"}
      </motion.button>
    </motion.div>
  );
}
