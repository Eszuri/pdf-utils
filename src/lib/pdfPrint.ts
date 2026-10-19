import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { AnnotationMode } from "pdfjs-dist";

export function parsePageRange(value: string, total: number): number[] {
  const pages = new Set<number>();
  if (!value.trim()) throw new Error("EMPTY_RANGE");
  for (const part of value.split(",")) {
    const match = /^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);
    if (!match) throw new Error("INVALID_RANGE");
    const start = Number(match[1]),
      end = Number(match[2] || match[1]);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 1 ||
      end < start ||
      end > total
    )
      throw new Error("INVALID_RANGE");
    for (let page = start; page <= end; page++) pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}

/** Print rendered pages, never an embedded PDF or the scrolling screen canvas. */
export async function preparePdfPrint(
  pdf: PDFDocumentProxy,
  pages: number[],
  rotation: number,
  signal: AbortSignal,
  onProgress: (page: number, total: number) => void,
  layers: { id: string; visible: boolean }[] = [],
): Promise<() => void> {
  const root = document.createElement("div");
  root.id = "pdf-print-container";
  const style = document.createElement("style");
  root.append(style);
  const urls: string[] = [];
  const cleanup = () => {
    root.remove();
    for (const url of urls) URL.revokeObjectURL(url);
    window.removeEventListener("afterprint", cleanup);
  };
  let render: RenderTask | null = null;
  const cancel = () => render?.cancel();
  signal.addEventListener("abort", cancel);
  try {
    document.body.append(root);
    const annotationStorage = pdf.annotationStorage.print;
    const optionalContent = await pdf.getOptionalContentConfig({
      intent: "print",
    });
    for (const layer of layers)
      optionalContent.setVisibility(layer.id, layer.visible);
    for (let index = 0; index < pages.length; index++) {
      signal.throwIfAborted();
      onProgress(index, pages.length);
      const page = await pdf.getPage(pages[index]);
      signal.throwIfAborted();
      const angle = (page.rotate + rotation) % 360;
      const size = page.getViewport({ scale: 1, rotation: angle });
      const viewport = page.getViewport({ scale: 150 / 72, rotation: angle });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      render = page.render({
        canvas,
        viewport,
        intent: "print",
        annotationMode: AnnotationMode.ENABLE_STORAGE,
        printAnnotationStorage: annotationStorage,
        optionalContentConfigPromise: Promise.resolve(optionalContent),
      });
      await render.promise;
      render = null;
      signal.throwIfAborted();
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) =>
          value ? resolve(value) : reject(new Error("PRINT_RENDER_FAILED")),
        ),
      );
      canvas.width = canvas.height = 0;
      signal.throwIfAborted();
      const url = URL.createObjectURL(blob);
      urls.push(url);
      const image = document.createElement("img");
      image.src = url;
      await image.decode();
      signal.throwIfAborted();
      const sheet = document.createElement("div");
      sheet.className = "pdf-print-sheet";
      sheet.style.width = `${size.width}pt`;
      sheet.style.height = `${size.height}pt`;
      sheet.style.page = `pdf-sheet-${index}`;
      style.textContent += `@page pdf-sheet-${index} { size: ${size.width}pt ${size.height}pt; margin: 0; }\n`;
      sheet.append(image);
      root.append(sheet);
    }
    onProgress(pages.length, pages.length);
    signal.throwIfAborted();
    window.addEventListener("afterprint", cleanup, { once: true });
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}
