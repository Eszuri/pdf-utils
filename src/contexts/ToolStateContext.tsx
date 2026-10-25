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

export interface ExtractedImageItem {
  id: string;
  name: string;
  pages: number[];
  width: number;
  height: number;
  dataUrl: string;
}

interface ToolStateContextType {
  // ImageToPdf
  imgToPdfImages: ImageItem[];
  setImgToPdfImages: React.Dispatch<React.SetStateAction<ImageItem[]>>;
  
  // MergePdf
  mergePdfFiles: PdfItem[];
  setMergePdfFiles: React.Dispatch<React.SetStateAction<PdfItem[]>>;
  
  // SplitPdf
  splitPdfFilePath: string;
  setSplitPdfFilePath: React.Dispatch<React.SetStateAction<string>>;
  splitPdfFileName: string;
  setSplitPdfFileName: React.Dispatch<React.SetStateAction<string>>;
  splitPdfPageCount: number;
  setSplitPdfPageCount: React.Dispatch<React.SetStateAction<number>>;
  splitPdfThumbs: { num: number; dataUrl: string }[];
  setSplitPdfThumbs: React.Dispatch<React.SetStateAction<{ num: number; dataUrl: string }[]>>;
  splitPdfSelectedPages: number[];
  setSplitPdfSelectedPages: React.Dispatch<React.SetStateAction<number[]>>;
  
  // Viewer
  viewerFilePath: string;
  setViewerFilePath: React.Dispatch<React.SetStateAction<string>>;

  // ExtractImages
  extractPdfFilePath: string;
  setExtractPdfFilePath: React.Dispatch<React.SetStateAction<string>>;
  extractPdfFileName: string;
  setExtractPdfFileName: React.Dispatch<React.SetStateAction<string>>;
  extractPdfPageCount: number;
  setExtractPdfPageCount: React.Dispatch<React.SetStateAction<number>>;
  extractedImages: ExtractedImageItem[];
  setExtractedImages: React.Dispatch<React.SetStateAction<ExtractedImageItem[]>>;
  extractSelectedIds: string[];
  setExtractSelectedIds: React.Dispatch<React.SetStateAction<string[]>>;
}

const ToolStateContext = createContext<ToolStateContextType | undefined>(undefined);

export function ToolStateProvider({ children }: { children: ReactNode }) {
  const [imgToPdfImages, setImgToPdfImages] = useState<ImageItem[]>([]);
  const [mergePdfFiles, setMergePdfFiles] = useState<PdfItem[]>([]);
  
  const [splitPdfFilePath, setSplitPdfFilePath] = useState("");
  const [splitPdfFileName, setSplitPdfFileName] = useState("");
  const [splitPdfPageCount, setSplitPdfPageCount] = useState(0);
  const [splitPdfThumbs, setSplitPdfThumbs] = useState<{ num: number; dataUrl: string }[]>([]);
  const [splitPdfSelectedPages, setSplitPdfSelectedPages] = useState<number[]>([]);
  
  const [viewerFilePath, setViewerFilePath] = useState("");

  const [extractPdfFilePath, setExtractPdfFilePath] = useState("");
  const [extractPdfFileName, setExtractPdfFileName] = useState("");
  const [extractPdfPageCount, setExtractPdfPageCount] = useState(0);
  const [extractedImages, setExtractedImages] = useState<ExtractedImageItem[]>([]);
  const [extractSelectedIds, setExtractSelectedIds] = useState<string[]>([]);

  return (
    <ToolStateContext.Provider
      value={{
        imgToPdfImages, setImgToPdfImages,
        mergePdfFiles, setMergePdfFiles,
        splitPdfFilePath, setSplitPdfFilePath,
        splitPdfFileName, setSplitPdfFileName,
        splitPdfPageCount, setSplitPdfPageCount,
        splitPdfThumbs, setSplitPdfThumbs,
        splitPdfSelectedPages, setSplitPdfSelectedPages,
        viewerFilePath, setViewerFilePath,
        extractPdfFilePath, setExtractPdfFilePath,
        extractPdfFileName, setExtractPdfFileName,
        extractPdfPageCount, setExtractPdfPageCount,
        extractedImages, setExtractedImages,
        extractSelectedIds, setExtractSelectedIds,
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
