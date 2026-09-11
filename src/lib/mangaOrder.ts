import type { MangaChapter } from "./types";

/** "Ch. 12 — A New Start" / "Ch. 12" / "Oneshot" — same rule the backend
 * uses for `latest_chapter_marker`, kept in sync here so the reader's
 * toolbar and the follows list never disagree on a chapter's label. */
export function chapterLabelOf(chapter: MangaChapter): string {
  const number = chapter.chapter?.trim();
  const title = chapter.title?.trim();
  if (number && title) return `Ch. ${number} — ${title}`;
  if (number) return `Ch. ${number}`;
  if (title) return title;
  return "Oneshot";
}

/** MangaDex's feed is fetched newest-first for browsing; the reader needs
 * true reading order (oldest → newest) to know what "next chapter" means.
 * Chapters without a parseable number sort after numbered ones, in their
 * original (newest-first) relative order. */
export function sortChaptersAscending(chapters: MangaChapter[]): MangaChapter[] {
  const numbered: Array<{ chapter: MangaChapter; value: number }> = [];
  const unnumbered: MangaChapter[] = [];
  for (const chapter of chapters) {
    const value = chapter.chapter ? Number.parseFloat(chapter.chapter) : NaN;
    if (Number.isFinite(value)) numbered.push({ chapter, value });
    else unnumbered.push(chapter);
  }
  numbered.sort((a, b) => a.value - b.value);
  return [...numbered.map((n) => n.chapter), ...unnumbered.reverse()];
}
