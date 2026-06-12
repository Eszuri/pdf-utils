import { useLocation } from "react-router-dom";
import { Routes, Route } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import ImageToPdf from "./pages/ImageToPdf";
import MergePdf from "./pages/MergePdf";
import SplitPdf from "./pages/SplitPdf";
import Viewer from "./pages/Viewer";
import "./App.css";

function App() {
  const location = useLocation();

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="maker/image" element={<ImageToPdf />} />
          <Route path="maker/merge" element={<MergePdf />} />
          <Route path="maker/split" element={<SplitPdf />} />
          <Route path="viewer" element={<Viewer />} />
        </Route>
      </Routes>
    </AnimatePresence>
  );
}

export default App;
