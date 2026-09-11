import {
  BookOpen,
  Check,
  ChevronDown,
  Download,
  Heart,
  Loader2,
  Play,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { ipc } from "@/lib/ipc";
import { MANGA_LANGUAGES, type MangaChapter, type MangaLanguage } from "@/lib/types";
import { chapterLabelOf } from "@/lib/mangaOrder";
import { cx } from "@/lib/utils";
import { useOnlineManga } from "@/stores/onlineManga";
import { MangaReader } from "./MangaReader";

export function MangaDetailsPanel({ onClose }: { onClose: () => void }) {
  const details = useOnlineManga((s) => s.activeMangaDetails);
  const loading = useOnlineManga((s) => s.activeMangaLoading);
  const chapters = useOnlineManga((s) => s.chapters);
  const chaptersLoading = useOnlineManga((s) => s.chaptersLoading);
  const chapterLanguage = useOnlineManga((s) => s.chapterLanguage);
  const loadChapters = useOnlineManga((s) => s.loadChapters);
  const isFollowing = useOnlineManga((s) => s.isFollowing);
  const toggleFollow = useOnlineManga((s) => s.toggleFollow);
  const toggleFavorite = useOnlineManga((s) => s.toggleFavorite);
  const follows = useOnlineManga((s) => s.follows);
  const progressFor = useOnlineManga((s) => s.progressFor);
  const downloads = useOnlineManga((s) => s.downloads);
  const removeDownload = useOnlineManga((s) => s.removeDownload);
  const bookmarks = useOnlineManga((s) => s.bookmarks);

  const [readingChapterId, setReadingChapterId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  if (loading || !details) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-bg">
        <Loader2 size={18} className="animate-spin text-faint" />
      </div>
    );
  }

  const following = isFollowing(details.id);
  const favorite = follows.find((f) => f.mangaId === details.id)?.isFavorite ?? false;
  const progress = progressFor(details.id);
  const mangaDownloads = downloads.filter((d) => d.mangaId === details.id);

  const downloadChapter = async (chapter: MangaChapter) => {
    setDownloadingId(chapter.id);
    try {
      await ipc.mangaDownloadChapter(
        details.id,
        details.title,
        details.coverUrl,
        chapter.id,
        chapterLabelOf(chapter),
        chapter.translatedLanguage,
      );
      await useOnlineManga.getState().refreshDownloads(details.id);
      toast.success("Downloaded for offline reading");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-40 overflow-auto bg-bg">
      <div className="mx-auto w-full max-w-[820px] px-6 pb-24 pt-6">
        <button
          type="button"
          onClick={onClose}
          className="mb-4 grid h-7 w-7 place-items-center rounded-md text-faint hover:bg-hover hover:text-ink"
          aria-label="Close"
        >
          <X size={15} strokeWidth={1.8} />
        </button>

        <div className="flex gap-5">
          <div className="h-[220px] w-[150px] shrink-0 overflow-hidden rounded-lg bg-panel">
            {details.coverUrl && (
              <img src={details.coverUrl} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold leading-tight text-ink">{details.title}</h1>
            {details.altTitles[0] && (
              <p className="mt-0.5 truncate text-[12px] text-faint">{details.altTitles[0]}</p>
            )}
            {details.authors.length > 0 && (
              <p className="mt-1 text-[12px] text-muted">{details.authors.join(", ")}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {details.tags.slice(0, 6).map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-line-soft px-2 py-0.5 text-[10.5px] text-faint"
                >
                  {tag}
                </span>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button size="sm" variant={following ? "secondary" : "primary"} onClick={() => void toggleFollow(details)}>
                {following ? <Check size={13} strokeWidth={2} /> : <Play size={13} strokeWidth={2} />}
                {following ? "Following" : "Follow"}
              </Button>
              <Button
                size="icon"
                variant={favorite ? "secondary" : "ghost"}
                onClick={() => void toggleFavorite(details)}
                title={favorite ? "Remove from favorites" : "Add to favorites"}
              >
                <Heart size={14} strokeWidth={2} fill={favorite ? "currentColor" : "none"} />
              </Button>
              {details.status && (
                <span className="text-[11px] capitalize text-faint">{details.status}</span>
              )}
              {details.year && <span className="text-[11px] text-faint">· {details.year}</span>}
            </div>
            {progress && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                onClick={() => setReadingChapterId(progress.chapterId)}
              >
                <Play size={13} strokeWidth={2} />
                Continue — {progress.chapterLabel} (p.{progress.page})
              </Button>
            )}
          </div>
        </div>

        {details.description && (
          <p className="mt-4 whitespace-pre-line text-[12.5px] leading-relaxed text-muted">
            {details.description}
          </p>
        )}

        <div className="mt-6 flex items-center justify-between">
          <p className="text-[10.5px] font-semibold uppercase tracking-wide text-faint">Chapters</p>
          <LanguagePicker
            value={chapterLanguage}
            available={details.availableLanguages}
            onChange={(lang) => void loadChapters(lang)}
          />
        </div>

        <div className="mt-2 flex flex-col divide-y divide-line-soft rounded-xl border border-line-soft bg-panel">
          {chaptersLoading ? (
            <div className="flex items-center gap-2 p-4 text-[12px] text-faint">
              <Loader2 size={13} className="animate-spin" />
              Loading chapters…
            </div>
          ) : chapters.length === 0 ? (
            <p className="p-4 text-center text-[12px] text-faint">
              No chapters in this language yet.
            </p>
          ) : (
            chapters.map((chapter) => {
              const isDownloaded = mangaDownloads.some((d) => d.chapterId === chapter.id);
              const chapterBookmarks = bookmarks.filter((b) => b.chapterId === chapter.id);
              const label = chapterLabelOf(chapter);
              return (
                <div key={chapter.id} className="flex items-center gap-2 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-ink">{label}</p>
                    <p className="truncate text-[10.5px] text-faint">
                      {chapter.scanlationGroup ?? "Unknown group"}
                      {chapterBookmarks.length > 0 && ` · ${chapterBookmarks.length} bookmark${chapterBookmarks.length > 1 ? "s" : ""}`}
                    </p>
                  </div>
                  {isDownloaded && (
                    <span title="Downloaded" className="grid h-6 w-6 place-items-center text-faint">
                      <WifiOff size={12} strokeWidth={1.8} />
                    </span>
                  )}
                  {chapter.external ? (
                    <span className="text-[10.5px] text-faint">External</span>
                  ) : (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => setReadingChapterId(chapter.id)}>
                        <BookOpen size={12} strokeWidth={2} />
                        Read
                      </Button>
                      {isDownloaded ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => void removeDownload(chapter.id)}
                          title="Remove download"
                        >
                          <Trash2 size={12} strokeWidth={2} />
                        </Button>
                      ) : (
                        <Button
                          size="icon"
                          variant="ghost"
                          loading={downloadingId === chapter.id}
                          onClick={() => void downloadChapter(chapter)}
                          title="Download for offline reading"
                        >
                          <Download size={12} strokeWidth={2} />
                        </Button>
                      )}
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {readingChapterId && (
        <MangaReader
          mangaId={details.id}
          mangaTitle={details.title}
          coverUrl={details.coverUrl}
          chapters={chapters}
          startChapterId={readingChapterId}
          startPage={progress?.chapterId === readingChapterId ? progress.page : undefined}
          onClose={() => setReadingChapterId(null)}
        />
      )}
    </div>
  );
}

function LanguagePicker({
  value,
  available,
  onChange,
}: {
  value: MangaLanguage | undefined;
  available: string[];
  onChange: (value: MangaLanguage | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const codeMap: Record<MangaLanguage, string[]> = {
    english: ["en"],
    spanish: ["es", "es-la"],
    arabic: ["ar"],
    japanese: ["ja"],
  };
  const options = MANGA_LANGUAGES.filter((l) => codeMap[l.value].some((c) => available.includes(c)));

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-line-soft px-2 py-1 text-[11px] text-ink hover:bg-hover"
      >
        {value ? MANGA_LANGUAGES.find((l) => l.value === value)?.label : "All languages"}
        <ChevronDown size={11} strokeWidth={2} />
      </button>
      {open && (
        <div className="absolute right-0 z-10 mt-1 min-w-[140px] rounded-lg border border-line-soft bg-panel p-1 shadow-md shadow-black/10">
          <button
            type="button"
            onClick={() => {
              onChange(undefined);
              setOpen(false);
            }}
            className={cx(
              "block w-full rounded px-2 py-1 text-left text-[11.5px] hover:bg-hover",
              !value && "text-ink font-medium",
            )}
          >
            All languages
          </button>
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={cx(
                "block w-full rounded px-2 py-1 text-left text-[11.5px] hover:bg-hover",
                value === option.value && "text-ink font-medium",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
