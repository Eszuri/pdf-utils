import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";

export async function extractReaderPages(
  pdf: PDFDocumentProxy,
  pages: number[],
  password?: string,
) {
  const includePages = pages.map((page) => page - 1);
  if (!pdf.annotationStorage.size)
    return pdf.extractPages([{ document: null, includePages }]);
  // PDF.js extraction handles new annotations, but does not apply edited form values.
  // Extract from a saved snapshot so both forms and annotations are retained.
  const snapshot = getDocument({ data: await pdf.saveDocument(), password });
  try {
    const saved = await snapshot.promise;
    return await saved.extractPages([{ document: null, includePages }]);
  } finally {
    await snapshot.destroy();
  }
}

export async function chooseReaderPath(filename: string, pdf = false) {
  const name =
    filename.split(/[\\/]/).pop() || (pdf ? "document.pdf" : "attachment");
  const output = await save({
    defaultPath: name,
    ...(pdf ? { filters: [{ name: "PDF", extensions: ["pdf"] }] } : {}),
  });
  if (!output) return null;
  return pdf && !/\.pdf$/i.test(output) ? `${output}.pdf` : output;
}

export async function writeReaderFile(data: Uint8Array, outputPath: string) {
  await invoke("save_reader_file", { data: Array.from(data), outputPath });
}

export async function saveReaderFile(
  data: Uint8Array,
  filename: string,
  pdf = false,
) {
  const outputPath = await chooseReaderPath(filename, pdf);
  if (!outputPath) return null;
  await writeReaderFile(data, outputPath);
  return outputPath;
}
