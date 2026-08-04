import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import "./Layout.css";

export default function Layout() {
  const navigate = useNavigate();

  const navItems = [
    { to: "/maker/image", label: "Image → PDF", icon: "🖼" },
    { to: "/maker/merge", label: "Merge PDF", icon: "📑" },
    { to: "/maker/split", label: "Split PDF", icon: "✂" },
    { to: "/converter/pdf-to-word", label: "PDF → Word", icon: "📝" },
    { to: "/viewer", label: "PDF Viewer", icon: "🔍" },
  ];

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <motion.div
          className="sidebar-brand"
          onClick={() => navigate("/")}
          whileHover={{ backgroundColor: "var(--sidebar-hover)" }}
          whileTap={{ scale: 0.98 }}
        >
          <span className="brand-icon">📄</span>
          <span className="brand-text">PDF Utils</span>
        </motion.div>

        <nav className="sidebar-nav">
          <div className="nav-label">Tools</div>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-text">{item.label}</span>
            </NavLink>
          ))}
          
          <div style={{ marginTop: "auto" }}>
            <NavLink
              to="/settings"
              className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
            >
              <span className="nav-icon">⚙️</span>
              <span className="nav-text">Pengaturan</span>
            </NavLink>
          </div>
        </nav>

        <div className="sidebar-footer">
          <span className="footer-version">v1.0</span>
        </div>
      </aside>

      <motion.main
        className="main-content"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <Outlet />
      </motion.main>
    </div>
  );
}
