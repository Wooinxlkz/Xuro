import {
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Rows3,
  SkipBack,
  SkipForward,
  SquareStack,
  WifiOff,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import type { MangaChapter } from "@/lib/types";
import { chapterLabelOf, sortChaptersAscending } from "@/lib/mangaOrder";
import { useOnlineManga } from "@/stores/onlineManga";
import { cx } from "@/lib/utils";

interface MangaReaderProps {
  mangaId: string;
  mangaTitle: string;
  coverUrl: string | null;
  chapters: MangaChapter[];
  startChapterId: string;
  startPage?: number;
  onClose: () => void;
}

type ReadMode = "page" | "scroll";

/** Base64 image bytes -> a data URL the <img>/<canvas> can use directly. */
function toDataUrl(base64: string, url: string): string {
  const ext = url.split(".").pop()?.toLowerCase() ?? "jpg";
  const mime = ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : "image/jpeg";
  return `data:${mime};base64,${base64}`;
}

export function MangaReader({
  mangaId,
  mangaTitle,
  coverUrl,
  chapters,
  startChapterId,
  startPage,
  onClose,
}: MangaReaderProps) {
  const downloads = useOnlineManga((s) => s.downloads);
  const recordProgress = useOnlineManga((s) => s.recordProgress);
  const addBookmark = useOnlineManga((s) => s.addBookmark);
  const bookmarks = useOnlineManga((s) => s.bookmarks);

  const ordered = useMemo(() => sortChaptersAscending(chapters), [chapters]);
  const [chapterIndex, setChapterIndex] = useState(() =>
    Math.max(
      0,
      ordered.findIndex((c) => c.id === startChapterId),
    ),
  );
  const chapter = ordered[chapterIndex] ?? ordered[0];

  const [mode, setMode] = useState<ReadMode>("page");
  const [pages, setPages] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(startPage && startPage > 0 ? startPage : 1);
  const offline = downloads.some((d) => d.chapterId === chapter?.id);

  const scrollRef = useRef<HTMLDivElement>(null);
  const lastSentRef = useRef(0);

  // Loads every page of the current chapter — from local disk if it's been
  // downloaded, otherwise MangaDex's `/at-home` image URLs. Runs whenever
  // the chapter changes; a fresh chapter always starts at page 1 unless a
  // resume position was requested for the very first chapter opened.
  useEffect(() => {
    if (!chapter) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPages([]);

    void (async () => {
      try {
        const downloaded = downloads.find((d) => d.chapterId === chapter.id);
        let urls: string[];
        if (downloaded) {
          const loaded = await Promise.all(
            downloaded.pageFiles.map((file, index) =>
              ipc.mangaDownloadReadPage(chapter.id, index).then((b64) => toDataUrl(b64, file)),
            ),
          );
          urls = loaded;
        } else {
          const result = await ipc.mangaOnlineChapterPages(chapter.id);
          urls = result.imageUrls;
        }
        if (cancelled) return;
        setPages(urls);
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter?.id]);

  // Persist reading progress (debounced by a minimum gap) whenever the
  // page changes, and record it into history immediately.
  useEffect(() => {
    if (!chapter || pages.length === 0) return;
    const now = Date.now();
    if (now - lastSentRef.current < 600 && page !== pages.length) return;
    lastSentRef.current = now;
    void recordProgress(
      { id: mangaId, title: mangaTitle, coverUrl },
      { id: chapter.id, label: chapterLabelOf(chapter) },
      page,
      pages.length,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, chapter?.id, pages.length]);

  const goToChapter = (index: number, landingPage: number) => {
    if (index < 0 || index >= ordered.length) return;
    setChapterIndex(index);
    setPage(landingPage);
  };

  const nextChapter = () => goToChapter(chapterIndex + 1, 1);
  const prevChapter = () => goToChapter(chapterIndex - 1, 1);

  const goToPage = (next: number) => {
    if (next < 1) {
      prevChapter();
      return;
    }
    if (next > pages.length) {
      nextChapter();
      return;
    }
    setPage(next);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (mode === "page" && (event.key === "ArrowRight" || event.key === "PageDown")) {
        goToPage(page + 1);
      } else if (mode === "page" && (event.key === "ArrowLeft" || event.key === "PageUp")) {
        goToPage(page - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pages.length, mode]);

  // Continuous-scroll mode: track which page is most in view so the
  // indicator and saved progress stay accurate while scrolling, same idea
  // as the PDF reader's all-pages mode.
  useEffect(() => {
    if (mode !== "scroll") return;
    const container = scrollRef.current;
    if (!container) return;
    const onScroll = () => {
      const children = Array.from(container.querySelectorAll<HTMLElement>("[data-page]"));
      const top = container.getBoundingClientRect().top + 120;
      let closest = 1;
      let closestDistance = Infinity;
      for (const child of children) {
        const distance = Math.abs(child.getBoundingClientRect().top - top);
        if (distance < closestDistance) {
          closestDistance = distance;
          closest = Number(child.dataset.page);
        }
      }
      setPage(closest);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [mode, pages.length]);

  const isBookmarked = bookmarks.some(
    (b) => b.mangaId === mangaId && b.chapterId === chapter?.id && b.page === page,
  );

  const download = async () => {
    if (!chapter) return;
    try {
      await ipc.mangaDownloadChapter(
        mangaId,
        mangaTitle,
        coverUrl,
        chapter.id,
        chapterLabelOf(chapter),
        chapter.translatedLanguage,
      );
      await useOnlineManga.getState().refreshDownloads(mangaId);
      toast.success("Chapter downloaded for offline reading");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  if (!chapter) return null;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-bg">
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">{mangaTitle}</p>
          <p className="truncate text-[11px] text-faint">{chapterLabelOf(chapter)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          {offline && (
            <span title="Reading offline" className="grid h-7 w-7 place-items-center text-faint">
              <WifiOff size={13} strokeWidth={1.8} />
            </span>
          )}
          <button
            type="button"
            onClick={prevChapter}
            disabled={chapterIndex <= 0}
            title="Previous chapter"
            className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink disabled:opacity-30"
          >
            <SkipBack size={13} strokeWidth={1.8} />
          </button>
          {!loading && !error && (
            <>
              <button
                type="button"
                onClick={() => goToPage(page - 1)}
                disabled={mode === "page" && page <= 1 && chapterIndex === 0}
                title="Previous page (←)"
                className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink disabled:opacity-30"
              >
                <ChevronLeft size={14} strokeWidth={1.8} />
              </button>
              <span className="min-w-[52px] text-center text-[11.5px] text-muted">
                {page} / {pages.length}
              </span>
              <button
                type="button"
                onClick={() => goToPage(page + 1)}
                disabled={mode === "page" && page >= pages.length && chapterIndex === ordered.length - 1}
                title="Next page (→)"
                className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink disabled:opacity-30"
              >
                <ChevronRight size={14} strokeWidth={1.8} />
              </button>
            </>
          )}
          <button
            type="button"
            onClick={nextChapter}
            disabled={chapterIndex >= ordered.length - 1}
            title="Next chapter"
            className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink disabled:opacity-30"
          >
            <SkipForward size={13} strokeWidth={1.8} />
          </button>
          <div className="mx-1 h-4 w-px bg-line-soft" />
          <button
            type="button"
            onClick={() => setMode("page")}
            title="Page by page"
            className={cx(
              "grid h-7 w-7 place-items-center rounded-md transition-colors duration-100",
              mode === "page" ? "bg-active text-ink" : "text-faint hover:bg-hover hover:text-ink",
            )}
          >
            <SquareStack size={14} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => setMode("scroll")}
            title="All pages (scroll)"
            className={cx(
              "grid h-7 w-7 place-items-center rounded-md transition-colors duration-100",
              mode === "scroll" ? "bg-active text-ink" : "text-faint hover:bg-hover hover:text-ink",
            )}
          >
            <Rows3 size={14} strokeWidth={1.8} />
          </button>
          <div className="mx-1 h-4 w-px bg-line-soft" />
          <button
            type="button"
            onClick={() =>
              void addBookmark(
                { id: mangaId, title: mangaTitle },
                { id: chapter.id, label: chapterLabelOf(chapter) },
                page,
              )
            }
            title="Bookmark this page"
            className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
          >
            {isBookmarked ? (
              <BookmarkCheck size={14} strokeWidth={1.8} />
            ) : (
              <Bookmark size={14} strokeWidth={1.8} />
            )}
          </button>
          {!offline && (
            <button
              type="button"
              onClick={() => void download()}
              title="Download this chapter for offline reading"
              className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
            >
              <Download size={14} strokeWidth={1.8} />
            </button>
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

      <div ref={scrollRef} className="flex flex-1 flex-col items-center overflow-auto">
        {loading && (
          <div className="flex items-center gap-2 pt-16 text-[12.5px] text-faint">
            <Loader2 size={14} className="animate-spin" />
            Loading chapter…
          </div>
        )}
        {error && (
          <p className="max-w-[340px] pt-16 text-center text-[12.5px] text-faint">
            Couldn't load this chapter: {error}
          </p>
        )}
        {!loading && !error && mode === "page" && pages[page - 1] && (
          <img
            src={pages[page - 1]}
            alt={`Page ${page}`}
            className="max-h-full w-auto max-w-full select-none py-4"
            onClick={(e) => {
              const { left, width } = e.currentTarget.getBoundingClientRect();
              const clickedLeft = e.clientX - left < width / 2;
              goToPage(clickedLeft ? page - 1 : page + 1);
            }}
          />
        )}
        {!loading && !error && mode === "scroll" && (
          <div className="flex w-full max-w-[820px] flex-col items-center gap-2 py-4">
            {pages.map((src, i) => (
              <img
                key={i}
                data-page={i + 1}
                src={src}
                alt={`Page ${i + 1}`}
                loading={Math.abs(i + 1 - page) < 4 ? "eager" : "lazy"}
                className="w-full select-none"
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
