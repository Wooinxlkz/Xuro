import { create } from "zustand";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";
import {
  notifyBacklinksChanged,
  notifyNotesRewritten,
} from "@/lib/backlinks";
import type {
  AccentColor,
  BackgroundStyle,
  Theme,
  TreeNode,
  VaultSnapshot,
  View,
} from "@/lib/types";
import { parentDir } from "@/lib/utils";
import { applyAccentColor, applyBackgroundStyle, applyTheme } from "@/lib/theme";
import { useTabs } from "@/stores/tabs";
import { usePins } from "@/stores/pins";
import { useLocks } from "@/stores/locks";
import { todayIso } from "@/lib/date";

type Status = "loading" | "welcome" | "ready";

interface VaultState {
  status: Status;
  root: string;
  name: string;
  tree: TreeNode[];
  theme: Theme;
  accentColor: AccentColor;
  accentCustomHex: string | null;
  backgroundStyle: BackgroundStyle;
  view: View | null;
  expanded: Set<string>;
  /** note rels most recently opened, newest first (session MRU) */
  recentNotes: string[];

  startup: () => Promise<void>;
  chooseVault: () => Promise<void>;
  createVault: () => Promise<void>;
  refreshTree: () => Promise<void>;
  setView: (view: View | null) => void;
  /** @internal — the actual view-setting logic; setView gates through this after an unlock. */
  applyView: (view: View | null) => void;
  pushRecent: (rel: string) => void;
  toggleExpanded: (rel: string) => void;
  /** @internal — the actual expand/collapse logic; toggleExpanded gates through this after an unlock. */
  applyToggleExpanded: (rel: string) => void;
  expandTo: (rel: string) => void;
  /** Retroactively enforce a just-created lock: collapse it if expanded,
   * close its tab(s), and clear the current view if it's now hidden. Locking
   * something already open/expanded should hide it immediately, not on the
   * next app restart. */
  enforceLock: (rel: string) => void;

  createNote: (dir: string) => Promise<void>;
  createNoteFromTemplate: (templateId: string, dir: string, title: string) => Promise<void>;
  createCanvas: () => Promise<void>;
  openDailyNote: (date?: string) => Promise<void>;
  createFolder: (dir: string, name: string) => Promise<string | null>;
  renameEntry: (rel: string, name: string) => Promise<void>;
  moveEntry: (rel: string, dir: string) => Promise<void>;
  deleteEntry: (rel: string) => Promise<void>;

  setTheme: (theme: Theme) => Promise<void>;
  cycleTheme: () => Promise<void>;
  setAccentColor: (accent: AccentColor, customHex?: string) => Promise<void>;
  setBackgroundStyle: (style: BackgroundStyle) => Promise<void>;
}

let systemThemeListener: (() => void) | null = null;

function watchSystemTheme(get: () => VaultState) {
  if (systemThemeListener) return;
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  systemThemeListener = () => applyTheme(get().theme);
  media.addEventListener("change", systemThemeListener);
}

const oops = (err: unknown) =>
  toast.error(err instanceof Error ? err.message : String(err));

/** Apply a freshly opened/created vault snapshot as the active vault. */
function openVaultSnapshot(
  set: (partial: Partial<VaultState>) => void,
  snapshot: VaultSnapshot | null,
) {
  if (!snapshot) return;
  applyTheme(snapshot.theme);
  applyAccentColor(snapshot.accentColor, snapshot.accentCustomHex);
  applyBackgroundStyle(snapshot.backgroundStyle);
  set({
    status: "ready",
    root: snapshot.root,
    name: snapshot.name,
    tree: snapshot.tree,
    theme: snapshot.theme,
    accentColor: snapshot.accentColor,
    accentCustomHex: snapshot.accentCustomHex,
    backgroundStyle: snapshot.backgroundStyle,
    view: null,
    expanded: new Set<string>(),
    recentNotes: seedRecents(snapshot.tree),
  });
  useTabs.getState().clear();
}

/** Top note rels by on-disk mtime — seeds "recent" before any note is opened. */
function seedRecents(tree: TreeNode[]): string[] {
  const notes: TreeNode[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (node.kind === "note") notes.push(node);
      if (node.children) walk(node.children);
    }
  };
  walk(tree);
  return notes
    .sort((a, b) => b.modifiedMs - a.modifiedMs)
    .slice(0, 8)
    .map((n) => n.rel);
}

/** Rewrite recent-note rels after a rename/move of `rel` → `next` (folder or note). */
function remapRecents(
  set: (partial: Partial<VaultState>) => void,
  get: () => VaultState,
  rel: string,
  next: string,
) {
  set({
    recentNotes: get().recentNotes.map((r) =>
      r === rel ? next : r.startsWith(`${rel}/`) ? next + r.slice(rel.length) : r,
    ),
  });
}

export const useVault = create<VaultState>((set, get) => ({
  status: "loading",
  root: "",
  name: "",
  tree: [],
  theme: "system",
  accentColor: "default",
  accentCustomHex: null,
  backgroundStyle: "default",
  view: null,
  expanded: new Set<string>(),
  recentNotes: [],

  startup: async () => {
    watchSystemTheme(get);
    try {
      const snapshot = await ipc.startup();
      if (!snapshot) {
        applyTheme("system");
        applyAccentColor("default");
        applyBackgroundStyle("default");
        set({ status: "welcome" });
        return;
      }
      applyTheme(snapshot.theme);
      applyAccentColor(snapshot.accentColor, snapshot.accentCustomHex);
      applyBackgroundStyle(snapshot.backgroundStyle);
      set({
        status: "ready",
        root: snapshot.root,
        name: snapshot.name,
        tree: snapshot.tree,
        theme: snapshot.theme,
        accentColor: snapshot.accentColor,
        accentCustomHex: snapshot.accentCustomHex,
        backgroundStyle: snapshot.backgroundStyle,
        recentNotes: seedRecents(snapshot.tree),
      });
    } catch (err) {
      oops(err);
      set({ status: "welcome" });
    }
  },

  chooseVault: async () => {
    try {
      openVaultSnapshot(set, await ipc.chooseVault());
    } catch (err) {
      oops(err);
    }
  },

  createVault: async () => {
    try {
      openVaultSnapshot(set, await ipc.createVault());
    } catch (err) {
      oops(err);
    }
  },

  refreshTree: async () => {
    if (get().status !== "ready") return;
    try {
      set({ tree: await ipc.loadTree() });
      await usePins.getState().load();
    } catch {
      // transient (e.g. vault briefly unavailable) — next refresh wins
    }
  },

  setView: (view) => {
    if (view?.type === "note" || view?.type === "canvas") {
      const protectingRel = useLocks.getState().protectingRel(view.rel);
      if (protectingRel) {
        useLocks.getState().openDialog({
          rel: protectingRel,
          kind: protectingRel === view.rel ? view.type : "folder",
          mode: "unlock",
          onUnlocked: () => get().applyView(view),
        });
        return;
      }
    }
    get().applyView(view);
  },

  applyView: (view) => {
    set({ view });
    if (view?.type === "note") {
      useTabs.getState().open(view.rel);
      get().pushRecent(view.rel);
    }
  },

  pushRecent: (rel) => {
    const recentNotes = [
      rel,
      ...get().recentNotes.filter((r) => r !== rel),
    ].slice(0, 8);
    set({ recentNotes });
  },

  toggleExpanded: (rel) => {
    const isExpanding = !get().expanded.has(rel);
    if (isExpanding) {
      const protectingRel = useLocks.getState().protectingRel(rel);
      if (protectingRel) {
        useLocks.getState().openDialog({
          rel: protectingRel,
          kind: "folder",
          mode: "unlock",
          onUnlocked: () => get().applyToggleExpanded(rel),
        });
        return;
      }
    }
    get().applyToggleExpanded(rel);
  },

  applyToggleExpanded: (rel) => {
    const expanded = new Set(get().expanded);
    if (expanded.has(rel)) {
      expanded.delete(rel);
    } else {
      expanded.add(rel);
    }
    set({ expanded });
  },

  expandTo: (rel) => {
    const expanded = new Set(get().expanded);
    const parts = rel.split("/");
    let path = "";
    for (const part of parts.slice(0, -1)) {
      path = path ? `${path}/${part}` : part;
      if (useLocks.getState().isLocked(path)) {
        // Stop right before revealing a locked folder's contents — its
        // listing stays hidden until it's unlocked through the normal gate.
        break;
      }
      expanded.add(path);
    }
    set({ expanded });
  },

  enforceLock: (rel) => {
    const isUnder = (candidate: string) =>
      candidate === rel || candidate.startsWith(`${rel}/`);

    const expanded = new Set(get().expanded);
    let expandedChanged = false;
    for (const key of Array.from(expanded)) {
      if (isUnder(key)) {
        expanded.delete(key);
        expandedChanged = true;
      }
    }
    if (expandedChanged) set({ expanded });

    const view = get().view;
    if (view?.type === "note" && isUnder(view.rel)) {
      set({ view: null });
    }

    useTabs.getState().removeUnder(rel);
  },

  createNote: async (dir) => {
    try {
      const rel = await ipc.createNote(dir, "Untitled");
      await get().refreshTree();
      get().expandTo(rel);
      // Route through setView so the tab opens (blank pane otherwise).
      get().setView({ type: "note", rel });
      useTabs.getState().requestTitleFocus(rel);
      notifyBacklinksChanged();
    } catch (err) {
      oops(err);
    }
  },

  createNoteFromTemplate: async (templateId, dir, title) => {
    try {
      const rel = await ipc.templateCreateNote(templateId, dir, title || "Untitled");
      await get().refreshTree();
      get().expandTo(rel);
      get().setView({ type: "note", rel });
      notifyBacklinksChanged();
    } catch (err) {
      oops(err);
    }
  },

  createCanvas: async () => {
    try {
      const rel = await ipc.canvasCreate("Untitled");
      await get().refreshTree();
      get().expandTo(rel);
      get().setView({ type: "canvas", rel });
      notifyBacklinksChanged();
    } catch (err) {
      oops(err);
    }
  },

  openDailyNote: async (date) => {
    try {
      const rel = await ipc.openDailyNote(date ?? todayIso());
      await get().refreshTree();
      get().expandTo(rel);
      get().setView({ type: "note", rel });
      notifyBacklinksChanged();
    } catch (err) {
      oops(err);
    }
  },

  createFolder: async (dir, name) => {
    try {
      const rel = await ipc.createFolder(dir, name);
      await get().refreshTree();
      get().expandTo(`${rel}/x`);
      return rel;
    } catch (err) {
      oops(err);
      return null;
    }
  },

  renameEntry: async (rel, name) => {
    try {
      const next = await ipc.renameEntry(rel, name);
      const { view } = get();
      await get().refreshTree();
      remapRecents(set, get, rel, next);
      useTabs.getState().remap(rel, next);
      if (view?.type === "note") {
        if (view.rel === rel) {
          set({ view: { type: "note", rel: next } });
        } else if (view.rel.startsWith(`${rel}/`)) {
          set({ view: { type: "note", rel: view.rel.replace(rel, next) } });
        }
      }
      notifyNotesRewritten();
    } catch (err) {
      oops(err);
    }
  },

  moveEntry: async (rel, dir) => {
    try {
      const next = await ipc.moveEntry(rel, dir);
      const { view } = get();
      await get().refreshTree();
      get().expandTo(next);
      remapRecents(set, get, rel, next);
      useTabs.getState().remap(rel, next);
      if (view?.type === "note") {
        if (view.rel === rel) {
          set({ view: { type: "note", rel: next } });
        } else if (view.rel.startsWith(`${rel}/`)) {
          set({ view: { type: "note", rel: view.rel.replace(rel, next) } });
        }
      }
      notifyNotesRewritten();
    } catch (err) {
      oops(err);
    }
  },

  deleteEntry: async (rel) => {
    try {
      await ipc.deleteEntry(rel);
      const { view } = get();
      await get().refreshTree();
      const gone = (r: string) => r === rel || r.startsWith(`${rel}/`);
      set({ recentNotes: get().recentNotes.filter((r) => !gone(r)) });

      // Drop affected tabs; if the active note went with them, activate the
      // nearest surviving tab to its right (else the last one standing).
      const before = useTabs.getState().tabs;
      useTabs.getState().removeUnder(rel);
      if (view?.type === "note" && gone(view.rel)) {
        const index = before.indexOf(view.rel);
        const right = before.slice(index + 1).find((t) => !gone(t));
        const survivors = before.filter((t) => !gone(t));
        const next = right ?? survivors[survivors.length - 1] ?? null;
        get().setView(next ? { type: "note", rel: next } : null);
      }
      toast("Moved to Trash", {
        description: rel.split("/").pop()?.replace(/\.md$/, ""),
      });
      notifyBacklinksChanged();
    } catch (err) {
      oops(err);
    }
  },

  setTheme: async (theme) => {
    applyTheme(theme);
    set({ theme });
    try {
      await ipc.setTheme(theme);
    } catch (err) {
      oops(err);
    }
  },

  cycleTheme: async () => {
    // Keyboard toggle only flips light ↔ dark; never sets "system".
    const isDark = document.documentElement.classList.contains("dark");
    await get().setTheme(isDark ? "light" : "dark");
  },

  setAccentColor: async (accent, customHex) => {
    const prev = { accentColor: get().accentColor, accentCustomHex: get().accentCustomHex };
    applyAccentColor(accent, customHex ?? null);
    set({ accentColor: accent, accentCustomHex: accent === "custom" ? (customHex ?? null) : null });
    try {
      await ipc.setAccentColor(accent, customHex);
    } catch (err) {
      applyAccentColor(prev.accentColor, prev.accentCustomHex);
      set(prev);
      oops(err);
    }
  },

  setBackgroundStyle: async (style) => {
    const prev = get().backgroundStyle;
    applyBackgroundStyle(style);
    set({ backgroundStyle: style });
    try {
      await ipc.setBackgroundStyle(style);
    } catch (err) {
      applyBackgroundStyle(prev);
      set({ backgroundStyle: prev });
      oops(err);
    }
  },
}));

/** Default landing folder for a new note when nothing is selected. */
export const DEFAULT_NOTES_DIR = "Notes";

/** Folder rel of the current selection — used as target for "new note". */
export function activeDir(state: Pick<VaultState, "view">) {
  return state.view?.type === "note" ? parentDir(state.view.rel) : DEFAULT_NOTES_DIR;
}
