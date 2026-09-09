import { ChevronLeft, ChevronRight, Loader2, X, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ipc } from "@/lib/ipc";
import type { LibraryItem } from "@/lib/types";

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

export function PdfReader({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(item.lastPage && item.lastPage > 0 ? item.lastPage : 1);
  const [zoom, setZoom] = useState(1.1);

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

  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || loading) return;

    let cancelled = false;
    void (async () => {
      const pdfPage = await doc.getPage(page);
      if (cancelled) return;
      const viewport = pdfPage.getViewport({ scale: zoom });
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
        // Rendering was cancelled by a newer page/zoom change — expected,
        // not an error worth surfacing.
      }
    })();

    void ipc.librarySetLastPage(item.id, page).catch(() => {
      /* best-effort — not worth interrupting reading over */
    });

    return () => {
      cancelled = true;
    };
  }, [page, zoom, loading, item.id]);

  const goTo = (next: number) => setPage(Math.min(Math.max(next, 1), pageCount || 1));

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-bg">
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-2">
        <p className="truncate text-[13px] font-medium text-ink">{item.title}</p>
        <div className="flex items-center gap-1.5">
          {!loading && !error && (
            <>
              <button
                type="button"
                onClick={() => goTo(page - 1)}
                disabled={page <= 1}
                className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink disabled:opacity-30"
              >
                <ChevronLeft size={14} strokeWidth={1.8} />
              </button>
              <span className="min-w-[64px] text-center text-[11.5px] text-muted">
                {page} / {pageCount}
              </span>
              <button
                type="button"
                onClick={() => goTo(page + 1)}
                disabled={page >= pageCount}
                className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink disabled:opacity-30"
              >
                <ChevronRight size={14} strokeWidth={1.8} />
              </button>
              <div className="mx-1 h-4 w-px bg-line-soft" />
              <button
                type="button"
                onClick={() => setZoom((z) => Math.max(0.5, z - 0.15))}
                className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
              >
                <ZoomOut size={14} strokeWidth={1.8} />
              </button>
              <span className="min-w-[42px] text-center text-[11px] text-faint">
                {Math.round(zoom * 100)}%
              </span>
              <button
                type="button"
                onClick={() => setZoom((z) => Math.min(3, z + 0.15))}
                className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
              >
                <ZoomIn size={14} strokeWidth={1.8} />
              </button>
              <div className="mx-1 h-4 w-px bg-line-soft" />
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
            aria-label="Close reader"
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <div ref={containerRef} className="flex flex-1 items-start justify-center overflow-auto p-6">
        {loading && (
          <div className="flex items-center gap-2 pt-16 text-[12.5px] text-faint">
            <Loader2 size={14} className="animate-spin" />
            Opening…
          </div>
        )}
        {error && (
          <div className="max-w-[320px] pt-16 text-center text-[12.5px] text-faint">
            Couldn't open this file in the reader: {error}. It might not be a PDF, or the format
            isn't supported yet — try opening it from your file manager instead.
          </div>
        )}
        {!loading && !error && (
          <canvas ref={canvasRef} className="rounded-sm shadow-md shadow-black/10" />
        )}
      </div>
    </div>
  );
}
