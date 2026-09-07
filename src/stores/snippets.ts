import { create } from "zustand";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import type { Snippet } from "@/lib/types";

interface SnippetsState {
  snippets: Snippet[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (title: string, language: string, content: string) => Promise<void>;
  update: (id: string, title: string, language: string, content: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const oops = (err: unknown) =>
  toast.error(err instanceof Error ? err.message : String(err));

export const useSnippets = create<SnippetsState>((set, get) => ({
  snippets: [],
  loaded: false,

  load: async () => {
    try {
      const snippets = await ipc.snippetsList();
      set({ snippets, loaded: true });
    } catch (err) {
      oops(err);
      set({ loaded: true });
    }
  },

  add: async (title, language, content) => {
    try {
      const created = await ipc.snippetAdd(title, language, content);
      set({ snippets: [created, ...get().snippets] });
    } catch (err) {
      oops(err);
    }
  },

  update: async (id, title, language, content) => {
    try {
      const updated = await ipc.snippetUpdate(id, title, language, content);
      set({ snippets: get().snippets.map((s) => (s.id === id ? updated : s)) });
    } catch (err) {
      oops(err);
    }
  },

  remove: async (id) => {
    const prev = get().snippets;
    set({ snippets: prev.filter((s) => s.id !== id) });
    try {
      await ipc.snippetDelete(id);
    } catch (err) {
      set({ snippets: prev });
      oops(err);
    }
  },
}));
