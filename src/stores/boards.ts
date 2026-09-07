import { create } from "zustand";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import type { Board } from "@/lib/types";

interface BoardsState {
  boards: Board[];
  activeBoardId: string | null;
  loaded: boolean;
  load: () => Promise<void>;
  setActiveBoard: (id: string) => void;
  create: (title: string) => Promise<void>;
  rename: (id: string, title: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

const oops = (err: unknown) =>
  toast.error(err instanceof Error ? err.message : String(err));

export const useBoards = create<BoardsState>((set, get) => ({
  boards: [],
  activeBoardId: null,
  loaded: false,

  load: async () => {
    try {
      const boards = await ipc.boardsList();
      set((state) => ({
        boards,
        loaded: true,
        activeBoardId: state.activeBoardId ?? boards[0]?.id ?? null,
      }));
    } catch (err) {
      oops(err);
    }
  },

  setActiveBoard: (id) => set({ activeBoardId: id }),

  create: async (title) => {
    try {
      const board = await ipc.boardCreate(title);
      set({ boards: [...get().boards, board], activeBoardId: board.id });
    } catch (err) {
      oops(err);
    }
  },

  rename: async (id, title) => {
    try {
      const updated = await ipc.boardRename(id, title);
      set({
        boards: get().boards.map((b) => (b.id === id ? updated : b)),
      });
    } catch (err) {
      oops(err);
    }
  },

  remove: async (id) => {
    try {
      const boards = await ipc.boardDelete(id);
      set((state) => ({
        boards,
        activeBoardId:
          state.activeBoardId === id ? (boards[0]?.id ?? null) : state.activeBoardId,
      }));
    } catch (err) {
      oops(err);
    }
  },
}));
