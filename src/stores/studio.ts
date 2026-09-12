import { create } from "zustand";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import type { StudioChapter, StudioProject, StudioProjectSummary } from "@/lib/types";

const oops = (err: unknown) => toast.error(err instanceof Error ? err.message : String(err));

interface StudioState {
  projects: StudioProjectSummary[];
  loaded: boolean;
  activeProject: StudioProject | null;
  activeChapterId: string | null;

  load: () => Promise<void>;
  createProject: (title: string) => Promise<StudioProject | null>;
  openProject: (id: string) => Promise<void>;
  closeProject: () => void;
  renameProject: (id: string, title: string) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;

  selectChapter: (id: string) => void;
  addChapter: () => Promise<void>;
  updateChapter: (
    chapterId: string,
    title: string,
    content: string,
    wordCount: number,
  ) => Promise<StudioChapter | null>;
  deleteChapter: (chapterId: string) => Promise<void>;
  reorderChapters: (orderedIds: string[]) => Promise<void>;
}

export const useStudio = create<StudioState>((set, get) => ({
  projects: [],
  loaded: false,
  activeProject: null,
  activeChapterId: null,

  load: async () => {
    try {
      const projects = await ipc.studioList();
      set({ projects, loaded: true });
    } catch (err) {
      oops(err);
      set({ loaded: true });
    }
  },

  createProject: async (title) => {
    try {
      const project = await ipc.studioCreate(title);
      await get().load();
      return project;
    } catch (err) {
      oops(err);
      return null;
    }
  },

  openProject: async (id) => {
    set({ activeProject: null, activeChapterId: null });
    try {
      const project = await ipc.studioGet(id);
      set({ activeProject: project, activeChapterId: project.chapters[0]?.id ?? null });
    } catch (err) {
      oops(err);
    }
  },

  closeProject: () => set({ activeProject: null, activeChapterId: null }),

  renameProject: async (id, title) => {
    try {
      const summary = await ipc.studioRename(id, title);
      set({
        projects: get().projects.map((p) => (p.id === id ? summary : p)),
        activeProject:
          get().activeProject?.id === id
            ? { ...get().activeProject!, title: summary.title }
            : get().activeProject,
      });
    } catch (err) {
      oops(err);
    }
  },

  deleteProject: async (id) => {
    try {
      await ipc.studioDelete(id);
      set({
        projects: get().projects.filter((p) => p.id !== id),
        activeProject: get().activeProject?.id === id ? null : get().activeProject,
        activeChapterId: get().activeProject?.id === id ? null : get().activeChapterId,
      });
    } catch (err) {
      oops(err);
    }
  },

  selectChapter: (id) => set({ activeChapterId: id }),

  addChapter: async () => {
    const project = get().activeProject;
    if (!project) return;
    try {
      const chapter = await ipc.studioAddChapter(project.id, "");
      set({
        activeProject: { ...project, chapters: [...project.chapters, chapter] },
        activeChapterId: chapter.id,
      });
    } catch (err) {
      oops(err);
    }
  },

  updateChapter: async (chapterId, title, content, wordCount) => {
    const project = get().activeProject;
    if (!project) return null;
    try {
      const updated = await ipc.studioUpdateChapter(project.id, chapterId, title, content, wordCount);
      const current = get().activeProject;
      if (current?.id === project.id) {
        set({
          activeProject: {
            ...current,
            chapters: current.chapters.map((c) => (c.id === chapterId ? updated : c)),
          },
        });
      }
      return updated;
    } catch (err) {
      oops(err);
      return null;
    }
  },

  deleteChapter: async (chapterId) => {
    const project = get().activeProject;
    if (!project) return;
    try {
      await ipc.studioDeleteChapter(project.id, chapterId);
      const remaining = project.chapters.filter((c) => c.id !== chapterId);
      set({
        activeProject: { ...project, chapters: remaining },
        activeChapterId:
          get().activeChapterId === chapterId ? (remaining[0]?.id ?? null) : get().activeChapterId,
      });
    } catch (err) {
      oops(err);
    }
  },

  reorderChapters: async (orderedIds) => {
    const project = get().activeProject;
    if (!project) return;
    try {
      const updated = await ipc.studioReorderChapters(project.id, orderedIds);
      set({ activeProject: updated });
    } catch (err) {
      oops(err);
    }
  },
}));
