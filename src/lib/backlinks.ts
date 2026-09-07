export const BACKLINKS_CHANGED = "xuro:backlinks-changed";
export const NOTES_REWRITTEN = "xuro:notes-rewritten";

export function notifyBacklinksChanged() {
  window.dispatchEvent(new Event(BACKLINKS_CHANGED));
}

export function notifyNotesRewritten() {
  window.dispatchEvent(new Event(NOTES_REWRITTEN));
  notifyBacklinksChanged();
}
