import { create } from "zustand";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import type { Template } from "@/lib/types";

interface TemplatesState {
  templates: Template[];
  loaded: boolean;
  load: () => Promise<void>;
  add: (title: string, content: string) => Promise<void>;
  update: (id: string, title: string, content: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Create a new note from a template, returning its rel path (or null on failure). */
  createNoteFrom: (id: string, dir: string, title: string) => Promise<string | null>;
}

const oops = (err: unknown) =>
  toast.error(err instanceof Error ? err.message : String(err));

export const useTemplates = create<TemplatesState>((set, get) => ({
  templates: [],
  loaded: false,

  load: async () => {
    try {
      const templates = await ipc.templatesList();
      set({ templates, loaded: true });
    } catch (err) {
      oops(err);
      set({ loaded: true });
    }
  },

  add: async (title, content) => {
    try {
      const created = await ipc.templateAdd(title, content);
      set({ templates: [created, ...get().templates] });
    } catch (err) {
      oops(err);
    }
  },

  update: async (id, title, content) => {
    try {
      const updated = await ipc.templateUpdate(id, title, content);
      set({ templates: get().templates.map((t) => (t.id === id ? updated : t)) });
    } catch (err) {
      oops(err);
    }
  },

  remove: async (id) => {
    const prev = get().templates;
    set({ templates: prev.filter((t) => t.id !== id) });
    try {
      await ipc.templateDelete(id);
    } catch (err) {
      set({ templates: prev });
      oops(err);
    }
  },

  createNoteFrom: async (id, dir, title) => {
    try {
      return await ipc.templateCreateNote(id, dir, title);
    } catch (err) {
      oops(err);
      return null;
    }
  },
}));
