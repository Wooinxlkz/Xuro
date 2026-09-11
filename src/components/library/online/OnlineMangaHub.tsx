import {
  BookOpen,
  Clock,
  Compass,
  Heart,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  WifiOff,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MANGA_LANGUAGES, type MangaLanguage, type MangaSort, type MangaSummary } from "@/lib/types";
import { cx } from "@/lib/utils";
import { useOnlineManga, type OnlineMangaSection } from "@/stores/onlineManga";
import { MangaDetailsPanel } from "./MangaDetailsPanel";
import { MangaReader } from "./MangaReader";

const SECTIONS: Array<{ key: OnlineMangaSection; label: string; icon: typeof Compass }> = [
  { key: "discover", label: "Discover", icon: Compass },
  { key: "following", label: "Following", icon: Heart },
  { key: "history", label: "History", icon: Clock },
  { key: "downloads", label: "Downloads", icon: WifiOff },
];

const SORTS: Array<{ value: MangaSort; label: string }> = [
  { value: "latest", label: "Latest updates" },
  { value: "popular", label: "Most popular" },
  { value: "newest", label: "Newest" },
  { value: "titleAsc", label: "Title A–Z" },
  { value: "rating", label: "Top rated" },
];

const STATUSES = [
  { value: "", label: "Any status" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "hiatus", label: "Hiatus" },
  { value: "cancelled", label: "Cancelled" },
];

export function OnlineMangaHub() {
  const init = useOnlineManga((s) => s.init);
  const section = useOnlineManga((s) => s.section);
  const setSection = useOnlineManga((s) => s.setSection);
  const activeMangaId = useOnlineManga((s) => s.activeMangaId);
  const closeManga = useOnlineManga((s) => s.closeManga);

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <div className="relative flex-1">
      <div className="mb-3 flex items-center gap-1 rounded-lg border border-line-soft bg-panel p-0.5">
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            className={cx(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] transition-colors duration-100",
              section === key ? "bg-active text-ink font-medium" : "text-faint hover:text-ink",
            )}
          >
            <Icon size={13} strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </div>

      {section === "discover" && <DiscoverSection />}
      {section === "following" && <FollowingSection />}
      {section === "history" && <HistorySection />}
      {section === "downloads" && <DownloadsSection />}

      {activeMangaId && <MangaDetailsPanel onClose={closeManga} />}
    </div>
  );
}

function MangaCard({ manga, onOpen }: { manga: MangaSummary; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="group flex flex-col gap-1.5 text-left">
      <div className="aspect-[2/3] w-full overflow-hidden rounded-md bg-panel">
        {manga.coverUrl ? (
          <img
            src={manga.coverUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-150 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <BookOpen size={18} strokeWidth={1.5} className="text-faint" />
          </div>
        )}
      </div>
      <p className="line-clamp-2 text-[11.5px] font-medium leading-tight text-ink">{manga.title}</p>
      {manga.lastChapter && (
        <p className="truncate text-[10px] text-faint">Ch. {manga.lastChapter}</p>
      )}
    </button>
  );
}

function DiscoverSection() {
  const filters = useOnlineManga((s) => s.filters);
  const setFilter = useOnlineManga((s) => s.setFilter);
  const toggleGenre = useOnlineManga((s) => s.toggleGenre);
  const genres = useOnlineManga((s) => s.genres);
  const results = useOnlineManga((s) => s.results);
  const browsing = useOnlineManga((s) => s.browsing);
  const hasMore = useOnlineManga((s) => s.hasMore);
  const loadMore = useOnlineManga((s) => s.loadMore);
  const openManga = useOnlineManga((s) => s.openManga);
  const [genresOpen, setGenresOpen] = useState(false);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={13}
            strokeWidth={2}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          />
          <Input
            value={filters.query}
            placeholder="Search online manga…"
            className="pl-8"
            onChange={(e) => setFilter("query", e.target.value)}
          />
        </div>
        <select
          value={filters.language ?? ""}
          onChange={(e) => setFilter("language", (e.target.value || undefined) as MangaLanguage | undefined)}
          className="h-9 rounded-lg border border-line-soft bg-panel px-2 text-[12px] text-ink"
        >
          <option value="">All languages</option>
          {MANGA_LANGUAGES.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
        <select
          value={filters.status ?? ""}
          onChange={(e) => setFilter("status", e.target.value || undefined)}
          className="h-9 rounded-lg border border-line-soft bg-panel px-2 text-[12px] text-ink"
        >
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          value={filters.sort}
          onChange={(e) => setFilter("sort", e.target.value as MangaSort)}
          className="h-9 rounded-lg border border-line-soft bg-panel px-2 text-[12px] text-ink"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <Button size="md" variant="secondary" onClick={() => setGenresOpen((v) => !v)}>
          Genres{filters.genreIds.length > 0 ? ` (${filters.genreIds.length})` : ""}
        </Button>
      </div>

      {genresOpen && (
        <div className="mb-3 flex flex-wrap gap-1.5 rounded-xl border border-line-soft bg-panel p-2.5">
          {genres.map((genre) => (
            <button
              key={genre.id}
              type="button"
              onClick={() => toggleGenre(genre.id)}
              className={cx(
                "rounded-full border px-2.5 py-1 text-[11px] transition-colors duration-100",
                filters.genreIds.includes(genre.id)
                  ? "border-invert bg-invert text-invert-ink"
                  : "border-line-soft text-faint hover:text-ink",
              )}
            >
              {genre.name}
            </button>
          ))}
          {genres.length === 0 && <p className="text-[11.5px] text-faint">Loading genres…</p>}
        </div>
      )}

      {results.length === 0 && !browsing ? (
        <p className="py-16 text-center text-[12px] text-faint">
          No manga matched — try a different search or fewer filters.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
          {results.map((manga) => (
            <MangaCard key={manga.id} manga={manga} onOpen={() => void openManga(manga.id)} />
          ))}
        </div>
      )}

      {browsing && (
        <div className="flex items-center justify-center gap-2 py-6 text-[12px] text-faint">
          <Loader2 size={14} className="animate-spin" />
          Loading…
        </div>
      )}
      {!browsing && hasMore && (
        <div className="flex justify-center py-4">
          <Button size="sm" variant="secondary" onClick={() => void loadMore()}>
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}

function FollowingSection() {
  const follows = useOnlineManga((s) => s.follows);
  const openManga = useOnlineManga((s) => s.openManga);
  const refreshUpdates = useOnlineManga((s) => s.refreshUpdates);
  const checkingUpdates = useOnlineManga((s) => s.checkingUpdates);

  const favorites = follows.filter((f) => f.isFavorite);
  const updated = follows.filter((f) => f.hasUpdate);
  const rest = follows.filter((f) => !f.isFavorite && !f.hasUpdate);

  if (follows.length === 0) {
    return (
      <p className="py-16 text-center text-[12px] text-faint">
        Follow a manga from Discover to track its updates here.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex justify-end">
        <Button size="sm" variant="secondary" loading={checkingUpdates} onClick={() => void refreshUpdates()}>
          <RefreshCw size={12} strokeWidth={2} />
          Check for updates
        </Button>
      </div>
      {updated.length > 0 && (
        <FollowGroup title="New chapters" items={updated} onOpen={openManga} />
      )}
      {favorites.length > 0 && <FollowGroup title="Favorites" items={favorites} onOpen={openManga} />}
      <FollowGroup title="Following" items={rest} onOpen={openManga} />
    </div>
  );
}

function FollowGroup({
  title,
  items,
  onOpen,
}: {
  title: string;
  items: ReturnType<typeof useOnlineManga.getState>["follows"];
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-5">
      <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-faint">{title}</p>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {items.map((follow) => (
          <button
            key={follow.mangaId}
            type="button"
            onClick={() => onOpen(follow.mangaId)}
            className="group relative flex flex-col gap-1.5 text-left"
          >
            {follow.hasUpdate && (
              <span className="absolute right-1.5 top-1.5 z-10 h-2.5 w-2.5 rounded-full bg-invert ring-2 ring-bg" />
            )}
            <div className="aspect-[2/3] w-full overflow-hidden rounded-md bg-panel">
              {follow.coverUrl ? (
                <img src={follow.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <BookOpen size={18} strokeWidth={1.5} className="text-faint" />
                </div>
              )}
            </div>
            <p className="line-clamp-2 text-[11.5px] font-medium leading-tight text-ink">
              {follow.title}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
}

function HistorySection() {
  const history = useOnlineManga((s) => s.history);
  const clearHistory = useOnlineManga((s) => s.clearHistory);
  const openManga = useOnlineManga((s) => s.openManga);

  if (history.length === 0) {
    return <p className="py-16 text-center text-[12px] text-faint">Nothing read yet.</p>;
  }

  return (
    <div>
      <div className="mb-2 flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => void clearHistory()}>
          <Trash2 size={12} strokeWidth={2} />
          Clear history
        </Button>
      </div>
      <div className="flex flex-col divide-y divide-line-soft rounded-xl border border-line-soft bg-panel">
        {history.map((entry) => (
          <button
            key={`${entry.mangaId}-${entry.readAt}`}
            type="button"
            onClick={() => void openManga(entry.mangaId)}
            className="flex items-center gap-3 px-3 py-2 text-left hover:bg-hover"
          >
            <div className="h-12 w-9 shrink-0 overflow-hidden rounded bg-sunken">
              {entry.coverUrl && <img src={entry.coverUrl} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] font-medium text-ink">{entry.mangaTitle}</p>
              <p className="truncate text-[11px] text-faint">{entry.chapterLabel}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function DownloadsSection() {
  const downloads = useOnlineManga((s) => s.downloads);
  const removeDownload = useOnlineManga((s) => s.removeDownload);
  const [readingChapter, setReadingChapter] = useState<
    { mangaId: string; mangaTitle: string; coverUrl: string | null; chapterId: string } | null
  >(null);

  if (downloads.length === 0) {
    return (
      <p className="py-16 text-center text-[12px] text-faint">
        Nothing downloaded yet — open a chapter and tap the download icon to read it offline.
      </p>
    );
  }

  const groups = new Map<string, typeof downloads>();
  for (const d of downloads) {
    groups.set(d.mangaId, [...(groups.get(d.mangaId) ?? []), d]);
  }

  return (
    <div className="flex flex-col gap-5">
      {[...groups.entries()].map(([mangaId, chapters]) => (
        <div key={mangaId}>
          <p className="mb-2 flex items-center gap-2 text-[12.5px] font-medium text-ink">
            {chapters[0].mangaTitle}
            <span className="text-[10.5px] font-normal text-faint">
              {chapters.length} chapter{chapters.length > 1 ? "s" : ""} offline
            </span>
          </p>
          <div className="flex flex-col divide-y divide-line-soft rounded-xl border border-line-soft bg-panel">
            {chapters.map((chapter) => (
              <div key={chapter.chapterId} className="flex items-center gap-3 px-3 py-2">
                <p className="min-w-0 flex-1 truncate text-[12px] text-ink">{chapter.chapterLabel}</p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    setReadingChapter({
                      mangaId: chapter.mangaId,
                      mangaTitle: chapter.mangaTitle,
                      coverUrl: chapter.coverUrl,
                      chapterId: chapter.chapterId,
                    })
                  }
                >
                  <BookOpen size={12} strokeWidth={2} />
                  Read
                </Button>
                <Button size="icon" variant="ghost" onClick={() => void removeDownload(chapter.chapterId)}>
                  <Trash2 size={12} strokeWidth={2} />
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {readingChapter && (
        <MangaReader
          mangaId={readingChapter.mangaId}
          mangaTitle={readingChapter.mangaTitle}
          coverUrl={readingChapter.coverUrl}
          chapters={downloads
            .filter((d) => d.mangaId === readingChapter.mangaId)
            .map((d) => ({
              id: d.chapterId,
              chapter: d.chapterLabel.match(/Ch\. ([\d.]+)/)?.[1] ?? null,
              title: null,
              translatedLanguage: d.language,
              pages: d.pageFiles.length,
              publishAt: null,
              scanlationGroup: null,
              external: false,
            }))}
          startChapterId={readingChapter.chapterId}
          onClose={() => setReadingChapter(null)}
        />
      )}
    </div>
  );
}
