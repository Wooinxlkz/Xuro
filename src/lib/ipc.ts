import { invoke } from "@tauri-apps/api/core";
import type {
  AccentColor,
  BacklinkMention,
  BackgroundStyle,
  Board,
  CloudAccountStatus,
  CloudAccount,
  Bookmark,
  PublishedNoteStatus,
  PublishPageDraft,
  PublishedShare,
  OtpChallenge,
  ObsidianImportSummary,
  Graph,
  LibraryItem,
  LibraryKind,
  LibrarySearchResult,
  SearchHit,
  Snippet,
  TagEntry,
  Template,
  Theme,
  Todo,
  TodoStatus,
  TreeNode,
  VaultSnapshot,
} from "./types";

interface ErrorPayload {
  kind: string;
  message: string;
}

export class IpcError extends Error {
  kind: string;

  constructor(payload: ErrorPayload) {
    super(payload.message);
    this.kind = payload.kind;
  }
}

async function call<T>(command: string, args?: Record<string, unknown>) {
  try {
    return await invoke<T>(command, args);
  } catch (raw) {
    if (raw && typeof raw === "object" && "message" in raw) {
      throw new IpcError(raw as ErrorPayload);
    }
    throw new IpcError({ kind: "other", message: String(raw) });
  }
}

export const ipc = {
  startup: () => call<VaultSnapshot | null>("startup"),
  chooseVault: () => call<VaultSnapshot | null>("choose_vault"),
  importObsidianVault: () =>
    call<ObsidianImportSummary | null>("import_obsidian_vault"),
  graphData: () => call<Graph>("graph_data"),
  createVault: () => call<VaultSnapshot | null>("create_vault"),
  loadTree: () => call<TreeNode[]>("load_tree"),

  readNote: (rel: string) => call<string>("read_note", { rel }),
  writeNote: (rel: string, content: string) =>
    call<void>("write_note", { rel, content }),
  createNote: (dir: string, title: string) =>
    call<string>("create_note", { dir, title }),
  createNoteWithContent: (dir: string, title: string, content: string) =>
    call<string>("create_note_with_content", { dir, title, content }),
  openDailyNote: (date: string) => call<string>("open_daily_note", { date }),
  showQuickCapture: () => call<void>("show_quick_capture"),
  closeQuickCapture: () => call<void>("close_quick_capture"),
  createFolder: (dir: string, name: string) =>
    call<string>("create_folder", { dir, name }),
  renameEntry: (rel: string, name: string) =>
    call<string>("rename_entry", { rel, name }),
  moveEntry: (rel: string, dir: string) =>
    call<string>("move_entry", { rel, dir }),
  deleteEntry: (rel: string) => call<void>("delete_entry", { rel }),
  searchNotes: (query: string, limit?: number) =>
    call<SearchHit[]>("search_notes", { query, limit }),
  listTags: () => call<TagEntry[]>("list_tags"),
  snippetsList: () => call<Snippet[]>("snippets_list"),
  snippetAdd: (title: string, language: string, content: string) =>
    call<Snippet>("snippet_add", { title, language, content }),
  snippetUpdate: (id: string, title: string, language: string, content: string) =>
    call<Snippet>("snippet_update", { id, title, language, content }),
  snippetDelete: (id: string) => call<void>("snippet_delete", { id }),
  templatesList: () => call<Template[]>("templates_list"),
  templateAdd: (title: string, content: string) =>
    call<Template>("template_add", { title, content }),
  templateUpdate: (id: string, title: string, content: string) =>
    call<Template>("template_update", { id, title, content }),
  templateDelete: (id: string) => call<void>("template_delete", { id }),
  templateCreateNote: (id: string, dir: string, title: string) =>
    call<string>("template_create_note", { id, dir, title }),
  templateResolve: (id: string, title: string) =>
    call<string>("template_resolve", { id, title }),
  canvasesList: () => call<string[]>("canvases_list"),
  canvasRead: (rel: string) => call<string>("canvas_read", { rel }),
  canvasWrite: (rel: string, content: string) =>
    call<void>("canvas_write", { rel, content }),
  canvasCreate: (title: string) => call<string>("canvas_create", { title }),
  backlinksFor: (rel: string) =>
    call<BacklinkMention[]>("backlinks_for", { rel }),
  cloudAccountStatus: () => call<CloudAccountStatus>("cloud_account_status"),
  cloudRequestOtp: (email: string) =>
    call<OtpChallenge>("cloud_request_otp", { email }),
  cloudVerifyOtp: (challengeId: string, code: string) =>
    call<CloudAccount>("cloud_verify_otp", { challengeId, code }),
  cloudSignOut: () => call<void>("cloud_sign_out"),
  cloudPlansUrl: () => call<string>("cloud_plans_url"),
  cloudBillingPortalUrl: () => call<string>("cloud_billing_portal_url"),
  publishedNoteStatus: (
    rel: string,
    title: string,
    content: string,
    pages: PublishPageDraft[],
  ) => call<PublishedNoteStatus>("published_note_status", { rel, title, content, pages }),
  isNotePublished: (rel: string) =>
    call<boolean>("is_note_published", { rel }),
  publishNote: (
    rel: string,
    title: string,
    content: string,
    pages: PublishPageDraft[],
  ) => call<PublishedShare>("publish_note", { rel, title, content, pages }),
  updatePublishedNote: (
    rel: string,
    title: string,
    content: string,
    pages: PublishPageDraft[],
  ) => call<PublishedShare>("update_published_note", { rel, title, content, pages }),
  revokePublishedNote: (rel: string) =>
    call<void>("revoke_published_note", { rel }),
  pinsList: () => call<string[]>("pins_list"),
  pinNote: (rel: string) => call<string[]>("pin_note", { rel }),
  unpinNote: (rel: string) => call<string[]>("unpin_note", { rel }),
  locksList: () => call<string[]>("locks_list"),
  lockIsLocked: (rel: string) => call<boolean>("lock_is_locked", { rel }),
  lockSetPin: (rel: string, pin: string, oldPin?: string) =>
    call<void>("lock_set_pin", { rel, pin, oldPin }),
  lockVerify: (rel: string, pin: string) => call<boolean>("lock_verify", { rel, pin }),
  lockRemove: (rel: string) => call<void>("lock_remove", { rel }),

  todosList: () => call<Todo[]>("todos_list"),
  todoAdd: (text: string, boardId: string) =>
    call<Todo>("todo_add", { text, boardId }),
  todoToggle: (id: string) => call<Todo>("todo_toggle", { id }),
  todoSetStatus: (id: string, status: TodoStatus) =>
    call<Todo>("todo_set_status", { id, status }),
  todoUpdate: (id: string, text: string) =>
    call<Todo>("todo_update", { id, text }),
  todoSetTags: (id: string, tags: string[]) =>
    call<Todo>("todo_set_tags", { id, tags }),
  todoTagsList: () => call<string[]>("todo_tags_list"),
  todoTagCreate: (name: string) => call<string[]>("todo_tag_create", { name }),
  todoTagDelete: (name: string) => call<string[]>("todo_tag_delete", { name }),
  todoDelete: (id: string) => call<void>("todo_delete", { id }),
  todosClearCompleted: () => call<Todo[]>("todos_clear_completed"),

  boardsList: () => call<Board[]>("boards_list"),
  boardCreate: (title: string) => call<Board>("board_create", { title }),
  boardRename: (id: string, title: string) =>
    call<Board>("board_rename", { id, title }),
  boardDelete: (id: string) => call<Board[]>("board_delete", { id }),

  libraryList: () => call<LibraryItem[]>("library_list"),
  librarySearchBooks: (query: string) =>
    call<LibrarySearchResult[]>("library_search_books", { query }),
  librarySearchManga: (query: string) =>
    call<LibrarySearchResult[]>("library_search_manga", { query }),
  libraryAddFromSearch: (result: LibrarySearchResult) =>
    call<LibraryItem>("library_add_from_search", { result }),
  libraryUpload: (
    sourcePath: string,
    title: string,
    author: string | undefined,
    kind: LibraryKind,
  ) =>
    call<LibraryItem>("library_upload", { sourcePath, title, author, kind }),
  libraryRemove: (id: string) => call<void>("library_remove", { id }),
  librarySetLastPage: (id: string, page: number) =>
    call<LibraryItem>("library_set_last_page", { id, page }),
  libraryPickUploadFile: () => call<string | null>("library_pick_upload_file"),

  bookmarksList: () => call<Bookmark[]>("bookmarks_list"),
  bookmarkAdd: (url: string) => call<Bookmark>("bookmark_add", { url }),
  bookmarkUpdateTitle: (id: string, title: string) =>
    call<Bookmark>("bookmark_update_title", { id, title }),
  bookmarkSetTags: (id: string, tags: string[]) =>
    call<Bookmark>("bookmark_set_tags", { id, tags }),
  bookmarkTagsList: () => call<string[]>("bookmark_tags_list"),
  bookmarkTagCreate: (name: string) =>
    call<string[]>("bookmark_tag_create", { name }),
  bookmarkTagDelete: (name: string) =>
    call<string[]>("bookmark_tag_delete", { name }),
  bookmarkDelete: (id: string) => call<void>("bookmark_delete", { id }),
  bookmarkFetchMeta: (id: string) => call<Bookmark>("bookmark_fetch_meta", { id }),
  exportBookmarks: () => call<string | null>("export_bookmarks"),
  exportNote: (rel: string, content: string) =>
    call<string | null>("export_note", { rel, content }),
  exportNotePdf: (rel: string, pdfBase64: string) =>
    call<string | null>("export_note_pdf", { rel, pdfBase64 }),

  saveImageAsset: (data: string, extension: string) =>
    call<string>("save_image_asset", { data, extension }),
  setTheme: (theme: Theme) => call<void>("set_theme", { theme }),
  getTheme: () => call<Theme>("get_theme"),
  setAccentColor: (accentColor: AccentColor, customHex?: string) =>
    call<void>("set_accent_color", { accentColor, customHex }),
  getAccentColor: () =>
    call<[AccentColor, string | null]>("get_accent_color"),
  setBackgroundStyle: (backgroundStyle: BackgroundStyle) =>
    call<void>("set_background_style", { backgroundStyle }),
  getBackgroundStyle: () => call<BackgroundStyle>("get_background_style"),
};
