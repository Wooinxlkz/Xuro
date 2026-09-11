import { create } from "zustand";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import type {
  DownloadedChapter,
  MangaBookmarkEntry,
  MangaBrowseParams,
  MangaChapter,
  MangaDetails,
  MangaFollow,
  MangaHistoryEntry,
  MangaLanguage,
  MangaReadingProgress,
  MangaSort,
  MangaSummary,
  MangaTag,
} from "@/lib/types";

export type OnlineMangaSection = "discover" | "following" | "history" | "downloads";

interface BrowseFilters {
  query: string;
  language: MangaLanguage | undefined;
  genreIds: string[];
  status: string | undefined;
  sort: MangaSort;
}

const DEFAULT_FILTERS: BrowseFilters = {
  query: "",
  language: undefined,
  genreIds: [],
  status: undefined,
  sort: "latest",
};

const oops = (err: unknown) => toast.error(err instanceof Error ? err.message : String(err));

interface OnlineMangaState {
  initialized: boolean;
  section: OnlineMangaSection;

  filters: BrowseFilters;
  results: MangaSummary[];
  page: number;
  hasMore: boolean;
  browsing: boolean;

  genres: MangaTag[];

  follows: MangaFollow[];
  history: MangaHistoryEntry[];
  downloads: DownloadedChapter[];
  progress: MangaReadingProgress[];
  checkingUpdates: boolean;

  activeMangaId: string | null;
  activeMangaDetails: MangaDetails | null;
  activeMangaLoading: boolean;
  chapters: MangaChapter[];
  chaptersLoading: boolean;
  chapterLanguage: MangaLanguage | undefined;

  bookmarks: MangaBookmarkEntry[];

  setSection: (section: OnlineMangaSection) => void;
  init: () => Promise<void>;

  setFilter: <K extends keyof BrowseFilters>(key: K, value: BrowseFilters[K]) => void;
  toggleGenre: (id: string) => void;
  runBrowse: (page?: number) => Promise<void>;
  loadMore: () => Promise<void>;

  openManga: (id: string) => Promise<void>;
  closeManga: () => void;
  loadChapters: (language: MangaLanguage | undefined) => Promise<void>;

  isFollowing: (mangaId: string) => boolean;
  toggleFollow: (manga: MangaSummary | MangaDetails) => Promise<void>;
  toggleFavorite: (manga: MangaSummary | MangaDetails) => Promise<void>;
  refreshUpdates: () => Promise<void>;

  progressFor: (mangaId: string) => MangaReadingProgress | undefined;
  recordProgress: (
    manga: { id: string; title: string; coverUrl: string | null },
    chapter: { id: string; label: string },
    page: number,
    pageCount: number,
  ) => Promise<void>;

  clearHistory: () => Promise<void>;
  markAllUpdatesSeen: () => Promise<void>;

  loadBookmarksFor: (mangaId: string) => Promise<void>;
  addBookmark: (
    manga: { id: string; title: string },
    chapter: { id: string; label: string },
    page: number,
  ) => Promise<void>;
  removeBookmark: (id: string) => Promise<void>;

  refreshDownloads: (mangaId?: string) => Promise<void>;
  removeDownload: (chapterId: string) => Promise<void>;
}

export const useOnlineManga = create<OnlineMangaState>((set, get) => ({
  initialized: false,
  section: "discover",

  filters: DEFAULT_FILTERS,
  results: [],
  page: 0,
  hasMore: false,
  browsing: false,

  genres: [],

  follows: [],
  history: [],
  downloads: [],
  progress: [],
  checkingUpdates: false,

  activeMangaId: null,
  activeMangaDetails: null,
  activeMangaLoading: false,
  chapters: [],
  chaptersLoading: false,
  chapterLanguage: undefined,

  bookmarks: [],

  setSection: (section) => set({ section }),

  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });
    try {
      const [genres, follows, history, downloads, progress] = await Promise.all([
        ipc.mangaOnlineGenres().catch(() => []),
        ipc.mangaFollowsList().catch(() => []),
        ipc.mangaHistoryList().catch(() => []),
        ipc.mangaDownloadsList().catch(() => []),
        ipc.mangaProgressList().catch(() => []),
      ]);
      set({ genres, follows, history, downloads, progress });
      void get().runBrowse(0);
      void get().refreshUpdates();
    } catch (err) {
      oops(err);
    }
  },

  setFilter: (key, value) => {
    set({ filters: { ...get().filters, [key]: value } });
    void get().runBrowse(0);
  },

  toggleGenre: (id) => {
    const current = get().filters.genreIds;
    const next = current.includes(id) ? current.filter((g) => g !== id) : [...current, id];
    set({ filters: { ...get().filters, genreIds: next } });
    void get().runBrowse(0);
  },

  runBrowse: async (page = 0) => {
    const { filters } = get();
    set({ browsing: true });
    const params: MangaBrowseParams = {
      query: filters.query.trim() || undefined,
      language: filters.language,
      genreIds: filters.genreIds,
      status: filters.status,
      sort: filters.sort,
      page,
    };
    try {
      const result = await ipc.mangaOnlineBrowse(params);
      set({
        results: page === 0 ? result.items : [...get().results, ...result.items],
        page: result.page,
        hasMore: result.hasMore,
      });
    } catch (err) {
      oops(err);
    } finally {
      set({ browsing: false });
    }
  },

  loadMore: async () => {
    if (!get().hasMore || get().browsing) return;
    await get().runBrowse(get().page + 1);
  },

  openManga: async (id) => {
    set({
      activeMangaId: id,
      activeMangaDetails: null,
      activeMangaLoading: true,
      chapters: [],
      chapterLanguage: get().filters.language,
    });
    try {
      const details = await ipc.mangaOnlineDetails(id);
      set({ activeMangaDetails: details, activeMangaLoading: false });
      void get().loadChapters(get().chapterLanguage);
      void get().loadBookmarksFor(id);
      void ipc.mangaMarkSeen(id).then(() => {
        set({ follows: get().follows.map((f) => (f.mangaId === id ? { ...f, hasUpdate: false } : f)) });
      });
    } catch (err) {
      oops(err);
      set({ activeMangaLoading: false });
    }
  },

  closeManga: () => set({ activeMangaId: null, activeMangaDetails: null, chapters: [] }),

  loadChapters: async (language) => {
    const mangaId = get().activeMangaId;
    if (!mangaId) return;
    set({ chaptersLoading: true, chapterLanguage: language });
    try {
      const chapters = await ipc.mangaOnlineChapters(mangaId, language, 0);
      set({ chapters });
    } catch (err) {
      oops(err);
    } finally {
      set({ chaptersLoading: false });
    }
  },

  isFollowing: (mangaId) => get().follows.some((f) => f.mangaId === mangaId),

  toggleFollow: async (manga) => {
    const following = get().isFollowing(manga.id);
    try {
      if (following) {
        await ipc.mangaUnfollow(manga.id);
        set({ follows: get().follows.filter((f) => f.mangaId !== manga.id) });
      } else {
        const entry = await ipc.mangaFollow(manga.id, manga.title, manga.coverUrl);
        set({ follows: [entry, ...get().follows] });
      }
    } catch (err) {
      oops(err);
    }
  },

  // Favoriting is meant to work as a one-click "save this" from anywhere,
  // even for a manga the person hasn't explicitly followed yet — so if
  // there's no follow entry to flip the flag on, this quietly creates one
  // first instead of doing nothing (the bug: clicking the star before
  // following silently no-op'd, because favorite state lived on the
  // follow record).
  toggleFavorite: async (manga) => {
    try {
      let current = get().follows.find((f) => f.mangaId === manga.id);
      if (!current) {
        current = await ipc.mangaFollow(manga.id, manga.title, manga.coverUrl);
        set({ follows: [current, ...get().follows] });
      }
      const updated = await ipc.mangaSetFavorite(manga.id, !current.isFavorite);
      set({ follows: get().follows.map((f) => (f.mangaId === manga.id ? updated : f)) });
    } catch (err) {
      oops(err);
    }
  },

  refreshUpdates: async () => {
    if (get().follows.length === 0 || get().checkingUpdates) return;
    set({ checkingUpdates: true });
    try {
      const follows = await ipc.mangaCheckUpdates();
      set({ follows });
    } catch {
      // Best-effort — a failed update sweep shouldn't interrupt browsing.
    } finally {
      set({ checkingUpdates: false });
    }
  },

  progressFor: (mangaId) => get().progress.find((p) => p.mangaId === mangaId),

  recordProgress: async (manga, chapter, page, pageCount) => {
    try {
      const entry = await ipc.mangaProgressSet(
        manga.id,
        manga.title,
        manga.coverUrl,
        chapter.id,
        chapter.label,
        page,
        pageCount,
      );
      set({
        progress: [entry, ...get().progress.filter((p) => p.mangaId !== manga.id)],
        history: [
          {
            mangaId: manga.id,
            mangaTitle: manga.title,
            coverUrl: manga.coverUrl,
            chapterId: chapter.id,
            chapterLabel: chapter.label,
            readAt: entry.updatedAt,
          },
          ...get().history.filter((h) => h.mangaId !== manga.id),
        ],
      });
    } catch {
      // Best-effort — not worth interrupting reading over.
    }
  },

  clearHistory: async () => {
    try {
      await ipc.mangaHistoryClear();
      set({ history: [] });
    } catch (err) {
      oops(err);
    }
  },

  // "Following" groups manga with a new chapter under its own heading —
  // this clears that whole group in one tap instead of opening each manga
  // just to dismiss its badge.
  markAllUpdatesSeen: async () => {
    const updated = get().follows.filter((f) => f.hasUpdate);
    if (updated.length === 0) return;
    try {
      await Promise.all(updated.map((f) => ipc.mangaMarkSeen(f.mangaId)));
      set({
        follows: get().follows.map((f) => (f.hasUpdate ? { ...f, hasUpdate: false } : f)),
      });
    } catch (err) {
      oops(err);
    }
  },

  loadBookmarksFor: async (mangaId) => {
    try {
      const bookmarks = await ipc.mangaBookmarksList(mangaId);
      set({ bookmarks });
    } catch {
      // non-critical
    }
  },

  addBookmark: async (manga, chapter, page) => {
    try {
      const entry = await ipc.mangaBookmarkAdd(manga.id, manga.title, chapter.id, chapter.label, page);
      set({ bookmarks: [entry, ...get().bookmarks] });
      toast.success("Bookmarked");
    } catch (err) {
      oops(err);
    }
  },

  removeBookmark: async (id) => {
    try {
      await ipc.mangaBookmarkRemove(id);
      set({ bookmarks: get().bookmarks.filter((b) => b.id !== id) });
    } catch (err) {
      oops(err);
    }
  },

  refreshDownloads: async (mangaId) => {
    try {
      const downloads = await ipc.mangaDownloadsList(mangaId);
      if (mangaId) {
        set({ downloads: [...get().downloads.filter((d) => d.mangaId !== mangaId), ...downloads] });
      } else {
        set({ downloads });
      }
    } catch (err) {
      oops(err);
    }
  },

  removeDownload: async (chapterId) => {
    try {
      await ipc.mangaDownloadRemove(chapterId);
      set({ downloads: get().downloads.filter((d) => d.chapterId !== chapterId) });
    } catch (err) {
      oops(err);
    }
  },
}));
