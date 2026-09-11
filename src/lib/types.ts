export type Theme = "system" | "light" | "dark";

export type AccentColor =
  | "default"
  | "blue"
  | "green"
  | "purple"
  | "red"
  | "orange"
  | "custom";

export type BackgroundStyle =
  | "default"
  | "cream"
  | "soft"
  | "mossy-hollow"
  | "chocolate-truffle"
  | "ink-wash";

export type NodeKind = "folder" | "note" | "canvas";

export interface TreeNode {
  name: string;
  /** Path relative to the vault root, e.g. "projects/app.md". */
  rel: string;
  kind: NodeKind;
  children?: TreeNode[];
  modifiedMs: number;
}

export interface VaultSnapshot {
  root: string;
  name: string;
  tree: TreeNode[];
  theme: Theme;
  accentColor: AccentColor;
  accentCustomHex: string | null;
  backgroundStyle: BackgroundStyle;
}

export type TodoStatus = "todo" | "in_progress" | "done";

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  createdAt: number;
  completedAt: number | null;
  tags: string[];
  inProgress: boolean;
  boardId: string;
}

export interface Board {
  id: string;
  title: string;
  createdAt: number;
}

export interface Bookmark {
  id: string;
  url: string;
  title: string;
  image: string | null;
  favicon: string | null;
  metaFetched: boolean;
  tags: string[];
  createdAt: number;
}

export interface SearchHit {
  rel: string;
  title: string;
  snippet: string;
  titleMatch: boolean;
}

export interface TaggedNote {
  rel: string;
  title: string;
}

export interface TagEntry {
  tag: string;
  notes: TaggedNote[];
}

export interface Snippet {
  id: string;
  title: string;
  language: string;
  content: string;
  createdAt: number;
}

export interface Template {
  id: string;
  title: string;
  content: string;
  createdAt: number;
}

export interface ObsidianImportSummary {
  folder: string;
  notesImported: number;
  attachmentsImported: number;
  skipped: string[];
}

export interface GraphNode {
  rel: string;
  title: string;
  degree: number;
  /** Rel of the immediate parent folder, or null at the vault root. */
  folder: string | null;
  kind: "note" | "canvas";
  createdMs: number;
  modifiedMs: number;
  sizeBytes: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

/** A folder rendered as a compound container node in the graph. */
export interface GraphFolder {
  rel: string;
  name: string;
  parent: string | null;
  /** Every note anywhere under this folder, direct or nested. */
  noteCount: number;
  modifiedMs: number;
  /** Deterministic 0-359 hue derived from the folder's path. */
  hue: number;
}

export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  folders: GraphFolder[];
}

export interface BacklinkMention {
  sourceRel: string;
  context: string;
  line: number;
  occurrence: number;
}

export interface PublishedShare {
  id: string;
  entryId: string;
  slug: string;
  url: string;
  title: string;
  contentHash: string;
  publishedAt: number;
  updatedAt: number;
  pageCount: number;
  assetCount: number;
}

export interface PublishPageDraft {
  rel: string;
  path: string;
  title: string;
  markdown: string;
}

export interface CloudAccount {
  email: string;
  plan: "free" | "cloud";
}

export interface CloudAccountStatus {
  account: CloudAccount | null;
}

export interface OtpChallenge {
  challengeId: string;
  email: string;
  expiresIn: number;
  resendAfter: number;
}

export interface PublishedNoteStatus {
  account: CloudAccount | null;
  share: PublishedShare | null;
  isOutdated: boolean;
}

export type View =
  | { type: "note"; rel: string }
  | { type: "canvas"; rel: string }
  | { type: "todos" }
  | { type: "bookmarks" }
  | { type: "daily" }
  | { type: "tags" }
  | { type: "kanban" }
  | { type: "snippets" }
  | { type: "templates" }
  | { type: "graph" }
  | { type: "library" };

export type LibraryKind = "book" | "manga";

export interface LibraryItem {
  id: string;
  title: string;
  author: string | null;
  kind: LibraryKind;
  /** Remote cover image URL for a searched/added item. */
  coverUrl: string | null;
  /** Vault-relative path for an uploaded file, e.g. "Library/Dune.pdf". */
  fileRel: string | null;
  addedAt: number;
  lastPage: number | null;
}

export interface LibrarySearchResult {
  externalId: string;
  title: string;
  author: string | null;
  kind: LibraryKind;
  coverUrl: string | null;
  year: number | null;
}

// ---- Online Manga ----

export type MangaLanguage = "english" | "spanish" | "arabic" | "japanese";

export const MANGA_LANGUAGES: { value: MangaLanguage; label: string }[] = [
  { value: "english", label: "English" },
  { value: "spanish", label: "Spanish" },
  { value: "arabic", label: "Arabic" },
  { value: "japanese", label: "Japanese" },
];

export type MangaSort = "latest" | "popular" | "newest" | "titleAsc" | "rating";

export type MangaStatus = "ongoing" | "completed" | "hiatus" | "cancelled";

export interface MangaTag {
  id: string;
  name: string;
  group: string;
}

export interface MangaSummary {
  id: string;
  title: string;
  coverUrl: string | null;
  status: string | null;
  year: number | null;
  contentRating: string;
  tags: string[];
  demographic: string | null;
  availableLanguages: string[];
  lastChapter: string | null;
}

export interface MangaPageResult {
  items: MangaSummary[];
  total: number;
  page: number;
  hasMore: boolean;
}

export interface MangaDetails extends MangaSummary {
  description: string | null;
  authors: string[];
  altTitles: string[];
}

export interface MangaChapter {
  id: string;
  chapter: string | null;
  title: string | null;
  translatedLanguage: string;
  pages: number;
  publishAt: string | null;
  scanlationGroup: string | null;
  external: boolean;
}

export interface ChapterPages {
  chapterId: string;
  imageUrls: string[];
}

export interface MangaBrowseParams {
  query?: string;
  language?: MangaLanguage;
  genreIds?: string[];
  status?: MangaStatus | string;
  sort?: MangaSort;
  page?: number;
}

export interface MangaFollow {
  mangaId: string;
  title: string;
  coverUrl: string | null;
  followedAt: number;
  isFavorite: boolean;
  lastKnownChapterId: string | null;
  lastKnownChapterLabel: string | null;
  hasUpdate: boolean;
}

export interface MangaReadingProgress {
  mangaId: string;
  mangaTitle: string;
  coverUrl: string | null;
  chapterId: string;
  chapterLabel: string;
  page: number;
  pageCount: number;
  updatedAt: number;
}

export interface MangaHistoryEntry {
  mangaId: string;
  mangaTitle: string;
  coverUrl: string | null;
  chapterId: string;
  chapterLabel: string;
  readAt: number;
}

export interface MangaBookmarkEntry {
  id: string;
  mangaId: string;
  mangaTitle: string;
  chapterId: string;
  chapterLabel: string;
  page: number;
  createdAt: number;
}

export interface DownloadedChapter {
  mangaId: string;
  mangaTitle: string;
  coverUrl: string | null;
  chapterId: string;
  chapterLabel: string;
  language: string;
  folderRel: string;
  pageFiles: string[];
  downloadedAt: number;
}

export type DebugLevel = "error" | "warn" | "panic";
export type DebugSource = "frontend" | "backend";

export interface DebugEntry {
  id: string;
  atMs: number;
  level: DebugLevel;
  source: DebugSource;
  message: string;
  context: string | null;
}
