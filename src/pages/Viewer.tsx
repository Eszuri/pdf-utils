import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { open, save } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useToast } from "../components/Toast";
import { useSettings } from "../contexts/SettingsContext";
import { useToolState } from "../contexts/ToolStateContext";
import { useFileDrop } from "../hooks/useFileDrop";
import { pdfjs, usePdfReader, type OutlineItem } from "../hooks/usePdfReader";
import {
  chooseReaderPath,
  writeReaderFile,
  saveReaderFile,
  extractReaderPages,
} from "../lib/readerFiles";
import { parsePageRange, preparePdfPrint } from "../lib/pdfPrint";
import Icon from "../components/viewer/ViewerIcon";
import PdfThumbnail from "../components/viewer/PdfThumbnail";
import ReaderDialog from "../components/viewer/ReaderDialog";
import "pdfjs-dist/web/pdf_viewer.css";
import "./Viewer.css";

type Panel =
  | "pages"
  | "search"
  | "outline"
  | "bookmarks"
  | "attachments"
  | "layers"
  | null;
type Tool = "select" | "hand" | "highlight" | "ink" | "text";
type Pending = { paths: string[] } | { route: string };

export default function Viewer() {
  const { t, language } = useSettings();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { viewerFilePath: filePath, setViewerFilePath: setFilePath } =
    useToolState();
  const [reloadKey, setReloadKey] = useState(0);
  const reader = usePdfReader(filePath, reloadKey, (message) =>
    showToast("error", message),
  );
  const pdf = reader.document;
  const total = pdf?.numPages || 0;
  const fileName = filePath.split(/[\\/]/).pop() || t("viewer.untitled");
  const [panel, setPanel] = useState<Panel>(null);
  const [pageInput, setPageInput] = useState("1");
  const [query, setQuery] = useState("");
  const [findOptions, setFindOptions] = useState({
    caseSensitive: false,
    entireWord: false,
    highlightAll: true,
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [range, setRange] = useState("");
  const [bookmarks, setBookmarks] = useState<number[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState("#f5cc28");
  const [background, setBackground] = useState("dark");
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [properties, setProperties] = useState(false);
  const [passwordValue, setPasswordValue] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [fullscreen, setFullscreen] = useState(
    Boolean(document.fullscreenElement),
  );
  const [printOpen, setPrintOpen] = useState(false);
  const [printMode, setPrintMode] = useState("all");
  const [printRange, setPrintRange] = useState("");
  const [printProgress, setPrintProgress] = useState<{
    page: number;
    total: number;
  } | null>(null);
  const printAbort = useRef<AbortController | null>(null);
  const printCleanup = useRef<(() => void) | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const toolsRef = useRef<HTMLDetailsElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  const interactive = reader.ready && !!pdf;
  const editedTool = tool === "highlight" || tool === "ink" || tool === "text";
  const report = (error: unknown) => showToast("error", String(error));

  function applyFile(paths: string[]) {
    setFilePath(paths[0]);
    setReloadKey((key) => key + 1);
  }
  const selectFile = useCallback(
    (paths: string[]) => {
      if (saving || exporting || printProgress) return;
      if (paths.length !== 1 || !/\.pdf$/i.test(paths[0])) {
        showToast("error", t("viewer.errFormat"));
        return;
      }
      if (reader.hasChanges()) setPending({ paths });
      else applyFile(paths);
    },
    [
      saving,
      exporting,
      printProgress,
      reader.modified,
      setFilePath,
      showToast,
      t,
    ],
  );
  const rejectDrop = useCallback(
    () => showToast("error", t("viewer.errFormat")),
    [showToast, t],
  );
  const { isHovering } = useFileDrop(selectFile, ["pdf"], rejectDrop);
  async function openPdf() {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (path) selectFile(Array.isArray(path) ? path : [path]);
    } catch (error) {
      report(error);
    }
  }
  function routeTo(event: React.MouseEvent, route: string) {
    if (saving || exporting || printProgress) {
      event.preventDefault();
      return;
    }
    if (reader.hasChanges()) {
      event.preventDefault();
      setPending({ route });
    }
  }
  function continuePending() {
    if (!pending) return;
    if ("paths" in pending) applyFile(pending.paths);
    else navigate(pending.route);
    setPending(null);
  }

  useEffect(() => {
    setSelected(new Set());
    setQuery("");
    setRange("");
    setTool("select");
    setProperties(false);
    setPasswordValue("");
    printAbort.current?.abort();
    printCleanup.current?.();
    printCleanup.current = null;
    const key = pdf?.fingerprints[0];
    let saved: number[] = [];
    if (key) {
      try {
        const value: unknown = JSON.parse(
          localStorage.getItem(`reader-bookmarks:${key}`) || "[]",
        );
        if (Array.isArray(value))
          saved = [
            ...new Set(
              value.filter(
                (page) =>
                  Number.isInteger(page) && page > 0 && page <= pdf.numPages,
              ),
            ),
          ];
      } catch {
        /* An invalid local preference must not stop the reader. */
      }
    }
    setBookmarks(saved);
  }, [pdf]);
  useEffect(() => {
    setPageInput(String(reader.currentPage));
  }, [reader.currentPage]);
  useEffect(() => {
    if (panel === "search") searchRef.current?.focus();
  }, [panel]);
  useEffect(() => {
    if (!reader.ready) return;
    if (panel === "search") reader.find(query, findOptions);
    else reader.runtime.current?.bus.dispatch("findbarclose", { source: null });
  }, [query, findOptions, panel, reader.ready]);
  useEffect(() => {
    const sync = () => setFullscreen(Boolean(document.fullscreenElement));
    const closeTools = (event: PointerEvent) => {
      if (
        toolsRef.current &&
        event.target instanceof Node &&
        !toolsRef.current.contains(event.target)
      )
        toolsRef.current.open = false;
    };
    document.addEventListener("fullscreenchange", sync);
    window.addEventListener("pointerdown", closeTools);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      window.removeEventListener("pointerdown", closeTools);
    };
  }, []);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (reader.modified) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [reader.modified]);
  useEffect(
    () => () => {
      printAbort.current?.abort();
      printCleanup.current?.();
    },
    [],
  );

  function changeTool(value: Tool) {
    setTool(value);
    const mode =
      value === "highlight"
        ? pdfjs.AnnotationEditorType.HIGHLIGHT
        : value === "ink"
          ? pdfjs.AnnotationEditorType.INK
          : value === "text"
            ? pdfjs.AnnotationEditorType.FREETEXT
            : pdfjs.AnnotationEditorType.NONE;
    reader.setTool(mode);
    if (value === "highlight" || value === "ink" || value === "text") {
      const nextColor = value === "highlight" ? "#fff066" : "#202020";
      setColor(nextColor);
      const type =
        value === "highlight"
          ? pdfjs.AnnotationEditorParamsType.HIGHLIGHT_COLOR
          : value === "ink"
            ? pdfjs.AnnotationEditorParamsType.INK_COLOR
            : pdfjs.AnnotationEditorParamsType.FREETEXT_COLOR;
      reader.runtime.current?.bus.dispatch("switchannotationeditorparams", {
        source: null,
        type,
        value: nextColor,
      });
    }
  }
  function changeColor(value: string) {
    setColor(value);
    const type =
      tool === "highlight"
        ? pdfjs.AnnotationEditorParamsType.HIGHLIGHT_COLOR
        : tool === "ink"
          ? pdfjs.AnnotationEditorParamsType.INK_COLOR
          : pdfjs.AnnotationEditorParamsType.FREETEXT_COLOR;
    reader.runtime.current?.bus.dispatch("switchannotationeditorparams", {
      source: null,
      type,
      value,
    });
  }
  function commitPage() {
    const number = Number(pageInput);
    if (Number.isInteger(number) && number >= 1 && number <= total)
      reader.goToPage(number);
    else if (reader.runtime.current && interactive)
      reader.runtime.current.links.goToPage(pageInput);
    setPageInput(
      String(
        reader.runtime.current?.viewer.currentPageNumber || reader.currentPage,
      ),
    );
  }
  function zoomBy(direction: number) {
    reader.setZoom(reader.scale * (direction > 0 ? 1.2 : 1 / 1.2));
  }
  function rotate(direction = 90) {
    const viewer = reader.runtime.current?.viewer;
    if (viewer && interactive)
      viewer.pagesRotation = (viewer.pagesRotation + direction + 360) % 360;
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (error) {
      report(error);
    }
  }
  function toggleBookmark() {
    if (!pdf) return;
    const next = bookmarks.includes(reader.currentPage)
      ? bookmarks.filter((page) => page !== reader.currentPage)
      : [...bookmarks, reader.currentPage].sort((a, b) => a - b);
    setBookmarks(next);
    try {
      localStorage.setItem(
        `reader-bookmarks:${pdf.fingerprints[0]}`,
        JSON.stringify(next),
      );
    } catch {
      /* Session bookmarks still work when storage is unavailable. */
    }
  }
  async function saveDocument() {
    if (!pdf || saving || exporting || printProgress) return false;
    const modified = reader.hasChanges();
    setSaving(true);
    try {
      const path = await chooseReaderPath(fileName, true);
      if (!path) return false;
      reader.runtime.current?.editor?.commitOrRemove();
      const snapshotHash = pdf.annotationStorage.serializable.hash;
      const bytes = pdf.annotationStorage.size
        ? await pdf.saveDocument()
        : await pdf.getData();
      await writeReaderFile(bytes, path);
      reader.markModified(
        snapshotHash !== pdf.annotationStorage.serializable.hash,
      );
      showToast("success", `${t("viewer.saved")}: ${path}`);
      return true;
    } catch (error) {
      reader.markModified(modified || pdf.annotationStorage.size > 0);
      report(error);
      return false;
    } finally {
      setSaving(false);
    }
  }
  function togglePage(page: number) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(page)) next.delete(page);
      else next.add(page);
      return next;
    });
  }
  function applyRange() {
    try {
      setSelected(new Set(parsePageRange(range, total)));
    } catch {
      showToast("error", t("viewer.invalidRange"));
    }
  }
  async function exportPages() {
    if (
      !pdf ||
      !selected.size ||
      exporting ||
      saving ||
      printProgress ||
      reader.loadedPath !== filePath
    )
      return;
    const pages = [...selected].sort((a, b) => a - b);
    reader.runtime.current?.editor?.commitOrRemove();
    const wasModified = reader.hasChanges();
    setExporting(true);
    try {
      const path = await save({
        defaultPath: "selected-pages.pdf",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!path) return;
      const outputPath = /\.pdf$/i.test(path) ? path : `${path}.pdf`;
      const bytes = await extractReaderPages(
        pdf,
        pages,
        reader.getDocumentPassword(),
      );
      if (!bytes?.byteLength) throw new Error(t("viewer.exportFailed"));
      await writeReaderFile(bytes, outputPath);
      showToast("success", `${t("viewer.exportSuccess")}: ${outputPath}`);
    } catch (error) {
      report(error);
    } finally {
      reader.markModified(wasModified);
      setExporting(false);
    }
  }
  async function printDocument() {
    if (!pdf || !reader.canPrint || printProgress) return;
    let pages: number[];
    try {
      pages =
        printMode === "current"
          ? [reader.currentPage]
          : printMode === "selected"
            ? [...selected].sort((a, b) => a - b)
            : printMode === "custom"
              ? parsePageRange(printRange, total)
              : Array.from({ length: total }, (_, index) => index + 1);
      if (!pages.length) throw new Error("EMPTY_RANGE");
    } catch {
      showToast("error", t("viewer.invalidRange"));
      return;
    }
    const abort = new AbortController();
    printAbort.current = abort;
    printCleanup.current?.();
    printCleanup.current = null;
    setPrintOpen(false);
    setPrintProgress({ page: 0, total: pages.length });
    try {
      reader.runtime.current?.editor?.commitOrRemove();
      printCleanup.current = await preparePdfPrint(
        pdf,
        pages,
        reader.rotation,
        abort.signal,
        (page, total) => setPrintProgress({ page, total }),
        reader.layers,
      );
      abort.signal.throwIfAborted();
      setPrintProgress(null);
      window.print();
    } catch (error) {
      if (!abort.signal.aborted) report(error);
    } finally {
      if (printAbort.current === abort) printAbort.current = null;
      setPrintProgress(null);
    }
  }

  useEffect(() => {
    const element = reader.containerRef.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if (!(event.ctrlKey || event.metaKey) || !interactive) return;
      event.preventDefault();
      const scale = reader.runtime.current?.viewer.currentScale || 1;
      reader.setZoom(scale * Math.exp(-event.deltaY / 300));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, [interactive]);
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (document.querySelector("dialog[open]")) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void openPdf();
        return;
      }
      if (modifier && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setPanel("search");
        searchRef.current?.focus();
        return;
      }
      if (modifier && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveDocument();
        return;
      }
      if (modifier && event.key.toLowerCase() === "p") {
        event.preventDefault();
        if (interactive && reader.canPrint) setPrintOpen(true);
        return;
      }
      if (event.key === "Escape") {
        setPanel(null);
        if (toolsRef.current) toolsRef.current.open = false;
      }
      if (event.key === "F11") {
        event.preventDefault();
        void toggleFullscreen();
        return;
      }
      if (event.key === "F3" || (modifier && event.key.toLowerCase() === "g")) {
        event.preventDefault();
        setPanel("search");
        reader.find(query, findOptions, event.shiftKey, true);
        return;
      }
      if (
        event.target instanceof HTMLElement &&
        (event.target.closest(
          "input, textarea, select, [contenteditable=true]",
        ) ||
          event.target.isContentEditable)
      )
        return;
      if (!interactive || editedTool) return;
      if (modifier && ["+", "=", "-", "0"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "0") reader.setZoom("auto");
        else zoomBy(event.key === "-" ? -1 : 1);
        return;
      }
      if (event.key === "PageUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        reader.goToPage(reader.currentPage - 1);
      }
      if (event.key === "PageDown" || event.key === "ArrowRight") {
        event.preventDefault();
        reader.goToPage(reader.currentPage + 1);
      }
      if (event.key === "Home") {
        event.preventDefault();
        reader.goToPage(1);
      }
      if (event.key === "End") {
        event.preventDefault();
        reader.goToPage(total);
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  async function goToOutline(item: OutlineItem) {
    if (item.url) await openUrl(item.url);
    else if (item.dest)
      await reader.runtime.current?.links.goToDestination(item.dest);
  }
  function outlineNodes(items: OutlineItem[]) {
    return items.map((item, index) => (
      <li key={index}>
        {item.items?.length ? (
          <details open>
            <summary>{item.title}</summary>
            <button onClick={() => void goToOutline(item).catch(report)}>
              {t("viewer.goToSection")}
            </button>
            <ul>{outlineNodes(item.items)}</ul>
          </details>
        ) : (
          <button onClick={() => void goToOutline(item).catch(report)}>
            {item.title}
          </button>
        )}
      </li>
    ));
  }
  const panelOptions: Exclude<Panel, null>[] = [
    "pages",
    "outline",
    "bookmarks",
    "attachments",
    "layers",
    "search",
  ];
  const date = (value: unknown) => {
    const parsed =
      typeof value === "string"
        ? pdfjs.PDFDateString.toDateObject(value)
        : null;
    return parsed
      ? parsed.toLocaleString(language === "id" ? "id-ID" : "en-US")
      : "—";
  };

  return (
    <section
      className="pdf-viewer reader-viewer"
      aria-label={t("viewer.title")}
    >
      <header className="pdf-viewer-header">
        <Link
          to="/"
          onClick={(event) => routeTo(event, "/")}
          className="viewer-icon-button viewer-back"
          title={t("viewer.back")}
          aria-label={t("viewer.back")}
        >
          <Icon name="back" />
        </Link>
        <div className="viewer-document-title">
          <span className="viewer-eyebrow">{t("viewer.title")}</span>
          <h1 title={filePath}>
            {fileName}
            {reader.modified && (
              <span className="reader-unsaved" title={t("viewer.unsaved")}>
                {" "}
                ●
              </span>
            )}
          </h1>
        </div>
        <button
          className="viewer-button viewer-open"
          onClick={() => void openPdf()}
          disabled={saving || !!printProgress}
          title={`${t("viewer.btnSelect")} (Ctrl+O)`}
        >
          <Icon name="open" />
          <span>{t("viewer.btnSelect")}</span>
        </button>
        <button
          className="viewer-button reader-save"
          onClick={() => void saveDocument()}
          disabled={!interactive || saving}
          title={`${t("viewer.saveCopy")} (Ctrl+S)`}
          aria-label={t("viewer.saveCopy")}
        >
          <Icon name="save" />
          <span>{saving ? t("viewer.saving") : t("viewer.saveCopy")}</span>
        </button>
        <button
          className="viewer-icon-button"
          onClick={() => setPrintOpen(true)}
          disabled={!interactive || !reader.canPrint || !!printProgress}
          title={`${t("viewer.print")} (Ctrl+P)`}
          aria-label={t("viewer.print")}
        >
          <Icon name="print" />
        </button>
        <details className="viewer-tools" ref={toolsRef}>
          <summary
            className="viewer-icon-button"
            title={t("viewer.more")}
            aria-label={t("viewer.more")}
          >
            <Icon name="menu" />
          </summary>
          <nav aria-label={t("viewer.more")}>
            <span className="viewer-menu-title">{t("viewer.document")}</span>
            <button
              disabled={!interactive}
              onClick={() => {
                setProperties(true);
                toolsRef.current!.open = false;
              }}
            >
              <Icon name="info" />
              {t("viewer.properties")}
            </button>
            <button
              disabled={!interactive}
              onClick={() => {
                setPanel("outline");
                toolsRef.current!.open = false;
              }}
            >
              <Icon name="outline" />
              {t("viewer.outline")}
            </button>
            <button
              disabled={!interactive}
              onClick={() => {
                setPanel("bookmarks");
                toolsRef.current!.open = false;
              }}
            >
              <Icon name="bookmark" />
              {t("viewer.bookmarks")}
            </button>
            <button disabled={!interactive} onClick={() => reader.goToPage(1)}>
              {t("viewer.firstPage")}
            </button>
            <button
              disabled={!interactive}
              onClick={() => reader.goToPage(total)}
            >
              {t("viewer.lastPage")}
            </button>
            <button disabled={!interactive} onClick={() => rotate(-90)}>
              {t("viewer.rotateLeft")}
            </button>
            <label className="reader-menu-setting">
              {t("viewer.background")}
              <select
                value={background}
                onChange={(event) => setBackground(event.target.value)}
              >
                <option value="dark">{t("viewer.dark")}</option>
                <option value="light">{t("viewer.light")}</option>
                <option value="sepia">{t("viewer.sepia")}</option>
              </select>
            </label>
            <span className="viewer-menu-title">{t("viewer.allTools")}</span>
            {[
              ["/", "app.title"],
              ["/maker/image", "nav.imageToPdf"],
              ["/maker/merge", "nav.mergePdf"],
              ["/maker/split", "nav.splitPdf"],
              ["/converter/pdf-to-word", "word.title"],
              ["/settings", "nav.settings"],
            ].map(([to, key]) => (
              <Link key={to} to={to} onClick={(event) => routeTo(event, to)}>
                {t(key as Parameters<typeof t>[0])}
              </Link>
            ))}
          </nav>
        </details>
      </header>

      <div
        className="pdf-viewer-toolbar"
        role="toolbar"
        aria-label={t("viewer.controls")}
      >
        <div className="viewer-control-group viewer-panel-controls">
          <button
            className="viewer-button"
            aria-pressed={panel !== null && panel !== "search"}
            onClick={() =>
              setPanel(panel && panel !== "search" ? null : "pages")
            }
            title={t("viewer.pages")}
            aria-label={t("viewer.pages")}
          >
            <Icon name="pages" />
            <span>{t("viewer.pages")}</span>
          </button>
          <button
            className="viewer-button"
            aria-pressed={panel === "search"}
            onClick={() => setPanel(panel === "search" ? null : "search")}
            title={`${t("viewer.search")} (Ctrl+F)`}
            aria-label={t("viewer.search")}
          >
            <Icon name="search" />
          </button>
        </div>
        <div className="viewer-control-group viewer-page-controls">
          <button
            className="viewer-icon-button"
            disabled={!interactive || reader.currentPage === 1}
            onClick={() => reader.goToPage(reader.currentPage - 1)}
            title={t("viewer.previous")}
            aria-label={t("viewer.previous")}
          >
            <Icon name="prev" />
          </button>
          <label className="viewer-page-input">
            <span className="viewer-sr-only">{t("viewer.pageNumber")}</span>
            <input
              value={pageInput}
              disabled={!interactive}
              onChange={(event) => setPageInput(event.target.value)}
              onBlur={commitPage}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
            <span>/ {total || "—"}</span>
          </label>
          <button
            className="viewer-icon-button"
            disabled={!interactive || reader.currentPage === total}
            onClick={() => reader.goToPage(reader.currentPage + 1)}
            title={t("viewer.next")}
            aria-label={t("viewer.next")}
          >
            <Icon name="next" />
          </button>
        </div>
        <div className="viewer-control-group viewer-zoom-controls">
          <button
            className="viewer-icon-button"
            disabled={!interactive || reader.scale <= 0.1}
            onClick={() => zoomBy(-1)}
            title={t("viewer.zoomOut")}
            aria-label={t("viewer.zoomOut")}
          >
            <Icon name="minus" />
          </button>
          <select
            aria-label={t("viewer.zoom")}
            value={reader.scaleValue}
            disabled={!interactive}
            onChange={(event) => {
              const value = event.target.value;
              reader.setZoom(
                Number.isFinite(Number(value)) ? Number(value) : value,
              );
            }}
          >
            <option value="auto">{t("viewer.autoZoom")}</option>
            <option value="page-fit">{t("viewer.fitPage")}</option>
            <option value="page-width">{t("viewer.fitWidth")}</option>
            <option value="page-actual">{t("viewer.actualSize")}</option>
            {![
              "auto",
              "page-fit",
              "page-width",
              "page-actual",
              "0.25",
              "0.5",
              "0.75",
              "1",
              "1.25",
              "1.5",
              "2",
              "3",
              "4",
              "5",
            ].includes(reader.scaleValue) && (
              <option value={reader.scaleValue}>
                {Math.round(reader.scale * 100)}%
              </option>
            )}
            {[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5].map((value) => (
              <option value={String(value)} key={value}>
                {value * 100}%
              </option>
            ))}
          </select>
          <button
            className="viewer-icon-button"
            disabled={!interactive || reader.scale >= 5}
            onClick={() => zoomBy(1)}
            title={t("viewer.zoomIn")}
            aria-label={t("viewer.zoomIn")}
          >
            <Icon name="plus" />
          </button>
        </div>
        <div className="viewer-control-group reader-layout-controls">
          <select
            aria-label={t("viewer.scrollMode")}
            disabled={!interactive}
            value={reader.scrollMode}
            onChange={(event) => {
              if (reader.runtime.current)
                reader.runtime.current.viewer.scrollMode = Number(
                  event.target.value,
                );
            }}
          >
            <option value={0}>{t("viewer.continuous")}</option>
            <option value={3}>{t("viewer.singlePage")}</option>
            <option value={1}>{t("viewer.horizontal")}</option>
            <option value={2}>{t("viewer.wrapped")}</option>
          </select>
          <select
            aria-label={t("viewer.spreadMode")}
            disabled={!interactive}
            value={reader.spreadMode}
            onChange={(event) => {
              if (reader.runtime.current)
                reader.runtime.current.viewer.spreadMode = Number(
                  event.target.value,
                );
            }}
          >
            <option value={0}>{t("viewer.noSpread")}</option>
            <option value={1}>{t("viewer.twoPages")}</option>
            <option value={2}>{t("viewer.coverSpread")}</option>
          </select>
        </div>
        <div className="viewer-control-group viewer-view-controls">
          <button
            className="viewer-icon-button"
            disabled={!interactive}
            onClick={() => rotate()}
            title={t("viewer.rotate")}
            aria-label={t("viewer.rotate")}
          >
            <Icon name="rotate" />
          </button>
          <button
            className="viewer-icon-button"
            disabled={!interactive}
            onClick={toggleBookmark}
            aria-pressed={bookmarks.includes(reader.currentPage)}
            title={t("viewer.bookmarkPage")}
            aria-label={t("viewer.bookmarkPage")}
          >
            <Icon name="bookmark" />
          </button>
          <button
            className="viewer-icon-button"
            onClick={() => void toggleFullscreen()}
            title={
              fullscreen ? t("viewer.exitFullscreen") : t("viewer.fullscreen")
            }
            aria-label={
              fullscreen ? t("viewer.exitFullscreen") : t("viewer.fullscreen")
            }
          >
            <Icon name={fullscreen ? "collapse" : "expand"} />
          </button>
        </div>
        <button
          className="viewer-button viewer-export"
          onClick={() => void exportPages()}
          disabled={!interactive || !selected.size || exporting || saving}
          title={t("viewer.export")}
          aria-label={t("viewer.export")}
        >
          <Icon name="download" />
          <span>{exporting ? t("viewer.exporting") : t("viewer.export")}</span>
          {selected.size > 0 && <b>{selected.size}</b>}
        </button>
        <div className="reader-edit-controls">
          <select
            aria-label={t("viewer.cursorTool")}
            value={tool}
            disabled={!interactive}
            onChange={(event) => changeTool(event.target.value as Tool)}
          >
            <option value="select">{t("viewer.selectText")}</option>
            <option value="hand">{t("viewer.handTool")}</option>
            <option value="highlight" disabled={!reader.editorReady}>
              {t("viewer.highlight")}
            </option>
            <option value="ink" disabled={!reader.editorReady}>
              {t("viewer.draw")}
            </option>
            <option value="text" disabled={!reader.editorReady}>
              {t("viewer.addText")}
            </option>
          </select>
          {editedTool && (
            <>
              <input
                type="color"
                value={color}
                aria-label={t("viewer.annotationColor")}
                title={t("viewer.annotationColor")}
                onChange={(event) => changeColor(event.target.value)}
              />
              <span>
                {t(
                  tool === "highlight"
                    ? "viewer.highlightHint"
                    : tool === "ink"
                      ? "viewer.drawHint"
                      : "viewer.textHint",
                )}
              </span>
            </>
          )}
          <button
            className="viewer-icon-button"
            disabled={!reader.editorReady}
            onClick={() => reader.runtime.current?.editor?.undo()}
            title={t("viewer.undo")}
            aria-label={t("viewer.undo")}
          >
            <Icon name="undo" />
          </button>
          <button
            className="viewer-icon-button"
            disabled={!reader.editorReady}
            onClick={() => reader.runtime.current?.editor?.redo()}
            title={t("viewer.redo")}
            aria-label={t("viewer.redo")}
          >
            <Icon name="redo" />
          </button>
        </div>
      </div>

      <div className={`viewer-workspace${panel ? " has-panel" : ""}`}>
        {panel && (
          <aside className="viewer-panel" aria-label={t(`viewer.${panel}`)}>
            <div className="viewer-panel-heading">
              <select
                aria-label={t("viewer.sidebarView")}
                value={panel}
                onChange={(event) => setPanel(event.target.value as Panel)}
              >
                {panelOptions.map((value) => (
                  <option key={value} value={value}>
                    {t(`viewer.${value}`)}
                  </option>
                ))}
              </select>
              <button
                className="viewer-icon-button"
                onClick={() => setPanel(null)}
                title={t("viewer.closePanel")}
                aria-label={t("viewer.closePanel")}
              >
                <Icon name="close" />
              </button>
            </div>
            {panel === "pages" && (
              <>
                <label className="viewer-select-all">
                  <input
                    type="checkbox"
                    disabled={!total}
                    checked={total > 0 && selected.size === total}
                    ref={(element) => {
                      if (element)
                        element.indeterminate =
                          selected.size > 0 && selected.size < total;
                    }}
                    onChange={() =>
                      setSelected(
                        selected.size === total
                          ? new Set()
                          : new Set(
                              Array.from(
                                { length: total },
                                (_, index) => index + 1,
                              ),
                            ),
                      )
                    }
                  />
                  {t("viewer.selectAll")}
                  <span>{total}</span>
                </label>
                <form
                  className="reader-range"
                  onSubmit={(event) => {
                    event.preventDefault();
                    applyRange();
                  }}
                >
                  <input
                    placeholder="1, 3-5"
                    aria-label={t("viewer.pageRange")}
                    value={range}
                    onChange={(event) => setRange(event.target.value)}
                  />
                  <button disabled={!total} title={t("viewer.applyRange")}>
                    {t("viewer.apply")}
                  </button>
                </form>
                <div className="viewer-thumbnails">
                  {pdf &&
                    Array.from({ length: total }, (_, index) => index + 1).map(
                      (num) => (
                        <div
                          key={num}
                          className={`viewer-thumbnail${num === reader.currentPage ? " is-current" : ""}${selected.has(num) ? " is-selected" : ""}`}
                        >
                          <button
                            className="viewer-thumbnail-preview"
                            onClick={() => reader.goToPage(num)}
                            aria-label={`${t("viewer.page")} ${num}`}
                            aria-current={
                              num === reader.currentPage ? "page" : undefined
                            }
                          >
                            <PdfThumbnail
                              document={pdf}
                              page={num}
                              rotation={reader.rotation}
                            />
                          </button>
                          <label className="viewer-thumbnail-label">
                            <span>
                              {t("viewer.page")} {num}
                            </span>
                            <input
                              type="checkbox"
                              aria-label={`${t("viewer.selectPage")} ${num}`}
                              checked={selected.has(num)}
                              onChange={() => togglePage(num)}
                            />
                          </label>
                        </div>
                      ),
                    )}
                  {!pdf && (
                    <p className="viewer-panel-note">{t("viewer.openFirst")}</p>
                  )}
                </div>
                <div className="viewer-panel-footer">
                  {selected.size} {t("viewer.selected")}
                </div>
              </>
            )}
            {panel === "search" && (
              <>
                <form
                  className="viewer-search-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    reader.find(query, findOptions, false, true);
                  }}
                >
                  <div className="viewer-search-input">
                    <Icon name="search" />
                    <input
                      ref={searchRef}
                      placeholder={t("viewer.searchPlaceholder")}
                      aria-label={t("viewer.searchPlaceholder")}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                    <button
                      type="submit"
                      className="viewer-icon-button"
                      title={t("viewer.nextMatch")}
                      aria-label={t("viewer.nextMatch")}
                    >
                      <Icon name="next" />
                    </button>
                  </div>
                </form>
                <div className="reader-find-navigation">
                  <span role="status">
                    {reader.matches.pending
                      ? t("viewer.searching")
                      : `${reader.matches.current} / ${reader.matches.total}`}
                  </span>
                  <button
                    className="viewer-icon-button"
                    disabled={!query || !reader.matches.total}
                    onClick={() => reader.find(query, findOptions, true, true)}
                    title={t("viewer.previousMatch")}
                    aria-label={t("viewer.previousMatch")}
                  >
                    <Icon name="prev" />
                  </button>
                  <button
                    className="viewer-icon-button"
                    disabled={!query || !reader.matches.total}
                    onClick={() => reader.find(query, findOptions, false, true)}
                    title={t("viewer.nextMatch")}
                    aria-label={t("viewer.nextMatch")}
                  >
                    <Icon name="next" />
                  </button>
                </div>
                <div className="reader-find-options">
                  {(
                    [
                      ["caseSensitive", "viewer.caseSensitive"],
                      ["entireWord", "viewer.wholeWord"],
                      ["highlightAll", "viewer.highlightAll"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={findOptions[key]}
                        onChange={(event) =>
                          setFindOptions((previous) => ({
                            ...previous,
                            [key]: event.target.checked,
                          }))
                        }
                      />
                      {t(label)}
                    </label>
                  ))}
                </div>
                <div className="viewer-search-results">
                  {query ? (
                    <>
                      {reader.matchingPages.map((result) => (
                        <button
                          className={`viewer-search-result${result.page === reader.currentPage ? " is-current" : ""}`}
                          key={result.page}
                          onClick={() => reader.goToPage(result.page)}
                        >
                          <strong>
                            {t("viewer.page")} {result.page}
                          </strong>
                          <span>
                            {result.count} {t("viewer.matches")}
                          </span>
                        </button>
                      ))}
                      {!reader.matches.total && !reader.matches.pending && (
                        <p className="viewer-panel-note">
                          {t("viewer.noResults")}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="viewer-panel-note">
                      {t("viewer.searchHint")}
                    </p>
                  )}
                </div>
              </>
            )}
            {panel === "outline" && (
              <div className="reader-panel-content">
                {reader.outline.length ? (
                  <ul className="reader-outline">
                    {outlineNodes(reader.outline)}
                  </ul>
                ) : (
                  <p className="viewer-panel-note">{t("viewer.noOutline")}</p>
                )}
              </div>
            )}
            {panel === "bookmarks" && (
              <div className="reader-panel-content">
                <button
                  className="viewer-button reader-panel-action"
                  disabled={!interactive}
                  onClick={toggleBookmark}
                >
                  <Icon name="bookmark" />
                  {t("viewer.bookmarkPage")}
                </button>
                {bookmarks.map((page) => (
                  <div className="reader-bookmark" key={page}>
                    <button onClick={() => reader.goToPage(page)}>
                      {t("viewer.page")} {page}
                    </button>
                    <button
                      aria-label={`${t("viewer.removeBookmark")} ${page}`}
                      onClick={() => {
                        const next = bookmarks.filter(
                          (value) => value !== page,
                        );
                        setBookmarks(next);
                        if (pdf) {
                          try {
                            localStorage.setItem(
                              `reader-bookmarks:${pdf.fingerprints[0]}`,
                              JSON.stringify(next),
                            );
                          } catch {}
                        }
                      }}
                    >
                      <Icon name="close" />
                    </button>
                  </div>
                ))}
                {!bookmarks.length && (
                  <p className="viewer-panel-note">{t("viewer.noBookmarks")}</p>
                )}
              </div>
            )}
            {panel === "attachments" && (
              <div className="reader-panel-content">
                {reader.attachments.map((attachment, index) => (
                  <button
                    className="reader-attachment"
                    key={index}
                    onClick={() =>
                      void saveReaderFile(
                        attachment.data,
                        attachment.name,
                      ).catch(report)
                    }
                  >
                    <Icon name="download" />
                    <span>
                      {attachment.name}
                      <small>
                        {(attachment.data.length / 1024).toFixed(1)} KB
                      </small>
                    </span>
                  </button>
                ))}
                {!reader.attachments.length && (
                  <p className="viewer-panel-note">
                    {t("viewer.noAttachments")}
                  </p>
                )}
              </div>
            )}
            {panel === "layers" && (
              <div className="reader-panel-content">
                {reader.layers.map((layer) => (
                  <label className="reader-layer" key={layer.id}>
                    <input
                      type="checkbox"
                      checked={layer.visible}
                      onChange={(event) =>
                        reader.changeLayer(layer.id, event.target.checked)
                      }
                    />
                    {layer.name}
                  </label>
                ))}
                {!reader.layers.length && (
                  <p className="viewer-panel-note">{t("viewer.noLayers")}</p>
                )}
              </div>
            )}
          </aside>
        )}
        <div
          className={`reader-stage${tool === "hand" ? " is-hand" : ""}${panning ? " is-panning" : ""}`}
          data-background={background}
          data-ready={interactive}
        >
          <div
            className="reader-pdf-container"
            ref={reader.containerRef}
            tabIndex={0}
            aria-label={t("viewer.document")}
            onPointerDown={(event) => {
              if (
                tool !== "hand" ||
                event.button !== 0 ||
                (event.target instanceof HTMLElement &&
                  event.target.closest(
                    "input,textarea,button,a,[contenteditable=true]",
                  ))
              )
                return;
              const element = event.currentTarget;
              drag.current = {
                x: event.clientX,
                y: event.clientY,
                left: element.scrollLeft,
                top: element.scrollTop,
              };
              element.setPointerCapture(event.pointerId);
              setPanning(true);
              event.preventDefault();
            }}
            onPointerMove={(event) => {
              if (drag.current) {
                event.currentTarget.scrollLeft =
                  drag.current.left - event.clientX + drag.current.x;
                event.currentTarget.scrollTop =
                  drag.current.top - event.clientY + drag.current.y;
              }
            }}
            onPointerUp={(event) => {
              drag.current = null;
              setPanning(false);
              if (event.currentTarget.hasPointerCapture(event.pointerId))
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}
            onLostPointerCapture={() => {
              drag.current = null;
              setPanning(false);
            }}
          >
            <div ref={reader.pagesRef} className="pdfViewer" />
          </div>
          {!interactive && (
            <div className="viewer-empty-state reader-empty">
              <div className="viewer-empty-icon">
                <Icon name="file" />
                <span>PDF</span>
              </div>
              <span className="viewer-eyebrow">{t("viewer.title")}</span>
              <h2>
                {reader.opening
                  ? t("viewer.opening")
                  : reader.error
                    ? t("viewer.openFailed")
                    : t("viewer.emptyTitle")}
              </h2>
              <p>{reader.error || t("viewer.readerDescription")}</p>
              <button
                className="viewer-button viewer-open"
                disabled={reader.opening}
                onClick={() => void openPdf()}
              >
                <Icon name="open" />
                {t("viewer.btnSelect")}
              </button>
              <span className="viewer-empty-hint">
                {t("viewer.dropText")} · Ctrl+O
              </span>
            </div>
          )}
        </div>
        {isHovering && (
          <div className="viewer-drop-overlay">
            <Icon name="open" />
            <strong>{t("viewer.dropText")}</strong>
            <span>{t("viewer.dropSub")}</span>
          </div>
        )}
      </div>
      <footer className="viewer-statusbar">
        <span role="status">
          {reader.opening
            ? t("viewer.opening")
            : pdf
              ? `${total} ${t("viewer.totalPages")} · ${(reader.fileSize / 1024).toFixed(1)} KB`
              : t("viewer.ready")}
        </span>
        <div>
          {pdf && (
            <>
              <span>
                {reader.modified
                  ? t("viewer.unsaved")
                  : reader.canCopy
                    ? t("viewer.textSelectable")
                    : t("viewer.copyRestricted")}
              </span>
              <span>{Math.round(reader.scale * 100)}%</span>
              <span>{reader.rotation}°</span>
            </>
          )}
        </div>
      </footer>

      {properties && (
        <ReaderDialog
          title={t("viewer.properties")}
          closeLabel={t("viewer.closePanel")}
          onClose={() => setProperties(false)}
        >
          <dl className="reader-properties">
            {[
              [t("viewer.fileName"), fileName],
              [
                t("viewer.fileSize"),
                `${(reader.fileSize / 1024).toFixed(1)} KB`,
              ],
              [t("viewer.totalPages"), String(total)],
              [t("viewer.pageSize"), reader.pageSize],
              [t("viewer.docTitle"), reader.metadata.Title],
              [t("viewer.author"), reader.metadata.Author],
              [t("viewer.subject"), reader.metadata.Subject],
              [t("viewer.creator"), reader.metadata.Creator],
              [t("viewer.producer"), reader.metadata.Producer],
              [t("viewer.created"), date(reader.metadata.CreationDate)],
              [t("viewer.modifiedDate"), date(reader.metadata.ModDate)],
              [t("viewer.pdfVersion"), reader.metadata.PDFFormatVersion],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt>{String(label)}</dt>
                <dd>{value ? String(value) : "—"}</dd>
              </div>
            ))}
          </dl>
        </ReaderDialog>
      )}
      {reader.password && (
        <ReaderDialog
          title={t("viewer.passwordTitle")}
          closeLabel={t("viewer.cancel")}
          onClose={reader.password.cancel}
        >
          <form
            className="reader-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              reader.password?.submit(passwordValue);
              setPasswordValue("");
            }}
          >
            <p>
              {reader.password.reason ===
              pdfjs.PasswordResponses.INCORRECT_PASSWORD
                ? t("viewer.wrongPassword")
                : t("viewer.passwordHint")}
            </p>
            <label>
              {t("viewer.password")}
              <input
                type="password"
                autoFocus
                autoComplete="off"
                value={passwordValue}
                onChange={(event) => setPasswordValue(event.target.value)}
              />
            </label>
            <div className="reader-dialog-actions">
              <button
                type="button"
                className="viewer-button"
                onClick={reader.password.cancel}
              >
                {t("viewer.cancel")}
              </button>
              <button
                className="viewer-button viewer-open"
                disabled={!passwordValue}
              >
                {t("viewer.unlock")}
              </button>
            </div>
          </form>
        </ReaderDialog>
      )}
      {pending && (
        <ReaderDialog
          title={t("viewer.unsaved")}
          closeLabel={t("viewer.cancel")}
          onClose={() => {
            if (!saving) setPending(null);
          }}
        >
          <p className="reader-dialog-note">{t("viewer.unsavedHint")}</p>
          <div className="reader-dialog-actions">
            <button
              className="viewer-button"
              disabled={saving}
              onClick={() => setPending(null)}
            >
              {t("viewer.cancel")}
            </button>
            <button
              className="viewer-button"
              disabled={saving}
              onClick={continuePending}
            >
              {t("viewer.discard")}
            </button>
            <button
              className="viewer-button viewer-open"
              disabled={saving}
              onClick={() =>
                void saveDocument().then((saved) => {
                  if (saved) continuePending();
                })
              }
            >
              {t("viewer.saveAndContinue")}
            </button>
          </div>
        </ReaderDialog>
      )}
      {printOpen && (
        <ReaderDialog
          title={t("viewer.print")}
          closeLabel={t("viewer.cancel")}
          onClose={() => setPrintOpen(false)}
        >
          <form
            className="reader-dialog-form"
            onSubmit={(event) => {
              event.preventDefault();
              void printDocument();
            }}
          >
            <label>
              {t("viewer.printPages")}
              <select
                value={printMode}
                onChange={(event) => setPrintMode(event.target.value)}
              >
                <option value="all">{t("viewer.allPages")}</option>
                <option value="current">{t("viewer.currentPage")}</option>
                <option value="selected" disabled={!selected.size}>
                  {t("viewer.selectedPages")} ({selected.size})
                </option>
                <option value="custom">{t("viewer.customRange")}</option>
              </select>
            </label>
            {printMode === "custom" && (
              <label>
                {t("viewer.pageRange")}
                <input
                  placeholder="1, 3-5"
                  value={printRange}
                  onChange={(event) => setPrintRange(event.target.value)}
                />
              </label>
            )}
            <p>{t("viewer.printHint")}</p>
            <div className="reader-dialog-actions">
              <button
                type="button"
                className="viewer-button"
                onClick={() => setPrintOpen(false)}
              >
                {t("viewer.cancel")}
              </button>
              <button className="viewer-button viewer-open">
                <Icon name="print" />
                {t("viewer.print")}
              </button>
            </div>
          </form>
        </ReaderDialog>
      )}
      {printProgress && (
        <ReaderDialog
          title={t("viewer.preparingPrint")}
          closeLabel={t("viewer.cancel")}
          onClose={() => printAbort.current?.abort()}
        >
          <div className="reader-dialog-form">
            <p role="status">
              {printProgress.page} / {printProgress.total}{" "}
              {t("viewer.totalPages")}
            </p>
            <progress max={printProgress.total} value={printProgress.page} />
            <button
              className="viewer-button"
              onClick={() => printAbort.current?.abort()}
            >
              {t("viewer.cancel")}
            </button>
          </div>
        </ReaderDialog>
      )}
    </section>
  );
}
