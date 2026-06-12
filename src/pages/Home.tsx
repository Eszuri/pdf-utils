import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import "./Home.css";

const tools = [
  { path: "/maker/image", icon: "🖼", title: "Image → PDF", desc: "Konversi gambar ke PDF", color: "#f43f5e" },
  { path: "/maker/merge", icon: "📑", title: "Merge PDF", desc: "Gabung beberapa PDF", color: "#6366f1" },
  { path: "/maker/split", icon: "✂", title: "Split PDF", desc: "Ekstrak halaman PDF", color: "#22c55e" },
  { path: "/viewer", icon: "🔍", title: "PDF Viewer", desc: "Lihat dan cari PDF", color: "#f59e0b" },
];

const container = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

const card = {
  hidden: { opacity: 0, y: 16, scale: 0.96 },
  visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.25 } },
};

export default function Home() {
  const navigate = useNavigate();

  return (
    <motion.div
      className="home"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div className="home-header">
        <motion.h1 initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 }}>
          PDF Utils
        </motion.h1>
        <motion.p className="home-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.06 }}>
          Alat PDF sederhana untuk kebutuhan sehari-hari
        </motion.p>
      </div>

      <motion.div className="tool-grid" variants={container} initial="hidden" animate="visible">
        {tools.map((t) => (
          <motion.div
            key={t.path}
            className="tool-card"
            variants={card}
            whileHover={{ y: -3, borderColor: "var(--border-hover)" }}
            whileTap={{ scale: 0.98 }}
            onClick={() => navigate(t.path)}
          >
            <div className="tool-icon" style={{ background: `${t.color}16`, color: t.color }}>
              {t.icon}
            </div>
            <div className="tool-info">
              <h3>{t.title}</h3>
              <p>{t.desc}</p>
            </div>
            <span className="tool-arrow">→</span>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
