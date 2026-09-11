import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  Maximize2,
  Minimize2,
  MoveHorizontal,
  Rows3,
  SquareStack,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { ipc } from "@/lib/ipc";
import type { LibraryItem } from "@/lib/types";
import { useVault } from "@/stores/vault";

type ReadMode = "page" | "scroll";

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Only set up once — pdfjs-dist itself (and its worker) are lazy-loaded
 * inside the effect below, so opening the Library never pays for this
 * unless a PDF actually gets opened. */
let workerConfigured = false;

const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;

export function PdfReader({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const root = useVault((s) => s.root);
  const shellRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const scrollToPageRef = useRef<((page: number) => void) | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(item.lastPage && item.lastPage > 0 ? item.lastPage : 1);
  const [pageInput, setPageInput] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1.1);
  const [fitWidth, setFitWidth] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  // Page by page (click/arrow through one page at a time, the original
  // behavior) or All pages (every page loads into one continuous, scrollable
  // column) — a reading-style toggle, defaulting to the original page mode
  // so nothing changes unless the person picks "all pages" themselves.
  const [mode, setMode] = useState<ReadMode>("page");

  // Loads the document itself — runs once per item (this component is
  // mounted with `key={item.id}` by LibraryPage, so a different item is
  // always a full fresh mount, never a prop change on a reused instance).
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (!workerConfigured) {
          const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
          pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
          workerConfigured = true;
        }

        const base64 = await ipc.libraryReadFile(item.id);
        if (cancelled) return;
        const bytes = base64ToBytes(base64);
        const doc = await pdfjs.getDocument({ data: bytes }).promise;
        if (cancelled) return;
        docRef.current = doc;
        setPageCount(doc.numPages);
        setPage((current) => Math.min(Math.max(current, 1), doc.numPages));
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      void docRef.current?.destroy();
      docRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Renders the current page at the current zoom. `fitWidth` recomputes an
  // effective zoom from the scroll container's actual width first, so the
  // page always fills it regardless of the PDF's native page size.
  // Only runs in "page" mode — in "scroll" mode, AllPagesView below owns
  // rendering instead, so this leaves the canvas alone.
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (mode !== "page" || !doc || !canvas || loading) return;

    let cancelled = false;
    void (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;

      let effectiveZoom = zoom;
      if (fitWidth && scrollRef.current) {
        const naturalWidth = pdfPage.getViewport({ scale: 1 }).width;
        const available = scrollRef.current.clientWidth - 48; // minus padding
        if (naturalWidth > 0 && available > 0) {
          effectiveZoom = available / naturalWidth;
        }
      }

      const viewport = pdfPage.getViewport({ scale: effectiveZoom });
      const context = canvas.getContext("2d");
      if (!context) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      renderTaskRef.current?.cancel();
      const task = pdfPage.render({ canvasContext: context, viewport });
      renderTaskRef.current = task;
      try {
        await task.promise;
      } catch {
        // Cancelled by a newer page/zoom change — expected, not an error.
      }
    })();

    void ipc.librarySetLastPage(item.id, page).catch(() => {
      /* best-effort — not worth interrupting reading over */
    });

    return () => {
      cancelled = true;
    };
  }, [page, zoom, fitWidth, loading, item.id, mode]);

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(next, 1), pageCount || 1);
      setPage(clamped);
      if (mode === "scroll") scrollToPageRef.current?.(clamped);
    },
    [pageCount, mode],
  );

  // In scroll mode the "current page" is whatever's most visible, tracked
  // by AllPagesView — persisted the same way the page-mode effect above
  // does, just throttled here instead since scroll fires far more often.
  const lastPersistRef = useRef(0);
  const onVisiblePage = useCallback(
    (num: number) => {
      setPage(num);
      const now = Date.now();
      if (now - lastPersistRef.current > 600) {
        lastPersistRef.current = now;
        void ipc.librarySetLastPage(item.id, num).catch(() => {
          /* best-effort */
        });
      }
    },
    [item.id],
  );

  // Switching into "all pages" mode should land on whichever page was
  // being read in page-by-page mode (including the very first page
  // resumed from last time), not reset to the top of the document.
  useEffect(() => {
    if (mode === "scroll") scrollToPageRef.current?.(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const zoomBy = (delta: number) => {
    setFitWidth(false);
    setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z + delta)));
  };

  // Keyboard nav: arrows for page, +/- for zoom, Escape closes — ignored
  // while typing a page number directly so digits go into that field.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (pageInput !== null) return;
      if (event.key === "Escape") {
        onClose();
      } else if (event.key === "ArrowRight" || event.key === "PageDown") {
        goTo(page + 1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        goTo(page - 1);
      } else if (event.key === "+" || event.key === "=") {
        zoomBy(0.15);
      } else if (event.key === "-") {
        zoomBy(-0.15);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageInput, goTo, onClose]);

  useEffect(() => {
    const onFullscreenChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void shellRef.current?.requestFullscreen();
    }
  };

  const submitPageInput = () => {
    if (pageInput !== null) {
      const parsed = Number.parseInt(pageInput, 10);
      if (Number.isFinite(parsed)) goTo(parsed);
    }
    setPageInput(null);
  };

  const openExternally = () => {
    if (!item.fileRel || !root) return;
    void openUrl(`${root}/${item.fileRel}`);
  };

  return (
    <div ref={shellRef} className="absolute inset-0 z-50 flex flex-col bg-bg">
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-2">
        <p className="truncate text-[13px] font-medium text-ink">{item.title}</p>
        <div className="flex items-center gap-1.5">
          {!loading && !error && (
            <>
              <button
                type="button"
                onClick={() => goTo(page - 1)}
                disabled={page <= 1}
                title="Previous page (←)"
                className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink disabled:opacity-30"
              >
                <ChevronLeft size={14} strokeWidth={1.8} />
              </button>
              {pageInput !== null ? (
                <input
                  autoFocus
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
                  onBlur={submitPageInput}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitPageInput();
                    if (e.key === "Escape") setPageInput(null);
                  }}
                  className="h-6 w-12 rounded border border-line-soft bg-panel text-center text-[11.5px] text-ink outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setPageInput(String(page))}
                  title="Jump to page"
                  className="min-w-[64px] rounded px-1 text-center text-[11.5px] text-muted hover:bg-hover hover:text-ink"
                >
                  {page} / {pageCount}
                </button>
              )}
              <button
                type="button"
                onClick={() => goTo(page + 1)}
                disabled={page >= pageCount}
                title="Next page (→)"
                className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink disabled:opacity-30"
              >
                <ChevronRight size={14} strokeWidth={1.8} />
              </button>
              <div className="mx-1 h-4 w-px bg-line-soft" />
              <button
                type="button"
                onClick={() => zoomBy(-0.15)}
                title="Zoom out (-)"
                className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
              >
                <ZoomOut size={14} strokeWidth={1.8} />
              </button>
              <span className="min-w-[42px] text-center text-[11px] text-faint">
                {fitWidth ? "Fit" : `${Math.round(zoom * 100)}%`}
              </span>
              <button
                type="button"
                onClick={() => zoomBy(0.15)}
                title="Zoom in (+)"
                className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
              >
                <ZoomIn size={14} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={() => setFitWidth((v) => !v)}
                title="Fit to width"
                className={`grid h-7 w-7 place-items-center rounded-md transition-colors duration-100 ${
                  fitWidth ? "bg-active text-ink" : "text-faint hover:bg-hover hover:text-ink"
                }`}
              >
                <MoveHorizontal size={14} strokeWidth={1.8} />
              </button>
              <div className="mx-1 h-4 w-px bg-line-soft" />
              <button
                type="button"
                onClick={() => setMode("page")}
                title="Page by page — click the sides or use arrow keys"
                className={`grid h-7 w-7 place-items-center rounded-md transition-colors duration-100 ${
                  mode === "page" ? "bg-active text-ink" : "text-faint hover:bg-hover hover:text-ink"
                }`}
              >
                <SquareStack size={14} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                onClick={() => setMode("scroll")}
                title="All pages — load every page and scroll through them"
                className={`grid h-7 w-7 place-items-center rounded-md transition-colors duration-100 ${
                  mode === "scroll" ? "bg-active text-ink" : "text-faint hover:bg-hover hover:text-ink"
                }`}
              >
                <Rows3 size={14} strokeWidth={1.8} />
              </button>
              <div className="mx-1 h-4 w-px bg-line-soft" />
              <button
                type="button"
                onClick={toggleFullscreen}
                title={fullscreen ? "Exit fullscreen" : "Fullscreen"}
                className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
              >
                {fullscreen ? (
                  <Minimize2 size={13.5} strokeWidth={1.8} />
                ) : (
                  <Maximize2 size={13.5} strokeWidth={1.8} />
                )}
              </button>
              <button
                type="button"
                onClick={openExternally}
                title="Open in default app"
                className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
              >
                <ExternalLink size={13.5} strokeWidth={1.8} />
              </button>
              <div className="mx-1 h-4 w-px bg-line-soft" />
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close (Esc)"
            className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
            aria-label="Close reader"
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="flex flex-1 items-start justify-center overflow-auto p-6">
        {loading && (
          <div className="flex items-center gap-2 pt-16 text-[12.5px] text-faint">
            <Loader2 size={14} className="animate-spin" />
            Opening…
          </div>
        )}
        {error && (
          <div className="max-w-[340px] pt-16 text-center text-[12.5px] text-faint">
            <p className="mb-3">
              Couldn't open this file in the reader: {error}. It might not be a PDF, or the format
              isn't supported yet.
            </p>
            <button
              type="button"
              onClick={openExternally}
              className="inline-flex items-center gap-1.5 rounded-md border border-line-soft px-2.5 py-1.5 text-[11.5px] text-ink hover:bg-hover"
            >
              <ExternalLink size={12} strokeWidth={1.8} />
              Open in default app instead
            </button>
          </div>
        )}
        {!loading && !error && mode === "page" && (
          <canvas ref={canvasRef} className="rounded-sm shadow-md shadow-black/10" />
        )}
        {!loading && !error && mode === "scroll" && docRef.current && (
          <AllPagesView
            doc={docRef.current}
            pageCount={pageCount}
            zoom={zoom}
            fitWidth={fitWidth}
            containerRef={scrollRef}
            onVisiblePage={onVisiblePage}
            scrollToPageRef={scrollToPageRef}
            key={item.id}
          />
        )}
      </div>
    </div>
  );
}

/** "All pages" mode: every page gets its own container in one continuous,
 * scrollable column. Pages render lazily as they approach the viewport
 * (a generous `rootMargin` below) rather than all at once up front, which
 * keeps a 500-page scan from stalling the reader on open — but a page
 * never un-renders once drawn, so once scrolled past, it stays put. */
function AllPagesView({
  doc,
  pageCount,
  zoom,
  fitWidth,
  containerRef,
  onVisiblePage,
  scrollToPageRef,
}: {
  doc: import("pdfjs-dist").PDFDocumentProxy;
  pageCount: number;
  zoom: number;
  fitWidth: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  onVisiblePage: (page: number) => void;
  scrollToPageRef: MutableRefObject<((page: number) => void) | null>;
}) {
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const renderedAtZoom = useRef<Map<number, number>>(new Map());

  const renderPage = useCallback(
    async (num: number) => {
      const container = pageRefs.current.get(num);
      if (!container) return;
      if (renderedAtZoom.current.get(num) === zoom) return; // already current
      try {
        const pdfPage = await doc.getPage(num);
        let effectiveZoom = zoom;
        if (fitWidth && containerRef.current) {
          const naturalWidth = pdfPage.getViewport({ scale: 1 }).width;
          const available = containerRef.current.clientWidth - 48;
          if (naturalWidth > 0 && available > 0) effectiveZoom = available / naturalWidth;
        }
        const viewport = pdfPage.getViewport({ scale: effectiveZoom });
        let canvas = container.querySelector("canvas");
        if (!canvas) {
          canvas = document.createElement("canvas");
          container.appendChild(canvas);
        }
        const context = canvas.getContext("2d");
        if (!context) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        renderedAtZoom.current.set(num, zoom);
        await pdfPage.render({ canvasContext: context, viewport }).promise;
      } catch {
        renderedAtZoom.current.delete(num);
      }
    },
    [doc, zoom, fitWidth, containerRef],
  );

  // Renders pages as they scroll near, and keeps the toolbar's page
  // indicator + last-read persistence in sync with whichever page is
  // actually in view.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const renderObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const num = Number((entry.target as HTMLElement).dataset.page);
            void renderPage(num);
          }
        }
      },
      { root: container, rootMargin: "1200px 0px", threshold: 0 },
    );
    for (const el of pageRefs.current.values()) renderObserver.observe(el);

    const onScroll = () => {
      const top = container.getBoundingClientRect().top + 100;
      let closest = 1;
      let closestDistance = Infinity;
      for (const [num, el] of pageRefs.current) {
        const distance = Math.abs(el.getBoundingClientRect().top - top);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = num;
        }
      }
      onVisiblePage(closest);
    };
    container.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      renderObserver.disconnect();
      container.removeEventListener("scroll", onScroll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageCount, renderPage]);

  useEffect(() => {
    scrollToPageRef.current = (num) => {
      pageRefs.current.get(num)?.scrollIntoView({ block: "start" });
    };
    return () => {
      scrollToPageRef.current = null;
    };
  }, [scrollToPageRef]);

  return (
    <div className="flex w-full max-w-full flex-col items-center gap-3">
      {Array.from({ length: pageCount }, (_, i) => i + 1).map((num) => (
        <div
          key={num}
          data-page={num}
          ref={(el) => {
            if (el) pageRefs.current.set(num, el);
            else pageRefs.current.delete(num);
          }}
          className="flex min-h-[200px] items-center justify-center [&>canvas]:rounded-sm [&>canvas]:shadow-md [&>canvas]:shadow-black/10"
        />
      ))}
    </div>
  );
}
