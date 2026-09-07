import type { AccentColor, BackgroundStyle, Theme } from "./types";

export function applyTheme(theme: Theme) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const dark = theme === "dark" || (theme === "system" && media.matches);
  document.documentElement.classList.toggle("dark", dark);
}

/** Sets --accent for the small set of touchpoints that use it, or clears
 * back to the monochrome default. */
export function applyAccentColor(accent: AccentColor, customHex?: string | null) {
  const root = document.documentElement;
  if (accent === "default") {
    root.removeAttribute("data-accent");
    root.style.removeProperty("--accent");
    return;
  }
  root.setAttribute("data-accent", accent);
  if (accent === "custom" && customHex) {
    root.style.setProperty("--accent", customHex);
  } else {
    root.style.removeProperty("--accent");
  }
}

export function applyBackgroundStyle(style: BackgroundStyle) {
  const root = document.documentElement;
  if (style === "default") {
    root.removeAttribute("data-bg");
  } else {
    root.setAttribute("data-bg", style);
  }
}
