import { create } from "zustand";
import {
  SIDEBAR_DEFAULT_WIDTH,
  clampSidebarWidth,
} from "@/lib/sidebarResize";

type SaveState = "idle" | "saving" | "error";
export type SettingsPage =
  | "general"
  | "cloud"
  | "appearance"
  | "shortcuts"
  | "about";

interface UiState {
  paletteOpen: boolean;
  settingsOpen: boolean;
  settingsPage: SettingsPage;
  sidebarHidden: boolean;
  sidebarWidth: number;
  backlinksHidden: boolean;
  markdownSource: boolean;
  zenMode: boolean;
  /** Sidebar/backlinks visibility to restore when Zen mode is turned off. */
  _zenPrevSidebarHidden: boolean;
  _zenPrevBacklinksHidden: boolean;
  saveState: SaveState;
  setPaletteOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  openSettings: (page?: SettingsPage) => void;
  setSettingsPage: (page: SettingsPage) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleBacklinks: () => void;
  toggleMarkdownSource: () => void;
  toggleZenMode: () => void;
  setSaveState: (state: SaveState) => void;
}

export const useUi = create<UiState>((set, get) => ({
  paletteOpen: false,
  settingsOpen: false,
  settingsPage: "general",
  sidebarHidden: false,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  backlinksHidden: true,
  markdownSource: false,
  zenMode: false,
  _zenPrevSidebarHidden: false,
  _zenPrevBacklinksHidden: true,
  saveState: "idle",
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  openSettings: (settingsPage = "general") =>
    set({ settingsOpen: true, settingsPage }),
  setSettingsPage: (settingsPage) => set({ settingsPage }),
  toggleSidebar: () => set({ sidebarHidden: !get().sidebarHidden }),
  setSidebarWidth: (sidebarWidth) =>
    set({ sidebarWidth: clampSidebarWidth(sidebarWidth) }),
  toggleBacklinks: () => set({ backlinksHidden: !get().backlinksHidden }),
  toggleMarkdownSource: () =>
    set({ markdownSource: !get().markdownSource }),
  toggleZenMode: () => {
    const next = !get().zenMode;
    // Entering Zen mode hides the chrome around the note (sidebar,
    // backlinks) instead of stacking as separate toggles the person has to
    // remember to undo — leaving Zen mode restores exactly what was hidden
    // for it, not whatever the sidebar/backlinks happened to be before.
    set({
      zenMode: next,
      sidebarHidden: next ? true : get()._zenPrevSidebarHidden,
      backlinksHidden: next ? true : get()._zenPrevBacklinksHidden,
      _zenPrevSidebarHidden: next
        ? get().sidebarHidden
        : get()._zenPrevSidebarHidden,
      _zenPrevBacklinksHidden: next
        ? get().backlinksHidden
        : get()._zenPrevBacklinksHidden,
    });
  },
  setSaveState: (saveState) => set({ saveState }),
}));
