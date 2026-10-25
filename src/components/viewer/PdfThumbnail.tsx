import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

export default function PdfThumbnail({
  document: pdf,
  page,
  rotation,
}: {
  document: PDFDocumentProxy;
  page: number;
  rotation: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { root: element.closest(".viewer-thumbnails"), rootMargin: "200px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    let render: RenderTask | undefined;
    void (async () => {
      const source = await pdf.getPage(page);
      if (disposed || !canvas.current) return;
      const size = source.getViewport({
        scale: 1,
        rotation: (source.rotate + rotation) % 360,
      });
      const dpr = window.devicePixelRatio || 1;
      const targetWidth = 140;
      const viewport = source.getViewport({
        scale: (targetWidth / size.width) * dpr,
        rotation: size.rotation,
      });
      canvas.current.width = Math.ceil(viewport.width);
      canvas.current.height = Math.ceil(viewport.height);
      render = source.render({ canvas: canvas.current, viewport });
      await render.promise;
    })().catch(() => {
      /* A failed thumbnail does not prevent reading the page. */
    });
    return () => {
      disposed = true;
      render?.cancel();
    };
  }, [visible, pdf, page, rotation]);
  return <canvas ref={canvas} aria-hidden="true" />;
}
