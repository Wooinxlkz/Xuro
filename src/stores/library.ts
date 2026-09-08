import { create } from "zustand";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import type { LibraryItem, LibraryKind, LibrarySearchResult } from "@/lib/types";

export type LibraryViewMode = "list" | "grid" | "bento";

interface LibraryState {
  items: LibraryItem[];
  loaded: boolean;
  viewMode: LibraryViewMode;
  searchKind: LibraryKind;
  searchQuery: string;
  searchResults: LibrarySearchResult[];
  searching: boolean;
  uploading: boolean;

  setViewMode: (mode: LibraryViewMode) => void;
  setSearchKind: (kind: LibraryKind) => void;
  load: () => Promise<void>;
  search: (query: string) => Promise<void>;
  addFromSearch: (result: LibrarySearchResult) => Promise<void>;
  uploadPicked: (title: string, author: string | undefined, kind: LibraryKind) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const oops = (err: unknown) =>
  toast.error(err instanceof Error ? err.message : String(err));

export const useLibrary = create<LibraryState>((set, get) => ({
  items: [],
  loaded: false,
  viewMode: "grid",
  searchKind: "book",
  searchQuery: "",
  searchResults: [],
  searching: false,
  uploading: false,

  setViewMode: (mode) => set({ viewMode: mode }),
  setSearchKind: (kind) => set({ searchKind: kind, searchResults: [] }),

  load: async () => {
    try {
      const items = await ipc.libraryList();
      set({ items, loaded: true });
    } catch (err) {
      oops(err);
      set({ loaded: true });
    }
  },

  search: async (query) => {
    set({ searchQuery: query });
    const trimmed = query.trim();
    if (!trimmed) {
      set({ searchResults: [] });
      return;
    }
    set({ searching: true });
    try {
      const kind = get().searchKind;
      const results =
        kind === "book"
          ? await ipc.librarySearchBooks(trimmed)
          : await ipc.librarySearchManga(trimmed);
      // A slower, now-stale search shouldn't clobber a faster, newer one —
      // only apply results if the query is still what's in the box.
      if (get().searchQuery === query) {
        set({ searchResults: results });
      }
    } catch (err) {
      oops(err);
    } finally {
      set({ searching: false });
    }
  },

  addFromSearch: async (result) => {
    try {
      const item = await ipc.libraryAddFromSearch(result);
      set({ items: [item, ...get().items] });
    } catch (err) {
      oops(err);
    }
  },

  uploadPicked: async (title, author, kind) => {
    set({ uploading: true });
    try {
      const path = await ipc.libraryPickUploadFile();
      if (!path) return;
      const item = await ipc.libraryUpload(path, title, author, kind);
      set({ items: [item, ...get().items] });
    } catch (err) {
      oops(err);
    } finally {
      set({ uploading: false });
    }
  },

  remove: async (id) => {
    try {
      await ipc.libraryRemove(id);
      set({ items: get().items.filter((item) => item.id !== id) });
    } catch (err) {
      oops(err);
    }
  },
}));
