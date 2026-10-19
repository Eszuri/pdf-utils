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

interface LaunchAction {
  mode: string;
  file: string;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function mimeFromExt(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    default: return "application/octet-stream";
  }
}

function App() {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    setViewerFilePath,
    setSplitPdfFilePath,
    setSplitPdfThumbs,
    setSplitPdfSelectedPages,
    setMergePdfFiles,
    setImgToPdfImages,
  } = useToolState();

  useEffect(() => {
    invoke<LaunchAction | null>("get_launch_action")
      .then((action) => {
        if (!action) return;
        const { mode, file } = action;

        if (mode === "viewer") {
          setViewerFilePath(file);
          navigate("/viewer");
        } else if (mode === "split") {
          setSplitPdfFilePath(file);
          setSplitPdfThumbs([]);
          setSplitPdfSelectedPages([]);
          navigate("/maker/split");
        } else if (mode === "merge") {
          const name = file.split(/[\\/]/).pop() || file;
          invoke<number[]>("read_pdf_bytes", { path: file })
            .then((data) => {
              setMergePdfFiles((prev) => {
                if (prev.some((f) => f.path === file)) return prev;
                return [...prev, { path: file, name, size: formatBytes(data.length) }];
              });
            })
            .catch(console.error)
            .finally(() => {
              navigate("/maker/merge");
            });
        } else if (mode === "image") {
          const name = file.split(/[\\/]/).pop() || file;
          invoke<number[]>("read_pdf_bytes", { path: file })
            .then((data) => {
              const blob = new Blob([new Uint8Array(data)], { type: mimeFromExt(name) });
              const dataUrl = URL.createObjectURL(blob);
              setImgToPdfImages((prev) => {
                if (prev.some((f) => f.path === file)) return prev;
                return [...prev, { path: file, name, dataUrl }];
              });
            })
            .catch(console.error)
            .finally(() => {
              navigate("/maker/image");
            });
        }
      })
      .catch(console.error);
  }, [
    navigate,
    setViewerFilePath,
    setSplitPdfFilePath,
    setSplitPdfThumbs,
    setSplitPdfSelectedPages,
    setMergePdfFiles,
    setImgToPdfImages,
  ]);

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
