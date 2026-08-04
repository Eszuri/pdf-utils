import { motion } from "framer-motion";
import "../styles/Converter.css";

export default function Settings() {
  return (
    <motion.div
      className="converter-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div className="page-header">
        <div>
          <h1>Pengaturan</h1>
          <p className="sub-title">Konfigurasi aplikasi PDF Utils</p>
        </div>
      </div>

      <div className="converter-card">
        <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>⚙️</div>
          <h3 style={{ marginBottom: "8px", color: "var(--text-primary)" }}>Belum ada pengaturan</h3>
          <p>Fitur pengaturan akan ditambahkan di pembaruan mendatang.</p>
        </div>
      </div>
    </motion.div>
  );
}
