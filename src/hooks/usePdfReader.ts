import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  DownloadManager,
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import type { AnnotationEditorUIManager } from "pdfjs-dist/types/src/display/editor/tools";
import type { OptionalContentConfig } from "pdfjs-dist/types/src/display/optional_content_config";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { saveReaderFile } from "../lib/readerFiles";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export { pdfjs };
export interface OutlineItem {
  title: string;
  dest: string | unknown[] | null;
  url?: string | null;
  items: OutlineItem[];
}
export interface Attachment {
  name: string;
  data: Uint8Array;
}
export interface FindOptions {
  caseSensitive: boolean;
  entireWord: boolean;
  highlightAll: boolean;
}
interface Runtime {
  viewer: PDFViewer;
  bus: EventBus;
  find: PDFFindController;
  links: PDFLinkService;
  editor?: AnnotationEditorUIManager;
}
const assets = `${import.meta.env.BASE_URL}pdfjs/`;

export function usePdfReader(
  path: string,
  reloadKey: number,
  onError: (message: string) => void,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pagesRef = useRef<HTMLDivElement>(null);
  const runtime = useRef<Runtime | null>(null);
  const reportError = useRef(onError);
  reportError.current = onError;
  const [document, setDocument] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [loadedPath, setLoadedPath] = useState("");
  const [opening, setOpening] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [scaleValue, setScaleValue] = useState("page-width");
  const [rotation, setRotation] = useState(0);
  const [scrollMode, setScrollMode] = useState(0);
  const [spreadMode, setSpreadMode] = useState(0);
  const [matches, setMatches] = useState({
    current: 0,
    total: 0,
    pending: false,
  });
  const [matchingPages, setMatchingPages] = useState<
    { page: number; count: number }[]
  >([]);
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [layers, setLayers] = useState<
    { id: string; name: string; visible: boolean }[]
  >([]);
  const layerConfig = useRef<OptionalContentConfig | null>(null);
  const [metadata, setMetadata] = useState<Record<string, unknown>>({});
  const [fileSize, setFileSize] = useState(0);
  const [pageSize, setPageSize] = useState("");
  const [modified, setModified] = useState(false);
  const modifiedRef = useRef(false);
  const documentPassword = useRef<string | undefined>(undefined);
  const markModified = (value: boolean) => {
    modifiedRef.current = value;
    setModified(value);
  };
  const [canPrint, setCanPrint] = useState(true);
  const [canCopy, setCanCopy] = useState(true);
  const [editorReady, setEditorReady] = useState(false);
  const [editingMode, setEditingMode] = useState(0);
  const [password, setPassword] = useState<{
    reason: number;
    submit: (password: string) => void;
    cancel: () => void;
  } | null>(null);

  useEffect(() => {
    let disposed = false;
    let cancelledPassword = false;
    let task: pdfjs.PDFDocumentLoadingTask | undefined;
    let reader: Runtime | null = null;
    const abort = new AbortController();
    let resizeObserver: ResizeObserver | undefined;
    let resizeFrame = 0;
    setDocument(null);
    setLoadedPath("");
    setOpening(Boolean(path));
    setReady(false);
    setError("");
    setCurrentPage(1);
    setScaleValue("page-width");
    setRotation(0);
    setScrollMode(0);
    setSpreadMode(0);
    setMatches({ current: 0, total: 0, pending: false });
    setMatchingPages([]);
    setOutline([]);
    setAttachments([]);
    setLayers([]);
    setMetadata({});
    markModified(false);
    setCanPrint(true);
    setCanCopy(true);
    setEditorReady(false);
    setEditingMode(0);
    setPassword(null);
    setFileSize(0);
    setPageSize("");
    layerConfig.current = null;
    documentPassword.current = undefined;
    if (!path || !containerRef.current || !pagesRef.current) return;

    async function load() {
      try {
        const bytes = await invoke<number[]>("read_pdf_bytes", { path });
        if (disposed) return;
        setFileSize(bytes.length);
        const bus = new EventBus();
        const links = new PDFLinkService({ eventBus: bus });
        links.addLinkAttributes = (anchor, url) => {
          anchor.href = url;
          anchor.rel = "noopener noreferrer";
          anchor.onclick = (event) => {
            event.preventDefault();
            void openUrl(url).catch((error) =>
              reportError.current(String(error)),
            );
          };
        };
        const find = new PDFFindController({
          eventBus: bus,
          linkService: links,
        });
        class NativeDownloads extends DownloadManager {
          downloadData(data: Uint8Array, filename: string) {
            void saveReaderFile(data, filename, /\.pdf$/i.test(filename)).catch(
              (error) => reportError.current(String(error)),
            );
          }
          openOrDownloadData(data: Uint8Array, filename: string) {
            this.downloadData(data, filename);
            return false;
          }
        }
        const options = {
          container: containerRef.current!,
          viewer: pagesRef.current!,
          eventBus: bus,
          linkService: links,
          findController: find,
          downloadManager: new NativeDownloads(),
          imageResourcesPath: `${assets}images/`,
          enablePermissions: true,
          annotationEditorMode: pdfjs.AnnotationEditorType.NONE,
          annotationEditorHighlightColors:
            "yellow=#fff066,green=#82e6a6,blue=#90c6ff,pink=#f7a5cc",
          abortSignal: abort.signal,
        };
        const viewer = new PDFViewer(options);
        // The hosting app must reapply fit presets when panels or windows resize.
        resizeObserver = new ResizeObserver(() => {
          cancelAnimationFrame(resizeFrame);
          resizeFrame = requestAnimationFrame(() => {
            if (disposed || !viewer.pagesCount) return;
            const preset = viewer.currentScaleValue;
            if (["auto", "page-fit", "page-width"].includes(preset))
              viewer.currentScaleValue = preset;
            viewer.update();
          });
        });
        resizeObserver.observe(containerRef.current!);
        reader = { viewer, links, find, bus };
        runtime.current = reader;
        links.setViewer(viewer);
        const listen = <Event>(
          name: string,
          callback: (event: Event) => void,
        ) => bus.on(name, callback, { signal: abort.signal });
        listen("pagesinit", () => {
          if (disposed) return;
          viewer.currentScaleValue = "page-width";
          setReady(true);
          setOpening(false);
          requestAnimationFrame(() => {
            if (!disposed) viewer.update();
          });
        });
        listen("pagechanging", (event: { pageNumber: number }) => {
          if (!disposed) setCurrentPage(event.pageNumber);
        });
        listen(
          "scalechanging",
          (event: { scale: number; presetValue?: string }) => {
            if (!disposed) {
              setScale(event.scale);
              setScaleValue(event.presetValue || String(event.scale));
            }
          },
        );
        listen("rotationchanging", (event: { pagesRotation: number }) => {
          if (!disposed) setRotation(event.pagesRotation);
        });
        listen("scrollmodechanged", (event: { mode: number }) => {
          if (!disposed) setScrollMode(event.mode);
        });
        listen("spreadmodechanged", (event: { mode: number }) => {
          if (!disposed) setSpreadMode(event.mode);
        });
        const findUpdate = (event: {
          state?: number;
          matchesCount?: { current: number; total: number };
        }) => {
          if (disposed) return;
          setMatches((previous) => ({
            ...(event.matchesCount || previous),
            pending: event.state === 3,
          }));
          setMatchingPages(
            (find.pageMatches || []).flatMap(
              (items: number[], index: number) =>
                items?.length ? [{ page: index + 1, count: items.length }] : [],
            ),
          );
        };
        listen("updatefindmatchescount", findUpdate);
        listen("updatefindcontrolstate", findUpdate);
        listen(
          "annotationeditoruimanager",
          (event: { uiManager: AnnotationEditorUIManager }) => {
            if (!disposed && reader) {
              reader.editor = event.uiManager;
              setEditorReady(true);
            }
          },
        );
        listen("annotationeditormodechanged", (event: { mode: number }) => {
          if (!disposed) setEditingMode(event.mode);
        });
        task = pdfjs.getDocument({
          data: new Uint8Array(bytes),
          cMapUrl: `${assets}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assets}standard_fonts/`,
          wasmUrl: `${assets}wasm/`,
        });
        task.onPassword = (submit: (value: string) => void, reason: number) => {
          if (!disposed)
            setPassword({
              reason,
              submit: (value) => {
                documentPassword.current = value;
                submit(value);
              },
              cancel: () => {
                cancelledPassword = true;
                setPassword(null);
                void task?.destroy();
              },
            });
        };
        const pdf = await task.promise;
        if (disposed) return;
        setPassword(null);
        setDocument(pdf);
        setLoadedPath(path);
        Object.assign(pdf.annotationStorage, {
          onSetModified: () => {
            if (!disposed) markModified(true);
          },
          onResetModified: () => {
            if (!disposed) markModified(false);
          },
        });
        viewer.setDocument(pdf);
        links.setDocument(pdf);
        // Metadata, outline and attachment failures must not prevent reading.
        const extras = await Promise.allSettled([
          pdf.getMetadata(),
          pdf.getOutline(),
          pdf.getAttachments(),
          pdf.getPageLabels(),
          pdf.getPermissions(),
          pdf.getPage(1),
        ]);
        if (disposed) return;
        const [meta, outlineResult, files, labels, permissions, firstPage] =
          extras;
        if (meta.status === "fulfilled")
          setMetadata(meta.value.info as Record<string, unknown>);
        if (outlineResult.status === "fulfilled")
          setOutline(outlineResult.value || []);
        if (files.status === "fulfilled" && files.value) {
          const values = Object.values(files.value) as {
            filename: string;
            content: Uint8Array;
          }[];
          setAttachments(
            values.map((file) => ({ name: file.filename, data: file.content })),
          );
        }
        if (labels.status === "fulfilled" && labels.value)
          viewer.setPageLabels(labels.value);
        if (permissions.status === "fulfilled" && permissions.value) {
          setCanPrint(
            permissions.value.includes(pdfjs.PermissionFlag.PRINT) ||
              permissions.value.includes(
                pdfjs.PermissionFlag.PRINT_HIGH_QUALITY,
              ),
          );
          setCanCopy(permissions.value.includes(pdfjs.PermissionFlag.COPY));
        }
        if (firstPage.status === "fulfilled") {
          const size = firstPage.value.getViewport({ scale: 1 });
          setPageSize(
            `${Math.round((size.width * 25.4) / 72)} × ${Math.round((size.height * 25.4) / 72)} mm`,
          );
        }
        const config = await viewer.optionalContentConfigPromise;
        if (disposed || !config) return;
        layerConfig.current = config;
        setLayers(
          [...config].map(([id, group]) => ({
            id: String(id),
            name: String(group.name),
            visible: Boolean(group.visible),
          })),
        );
      } catch (error) {
        if (!disposed && !cancelledPassword) {
          setError(String(error));
          reportError.current(String(error));
        }
        if (!disposed) {
          setPassword(null);
          setOpening(false);
        }
      }
    }
    void load();
    return () => {
      disposed = true;
      setPassword(null);
      resizeObserver?.disconnect();
      cancelAnimationFrame(resizeFrame);
      if (reader) {
        reader.viewer.setDocument(null!);
        reader.links.setDocument(null);
        if (runtime.current === reader) runtime.current = null;
      }
      abort.abort();
      void task?.destroy().catch(() => {});
    };
  }, [path, reloadKey]);

  function goToPage(page: number) {
    if (
      runtime.current &&
      document &&
      Number.isInteger(page) &&
      page >= 1 &&
      page <= document.numPages
    ) {
      runtime.current.viewer.scrollPageIntoView({ pageNumber: page });
    }
  }
  function setZoom(value: string | number) {
    const viewer = runtime.current?.viewer;
    if (!viewer || !ready) return;
    if (typeof value === "number")
      viewer.currentScale = Math.min(5, Math.max(0.1, value));
    else viewer.currentScaleValue = value;
  }
  function find(
    query: string,
    options: FindOptions,
    previous = false,
    again = false,
  ) {
    runtime.current?.bus.dispatch("find", {
      source: null,
      type: again ? "again" : "",
      query,
      caseSensitive: options.caseSensitive,
      entireWord: options.entireWord,
      highlightAll: options.highlightAll,
      findPrevious: previous,
      matchDiacritics: false,
    });
  }
  function setTool(mode: number) {
    try {
      if (runtime.current?.editor)
        runtime.current.viewer.annotationEditorMode = { mode };
    } catch (error) {
      reportError.current(String(error));
    }
  }
  function changeLayer(id: string, visible: boolean) {
    const config = layerConfig.current;
    if (!config || !runtime.current) return;
    config.setVisibility(id, visible);
    runtime.current.viewer.optionalContentConfigPromise =
      Promise.resolve(config);
    setLayers(
      [...config].map(([key, group]) => ({
        id: String(key),
        name: String(group.name),
        visible: Boolean(group.visible),
      })),
    );
  }
  return {
    containerRef,
    pagesRef,
    runtime,
    document,
    loadedPath,
    opening,
    ready,
    error,
    currentPage,
    scale,
    scaleValue,
    rotation,
    scrollMode,
    spreadMode,
    matches,
    matchingPages,
    outline,
    attachments,
    layers,
    metadata,
    fileSize,
    pageSize,
    modified,
    markModified,
    hasChanges: () => modifiedRef.current,
    getDocumentPassword: () => documentPassword.current,
    canPrint,
    canCopy,
    editorReady,
    editingMode,
    password,
    goToPage,
    setZoom,
    find,
    setTool,
    changeLayer,
  };
}
