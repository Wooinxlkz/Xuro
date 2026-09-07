import { create } from "zustand";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";

/** "Notes/Private/Plan.md" -> "Plan"; "Notes/Private" -> "Private" */
export function lockDisplayName(rel: string) {
  const last = rel.split("/").pop() ?? rel;
  return last.replace(/\.md$/, "");
}

interface LockDialogRequest {
  rel: string;
  kind: "note" | "folder" | "canvas";
  /** "manage" = set a new PIN or change the existing one (from the context
   * menu). "unlock" = enter the PIN to proceed (opening a locked item).
   * "remove" = the context-menu "Remove PIN" action, which — unlike the
   * Settings reset — still requires the current PIN; only Settings is the
   * no-PIN-needed "I forgot it" escape hatch. */
  mode: "manage" | "unlock" | "remove";
  /** Only used for "unlock" — called once the correct PIN is entered. */
  onUnlocked?: () => void;
}

interface LocksState {
  locked: string[];
  loading: boolean;
  dialog: LockDialogRequest | null;
  load: () => Promise<void>;
  /** Set/replace a PIN. Throws (caller shows the error inline) rather than
   * toasting, since a wrong "current PIN" belongs in the dialog, not a toast. */
  setPin: (rel: string, pin: string, oldPin?: string) => Promise<void>;
  remove: (rel: string) => Promise<void>;
  isLocked: (rel: string) => boolean;
  protectingRel: (rel: string) => string | null;
  isProtected: (rel: string) => boolean;
  openDialog: (request: LockDialogRequest) => void;
  closeDialog: () => void;
  clear: () => void;
}

const showError = (error: unknown) =>
  toast.error(error instanceof Error ? error.message : String(error));

export const useLocks = create<LocksState>((set, get) => ({
  locked: [],
  loading: false,
  dialog: null,

  load: async () => {
    set({ loading: true });
    try {
      set({ locked: await ipc.locksList() });
    } catch (error) {
      showError(error);
    } finally {
      set({ loading: false });
    }
  },

  setPin: async (rel, pin, oldPin) => {
    await ipc.lockSetPin(rel, pin, oldPin);
    set((state) =>
      state.locked.includes(rel) ? state : { locked: [...state.locked, rel] },
    );
  },

  // Doesn't swallow errors — callers (LockDialog, Settings) need to know if
  // removal actually failed rather than showing a success message anyway.
  remove: async (rel) => {
    await ipc.lockRemove(rel);
    set((state) => ({ locked: state.locked.filter((item) => item !== rel) }));
  },

  isLocked: (rel) => get().locked.includes(rel),

  /** The rel that actually holds the lock protecting `rel` — itself, or the
   * nearest locked ancestor folder. `null` if nothing protects it. Locking a
   * folder protects everything inside it, not just direct note-level locks. */
  protectingRel: (rel) => {
    const locked = get().locked;
    if (locked.includes(rel)) return rel;
    const parts = rel.split("/");
    for (let i = 1; i < parts.length; i += 1) {
      const ancestor = parts.slice(0, i).join("/");
      if (locked.includes(ancestor)) return ancestor;
    }
    return null;
  },

  isProtected: (rel) => get().protectingRel(rel) !== null,

  openDialog: (request) => set({ dialog: request }),
  closeDialog: () => set({ dialog: null }),

  clear: () => set({ locked: [], loading: false, dialog: null }),
}));
