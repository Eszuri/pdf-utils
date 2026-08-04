import React, { createContext, useContext, useState, ReactNode } from "react";

export interface ImageItem {
  path: string;
  name: string;
  dataUrl: string;
}

export interface PdfItem {
  path: string;
  name: string;
  size: string;
}

interface ToolStateContextType {
  // ImageToPdf
  imgToPdfImages: ImageItem[];
  setImgToPdfImages: React.Dispatch<React.SetStateAction<ImageItem[]>>;
  
  // MergePdf
  mergePdfFiles: PdfItem[];
  setMergePdfFiles: React.Dispatch<React.SetStateAction<PdfItem[]>>;
  
  // SplitPdf
  splitPdfFile: PdfItem | null;
  setSplitPdfFile: React.Dispatch<React.SetStateAction<PdfItem | null>>;
  splitPdfPages: string;
  setSplitPdfPages: React.Dispatch<React.SetStateAction<string>>;
  
  // PdfToDocx
  pdfToDocxFile: PdfItem | null;
  setPdfToDocxFile: React.Dispatch<React.SetStateAction<PdfItem | null>>;
  
  // Viewer
  viewerFilePath: string;
  setViewerFilePath: React.Dispatch<React.SetStateAction<string>>;
}

const ToolStateContext = createContext<ToolStateContextType | undefined>(undefined);

export function ToolStateProvider({ children }: { children: ReactNode }) {
  const [imgToPdfImages, setImgToPdfImages] = useState<ImageItem[]>([]);
  const [mergePdfFiles, setMergePdfFiles] = useState<PdfItem[]>([]);
  
  const [splitPdfFile, setSplitPdfFile] = useState<PdfItem | null>(null);
  const [splitPdfPages, setSplitPdfPages] = useState("");
  
  const [pdfToDocxFile, setPdfToDocxFile] = useState<PdfItem | null>(null);
  
  const [viewerFilePath, setViewerFilePath] = useState("");

  return (
    <ToolStateContext.Provider
      value={{
        imgToPdfImages, setImgToPdfImages,
        mergePdfFiles, setMergePdfFiles,
        splitPdfFile, setSplitPdfFile,
        splitPdfPages, setSplitPdfPages,
        pdfToDocxFile, setPdfToDocxFile,
        viewerFilePath, setViewerFilePath,
      }}
    >
      {children}
    </ToolStateContext.Provider>
  );
}

export function useToolState() {
  const context = useContext(ToolStateContext);
  if (!context) {
    throw new Error("useToolState must be used within a ToolStateProvider");
  }
  return context;
}
