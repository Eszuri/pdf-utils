import { useEffect } from "react";
import { useLocation, useNavigate, Routes, Route } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { AnimatePresence } from "framer-motion";
import { useToolState } from "./contexts/ToolStateContext";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import ImageToPdf from "./pages/ImageToPdf";
import MergePdf from "./pages/MergePdf";
import SplitPdf from "./pages/SplitPdf";
import Viewer from "./pages/Viewer";
import Settings from "./pages/Settings";
import PdfToWord from "./pages/PdfToWord";
import "./App.css";

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setViewerFilePath } = useToolState();

  useEffect(() => {
    invoke<string | null>("get_launch_file")
      .then((filePath) => {
        if (filePath) {
          setViewerFilePath(filePath);
          navigate("/viewer");
        }
      })
      .catch(console.error);
  }, [navigate, setViewerFilePath]);

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="maker/image" element={<ImageToPdf />} />
          <Route path="maker/merge" element={<MergePdf />} />
          <Route path="maker/split" element={<SplitPdf />} />
          <Route path="viewer" element={<Viewer />} />
          <Route path="converter/pdf-to-word" element={<PdfToWord />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </AnimatePresence>
  );
}

export default App;
