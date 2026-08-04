import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSettings, accentColors } from "../contexts/SettingsContext";
import "../styles/Converter.css";

export default function Settings() {
  const { language, setLanguage, accentColor, setAccentColor, t } = useSettings();
  const [activeTab, setActiveTab] = useState<"general" | "style">("general");

  return (
    <motion.div
      className="converter-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div className="page-header">
        <div>
          <h1>{t("nav.settings")}</h1>
          <p className="sub-title">{t("app.desc")}</p>
        </div>
      </div>

      <div className="converter-card" style={{ padding: "0" }}>
        <div style={{ display: "flex", borderBottom: "1px solid var(--border-color)", padding: "0 16px" }}>
          <button
            onClick={() => setActiveTab("general")}
            style={{
              padding: "16px 24px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "general" ? "2px solid var(--accent)" : "2px solid transparent",
              color: activeTab === "general" ? "var(--accent)" : "var(--text-secondary)",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s"
            }}
          >
            General
          </button>
          <button
            onClick={() => setActiveTab("style")}
            style={{
              padding: "16px 24px",
              background: "none",
              border: "none",
              borderBottom: activeTab === "style" ? "2px solid var(--accent)" : "2px solid transparent",
              color: activeTab === "style" ? "var(--accent)" : "var(--text-secondary)",
              fontSize: "14px",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s"
            }}
          >
            Style
          </button>
        </div>

        <div style={{ padding: "32px", minHeight: "300px" }}>
          <AnimatePresence mode="wait">
            {activeTab === "general" && (
              <motion.div
                key="general"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                style={{ display: "flex", flexDirection: "column", gap: "24px" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h3 style={{ fontSize: "15px", marginBottom: "4px", color: "var(--text-primary)" }}>Bahasa (Language)</h3>
                    <p style={{ fontSize: "13px", color: "var(--text-muted)" }}>Pilih bahasa antarmuka aplikasi.</p>
                  </div>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value as any)}
                    style={{
                      padding: "8px 12px",
                      borderRadius: "6px",
                      background: "var(--bg-input)",
                      border: "1px solid var(--border-color)",
                      color: "var(--text-primary)",
                      outline: "none",
                      cursor: "pointer"
                    }}
                  >
                    <option value="id">Bahasa Indonesia</option>
                    <option value="en">English</option>
                  </select>
                </div>
              </motion.div>
            )}

            {activeTab === "style" && (
              <motion.div
                key="style"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                style={{ display: "flex", flexDirection: "column", gap: "24px" }}
              >
                <div>
                  <h3 style={{ fontSize: "15px", marginBottom: "4px", color: "var(--text-primary)" }}>Warna Aksen (Accent Color)</h3>
                  <p style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "16px" }}>Pilih warna utama untuk antarmuka.</p>
                  
                  <div style={{ display: "flex", gap: "12px" }}>
                    {Object.entries(accentColors).map(([name, hex]) => (
                      <button
                        key={name}
                        onClick={() => setAccentColor(name)}
                        style={{
                          width: "36px",
                          height: "36px",
                          borderRadius: "50%",
                          background: hex,
                          border: accentColor === name ? "2px solid white" : "2px solid transparent",
                          outline: accentColor === name ? `2px solid ${hex}` : "none",
                          cursor: "pointer",
                          transition: "all 0.15s",
                          boxShadow: "var(--shadow-sm)"
                        }}
                        title={name}
                      />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}
