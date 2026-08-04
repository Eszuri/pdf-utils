import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useSettings } from "../contexts/SettingsContext";
import "./Home.css";

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
  const { t } = useSettings();

  const tools = [
    { path: "/maker/image", icon: "🖼", title: t("nav.imageToPdf"), desc: t("home.desc.image"), color: "#f43f5e" },
    { path: "/maker/merge", icon: "📑", title: t("nav.mergePdf"), desc: t("home.desc.merge"), color: "#6366f1" },
    { path: "/maker/split", icon: "✂", title: t("nav.splitPdf"), desc: t("home.desc.split"), color: "#22c55e" },
    { path: "/converter/pdf-to-word", icon: "📝", title: t("nav.pdfToWord"), desc: t("home.desc.word"), color: "#3b82f6" },
    { path: "/viewer", icon: "🔍", title: t("nav.viewer"), desc: t("home.desc.viewer"), color: "#f59e0b" },
  ];

  return (
    <motion.div
      className="home"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <div className="home-header">
        <motion.h1 initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 }}>
          {t("app.title")}
        </motion.h1>
        <motion.p className="home-sub" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.06 }}>
          {t("app.desc")}
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
