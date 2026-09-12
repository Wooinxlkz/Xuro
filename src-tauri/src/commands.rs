use std::path::PathBuf;
use std::sync::RwLock;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::backlinks::{self, BacklinkMention};
use crate::bookmarks::{self, Bookmark};
use crate::boards::{self, Board};
use crate::config::{self, AccentColor, BackgroundStyle, Theme};
use crate::error::{AppError, AppResult};
use crate::library::{self, LibraryItem, LibrarySearchResult};
use crate::manga_online::{
    self, DownloadedChapter, HistoryEntry, MangaBookmarkEntry, MangaFollow, ReadingProgress,
};
use crate::manga_source::{self, MangaBrowseParams, MangaChapter, MangaDetails, MangaPage, MangaTag};
use crate::studio::{self, Chapter, Project, ProjectSummary};
use crate::search::SearchHit;
use crate::todos::{self, Todo};
use crate::vault::{self, TreeNode};
use crate::{
    agent_docs, assets, canvas, cloud, cloud_metadata, daily_notes, graph, link_meta, locks,
    notes, obsidian_import, pins, quick_capture, search, snippets, tags, templates, tray,
};

#[derive(Default)]
pub struct AppState {
    vault: RwLock<Option<PathBuf>>,
}

impl AppState {
    fn root(&self) -> AppResult<PathBuf> {
        self.vault
            .read()
            .map_err(|_| AppError::Other("state lock poisoned".to_string()))?
            .clone()
            .ok_or(AppError::NoVault)
    }

    fn set_root(&self, path: Option<PathBuf>) {
        if let Ok(mut guard) = self.vault.write() {
            *guard = path;
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshot {
    pub root: String,
    pub name: String,
    pub tree: Vec<TreeNode>,
    pub theme: Theme,
    pub accent_color: AccentColor,
    pub accent_custom_hex: Option<String>,
    pub background_style: BackgroundStyle,
}

fn snapshot(app: &AppHandle, root: &PathBuf) -> AppResult<VaultSnapshot> {
    let tree = vault::scan_tree(root)?;
    let name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Vault".to_string());
    let cfg = config::load(app);
    Ok(VaultSnapshot {
        root: root.display().to_string(),
        name,
        tree,
        theme: cfg.theme,
        accent_color: cfg.accent_color,
        accent_custom_hex: cfg.accent_custom_hex,
        background_style: cfg.background_style,
    })
}

fn activate_vault(app: &AppHandle, state: &AppState, root: PathBuf) -> AppResult<VaultSnapshot> {
    // First run = Xuro has never set this folder up (no .xuro yet).
    let first_run = !root.join(vault::DATA_DIR).exists();
    let migrations = vault::ensure_layout(&root)?;
    for migration in migrations {
        let _ = backlinks::rewrite_links(&root, &migration.from, &migration.to);
        let _ = pins::remap(&root, &migration.from, &migration.to);
        let _ = cloud_metadata::remap(&root, &migration.from, &migration.to);
    }
    // Drop in agent guide files so coding agents understand the vault.
    let _ = agent_docs::ensure(&root);
    // Seed a starter note only on a brand-new vault, so it isn't empty.
    if first_run {
        let _ = notes::seed_welcome(&root);
    }
    // Allow the webview to load images from the vault's asset folder.
    let _ = app
        .asset_protocol_scope()
        .allow_directory(root.join(vault::ASSETS_DIR), true);
    state.set_root(Some(root.clone()));
    let mut cfg = config::load(app);
    cfg.vault_path = Some(root.display().to_string());
    config::save(app, &cfg)?;
    crate::tray::refresh(app, Some(&root));
    snapshot(app, &root)
}

/// Called once on app start: reopen the last vault if it still exists.
#[tauri::command]
pub fn startup(app: AppHandle, state: State<'_, AppState>) -> AppResult<Option<VaultSnapshot>> {
    let cfg = config::load(&app);
    let Some(path) = cfg.vault_path else {
        return Ok(None);
    };
    let root = PathBuf::from(path);
    if !root.is_dir() {
        return Ok(None);
    }
    activate_vault(&app, &state, root).map(Some)
}

/// Open a native folder picker and activate the chosen folder as the vault.
/// Async so the blocking dialog call runs off the main thread — calling it
/// on the main thread deadlocks the whole app.
#[tauri::command]
pub async fn choose_vault(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Option<VaultSnapshot>> {
    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || app.dialog().file().blocking_pick_folder()
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let Some(folder) = picked else {
        return Ok(None);
    };
    let root = folder
        .into_path()
        .map_err(|e| AppError::InvalidPath(e.to_string()))?;
    activate_vault(&app, &state, root).map(Some)
}

/// Open a native folder picker for an Obsidian vault, then import its notes
/// and image attachments into a new top-level folder in the current vault.
/// Async for the same reason as `choose_vault` — the blocking dialog call
/// must not run on the main thread.
#[tauri::command]
pub async fn import_obsidian_vault(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Option<obsidian_import::ImportSummary>> {
    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            app.dialog()
                .file()
                .set_title("Select your Obsidian vault folder")
                .blocking_pick_folder()
        }
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let Some(picked) = picked else {
        return Ok(None);
    };
    let source = picked
        .into_path()
        .map_err(|e| AppError::InvalidPath(e.to_string()))?;

    let root = state.root()?;
    let summary = tauri::async_runtime::spawn_blocking(move || {
        obsidian_import::import_vault(&root, &source)
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))??;

    Ok(Some(summary))
}

/// Prompt for a location + name, create that folder as a fresh vault, and
/// activate it. Async so the blocking save dialog runs off the main thread.
#[tauri::command]
pub async fn create_vault(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Option<VaultSnapshot>> {
    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            app.dialog()
                .file()
                .set_file_name("Xuro Vault")
                .blocking_save_file()
        }
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let Some(dest) = picked else {
        return Ok(None);
    };
    let root = dest
        .into_path()
        .map_err(|e| AppError::InvalidPath(e.to_string()))?;
    std::fs::create_dir_all(&root)?;
    activate_vault(&app, &state, root).map(Some)
}

#[tauri::command]
pub fn load_tree(state: State<'_, AppState>) -> AppResult<Vec<TreeNode>> {
    vault::scan_tree(&state.root()?)
}

// ---- notes ----

#[tauri::command]
pub fn read_note(state: State<'_, AppState>, rel: String) -> AppResult<String> {
    notes::read_note(&state.root()?, &rel)
}

#[tauri::command]
pub fn write_note(state: State<'_, AppState>, rel: String, content: String) -> AppResult<()> {
    notes::write_note(&state.root()?, &rel, &content)
}

#[tauri::command]
pub fn create_note(state: State<'_, AppState>, dir: String, title: String) -> AppResult<String> {
    notes::create_note(&state.root()?, &dir, &title)
}

#[tauri::command]
pub fn create_note_with_content(
    state: State<'_, AppState>,
    dir: String,
    title: String,
    content: String,
) -> AppResult<String> {
    notes::create_note_with_content(&state.root()?, &dir, &title, &content)
}

#[tauri::command]
pub fn open_daily_note(state: State<'_, AppState>, date: String) -> AppResult<String> {
    daily_notes::open_or_create(&state.root()?, &date)
}

#[tauri::command]
pub fn show_quick_capture(app: AppHandle) -> AppResult<()> {
    quick_capture::show(&app)
}

#[tauri::command]
pub fn close_quick_capture(app: AppHandle) -> AppResult<()> {
    quick_capture::close(&app)
}

#[tauri::command]
pub fn create_folder(state: State<'_, AppState>, dir: String, name: String) -> AppResult<String> {
    notes::create_folder(&state.root()?, &dir, &name)
}

#[tauri::command]
pub fn rename_entry(state: State<'_, AppState>, rel: String, name: String) -> AppResult<String> {
    notes::rename_entry(&state.root()?, &rel, &name)
}

#[tauri::command]
pub fn move_entry(state: State<'_, AppState>, rel: String, dir: String) -> AppResult<String> {
    notes::move_entry(&state.root()?, &rel, &dir)
}

#[tauri::command]
pub fn delete_entry(state: State<'_, AppState>, rel: String) -> AppResult<()> {
    notes::delete_entry(&state.root()?, &rel)
}

#[tauri::command]
pub fn search_notes(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> AppResult<Vec<SearchHit>> {
    search::search_notes(&state.root()?, &query, limit.unwrap_or(30))
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> AppResult<Vec<tags::TagEntry>> {
    tags::list_tags(&state.root()?)
}

// ---- snippets ----

#[tauri::command]
pub fn snippets_list(state: State<'_, AppState>) -> AppResult<Vec<snippets::Snippet>> {
    snippets::list(&state.root()?)
}

#[tauri::command]
pub fn snippet_add(
    state: State<'_, AppState>,
    title: String,
    language: String,
    content: String,
) -> AppResult<snippets::Snippet> {
    snippets::add(&state.root()?, &title, &language, &content)
}

#[tauri::command]
pub fn snippet_update(
    state: State<'_, AppState>,
    id: String,
    title: String,
    language: String,
    content: String,
) -> AppResult<snippets::Snippet> {
    snippets::update(&state.root()?, &id, &title, &language, &content)
}

#[tauri::command]
pub fn snippet_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    snippets::delete(&state.root()?, &id)
}

// ---- templates ----

#[tauri::command]
pub fn templates_list(state: State<'_, AppState>) -> AppResult<Vec<templates::Template>> {
    templates::list(&state.root()?)
}

#[tauri::command]
pub fn template_add(
    state: State<'_, AppState>,
    title: String,
    content: String,
) -> AppResult<templates::Template> {
    templates::add(&state.root()?, &title, &content)
}

#[tauri::command]
pub fn template_update(
    state: State<'_, AppState>,
    id: String,
    title: String,
    content: String,
) -> AppResult<templates::Template> {
    templates::update(&state.root()?, &id, &title, &content)
}

#[tauri::command]
pub fn template_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    templates::delete(&state.root()?, &id)
}

#[tauri::command]
pub fn template_create_note(
    state: State<'_, AppState>,
    id: String,
    dir: String,
    title: String,
) -> AppResult<String> {
    templates::create_note_from(&state.root()?, &id, &dir, &title)
}

/// Resolve a template's placeholders without creating a note — used to
/// insert a template's content into the note that's already open.
#[tauri::command]
pub fn template_resolve(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> AppResult<String> {
    templates::resolve(&state.root()?, &id, &title)
}

// ---- canvas (Excalidraw) ----

#[tauri::command]
pub fn canvases_list(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    canvas::list(&state.root()?)
}

#[tauri::command]
pub fn canvas_read(state: State<'_, AppState>, rel: String) -> AppResult<String> {
    canvas::read(&state.root()?, &rel)
}

#[tauri::command]
pub fn canvas_write(state: State<'_, AppState>, rel: String, content: String) -> AppResult<()> {
    canvas::write(&state.root()?, &rel, &content)
}

#[tauri::command]
pub fn canvas_create(state: State<'_, AppState>, title: String) -> AppResult<String> {
    canvas::create(&state.root()?, &title)
}

#[tauri::command]
pub fn backlinks_for(state: State<'_, AppState>, rel: String) -> AppResult<Vec<BacklinkMention>> {
    backlinks::find_backlinks(&state.root()?, &rel)
}

#[tauri::command]
pub fn graph_data(state: State<'_, AppState>) -> AppResult<graph::Graph> {
    graph::build_graph(&state.root()?)
}

// ---- publishing ----

#[tauri::command]
pub async fn cloud_account_status(app: AppHandle) -> AppResult<cloud::CloudAccountStatus> {
    cloud::account_status(&app).await
}

#[tauri::command]
pub async fn cloud_request_otp(email: String) -> AppResult<cloud::OtpChallenge> {
    cloud::request_otp(&email).await
}

#[tauri::command]
pub async fn cloud_verify_otp(
    app: AppHandle,
    challenge_id: String,
    code: String,
) -> AppResult<cloud::CloudAccount> {
    cloud::verify_otp(&app, &challenge_id, &code).await
}

#[tauri::command]
pub async fn cloud_sign_out(app: AppHandle) -> AppResult<()> {
    cloud::sign_out(&app).await
}

#[tauri::command]
pub async fn cloud_plans_url(app: AppHandle) -> AppResult<String> {
    cloud::plans_url(&app).await
}

#[tauri::command]
pub async fn cloud_billing_portal_url(app: AppHandle) -> AppResult<String> {
    cloud::portal_url(&app).await
}

#[tauri::command]
pub async fn published_note_status(
    app: AppHandle,
    state: State<'_, AppState>,
    rel: String,
    title: String,
    content: String,
    pages: Vec<cloud::PublishPageDraft>,
) -> AppResult<cloud::PublishedNoteStatus> {
    cloud::status(&app, &state.root()?, &rel, &title, &content, pages).await
}

#[tauri::command]
pub fn is_note_published(state: State<'_, AppState>, rel: String) -> AppResult<bool> {
    crate::cloud_metadata::has_published_under(&state.root()?, &rel)
}

#[tauri::command]
pub async fn publish_note(
    app: AppHandle,
    state: State<'_, AppState>,
    rel: String,
    title: String,
    content: String,
    pages: Vec<cloud::PublishPageDraft>,
) -> AppResult<crate::cloud_metadata::PublishedShare> {
    let root = state.root()?;
    if locks::is_locked(&root, &rel) || pages.iter().any(|page| locks::is_locked(&root, &page.rel))
    {
        return Err(AppError::InvalidInput(
            "remove the PIN before publishing a locked note".to_string(),
        ));
    }
    cloud::publish(&app, &root, &rel, &title, &content, pages).await
}

#[tauri::command]
pub async fn update_published_note(
    app: AppHandle,
    state: State<'_, AppState>,
    rel: String,
    title: String,
    content: String,
    pages: Vec<cloud::PublishPageDraft>,
) -> AppResult<crate::cloud_metadata::PublishedShare> {
    let root = state.root()?;
    if locks::is_locked(&root, &rel) || pages.iter().any(|page| locks::is_locked(&root, &page.rel))
    {
        return Err(AppError::InvalidInput(
            "remove the PIN before updating a locked note's published copy".to_string(),
        ));
    }
    cloud::update(&app, &root, &rel, &title, &content, pages).await
}

#[tauri::command]
pub async fn revoke_published_note(
    app: AppHandle,
    state: State<'_, AppState>,
    rel: String,
) -> AppResult<()> {
    cloud::revoke(&app, &state.root()?, &rel).await
}

// ---- pins ----

#[tauri::command]
pub fn pins_list(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    pins::list(&state.root()?)
}

#[tauri::command]
pub fn pin_note(app: AppHandle, state: State<'_, AppState>, rel: String) -> AppResult<Vec<String>> {
    let root = state.root()?;
    let pins = pins::pin(&root, &rel)?;
    tray::refresh(&app, Some(&root));
    Ok(pins)
}

#[tauri::command]
pub fn unpin_note(app: AppHandle, state: State<'_, AppState>, rel: String) -> AppResult<Vec<String>> {
    let root = state.root()?;
    let pins = pins::unpin(&root, &rel)?;
    tray::refresh(&app, Some(&root));
    Ok(pins)
}

// ---- locks ----
//
// PIN locks are an in-app access gate (see locks.rs docs), not encryption.
// `lock_set_pin` requires the current PIN when replacing an existing one;
// the only way to bypass a forgotten PIN is `lock_remove` from Settings,
// which removes the lock outright rather than revealing or resetting it
// silently.

#[tauri::command]
pub fn locks_list(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    locks::list(&state.root()?)
}

#[tauri::command]
pub fn lock_is_locked(state: State<'_, AppState>, rel: String) -> AppResult<bool> {
    Ok(locks::is_locked(&state.root()?, &rel))
}

#[tauri::command]
pub fn lock_set_pin(
    state: State<'_, AppState>,
    rel: String,
    pin: String,
    old_pin: Option<String>,
) -> AppResult<()> {
    let root = state.root()?;
    if locks::is_locked(&root, &rel) {
        let current = old_pin.unwrap_or_default();
        if !locks::verify_pin(&root, &rel, &current)? {
            return Err(AppError::InvalidInput(
                "current PIN is incorrect".to_string(),
            ));
        }
    }
    locks::set_pin(&root, &rel, &pin)
}

#[tauri::command]
pub fn lock_verify(state: State<'_, AppState>, rel: String, pin: String) -> AppResult<bool> {
    locks::verify_pin(&state.root()?, &rel, &pin)
}

#[tauri::command]
pub fn lock_remove(state: State<'_, AppState>, rel: String) -> AppResult<()> {
    locks::remove_lock(&state.root()?, &rel)
}

// ---- todos ----

#[tauri::command]
pub fn todos_list(state: State<'_, AppState>) -> AppResult<Vec<Todo>> {
    todos::list(&state.root()?)
}

#[tauri::command]
pub fn todo_add(state: State<'_, AppState>, text: String, board_id: String) -> AppResult<Todo> {
    todos::add(&state.root()?, &text, &board_id)
}

#[tauri::command]
pub fn todo_toggle(state: State<'_, AppState>, id: String) -> AppResult<Todo> {
    todos::toggle(&state.root()?, &id)
}

#[tauri::command]
pub fn todo_set_status(
    state: State<'_, AppState>,
    id: String,
    status: todos::TodoStatus,
) -> AppResult<Todo> {
    todos::set_status(&state.root()?, &id, status)
}

#[tauri::command]
pub fn todo_update(state: State<'_, AppState>, id: String, text: String) -> AppResult<Todo> {
    todos::update_text(&state.root()?, &id, &text)
}

#[tauri::command]
pub fn todo_set_tags(state: State<'_, AppState>, id: String, tags: Vec<String>) -> AppResult<Todo> {
    todos::set_tags(&state.root()?, &id, tags)
}

#[tauri::command]
pub fn todo_tags_list(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    todos::list_tags(&state.root()?)
}

#[tauri::command]
pub fn todo_tag_create(state: State<'_, AppState>, name: String) -> AppResult<Vec<String>> {
    todos::create_tag(&state.root()?, &name)
}

#[tauri::command]
pub fn todo_tag_delete(state: State<'_, AppState>, name: String) -> AppResult<Vec<String>> {
    todos::delete_tag(&state.root()?, &name)
}

#[tauri::command]
pub fn todo_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    todos::delete(&state.root()?, &id)
}

#[tauri::command]
pub fn todos_clear_completed(state: State<'_, AppState>) -> AppResult<Vec<Todo>> {
    todos::clear_completed(&state.root()?)
}

// ---- kanban boards ----

#[tauri::command]
pub fn boards_list(state: State<'_, AppState>) -> AppResult<Vec<Board>> {
    boards::list(&state.root()?)
}

#[tauri::command]
pub fn board_create(state: State<'_, AppState>, title: String) -> AppResult<Board> {
    boards::create(&state.root()?, &title)
}

#[tauri::command]
pub fn board_rename(state: State<'_, AppState>, id: String, title: String) -> AppResult<Board> {
    boards::rename(&state.root()?, &id, &title)
}

#[tauri::command]
pub fn board_delete(state: State<'_, AppState>, id: String) -> AppResult<Vec<Board>> {
    boards::delete(&state.root()?, &id)
}

// ---- library (books/manga) ----

#[tauri::command]
pub fn library_list(state: State<'_, AppState>) -> AppResult<Vec<LibraryItem>> {
    library::list(&state.root()?)
}

#[tauri::command]
pub async fn library_search_books(query: String) -> AppResult<Vec<LibrarySearchResult>> {
    library::search_books(&query).await
}

#[tauri::command]
pub async fn library_search_manga(query: String) -> AppResult<Vec<LibrarySearchResult>> {
    library::search_manga(&query).await
}

#[tauri::command]
pub fn library_add_from_search(
    state: State<'_, AppState>,
    result: LibrarySearchResult,
) -> AppResult<LibraryItem> {
    library::add_from_search(&state.root()?, result)
}

#[tauri::command]
pub fn library_upload(
    state: State<'_, AppState>,
    source_path: String,
    title: String,
    author: Option<String>,
    kind: library::LibraryKind,
) -> AppResult<LibraryItem> {
    library::upload(&state.root()?, &source_path, &title, author, kind)
}

#[tauri::command]
pub fn library_remove(state: State<'_, AppState>, id: String) -> AppResult<()> {
    library::remove(&state.root()?, &id)
}

#[tauri::command]
pub fn library_attach_file(
    state: State<'_, AppState>,
    id: String,
    source_path: String,
) -> AppResult<LibraryItem> {
    library::attach_file(&state.root()?, &id, &source_path)
}

#[tauri::command]
pub fn library_set_last_page(
    state: State<'_, AppState>,
    id: String,
    page: u32,
) -> AppResult<LibraryItem> {
    library::set_last_page(&state.root()?, &id, page)
}

/// Base64-encoded bytes of an uploaded library file, for the in-app PDF
/// reader. Deliberately not the Tauri asset protocol / an `<iframe src>` —
/// reading bytes over the existing command channel needs no asset-scope or
/// CSP changes at all, at the cost of holding the whole file in memory
/// once. Fine for a typical ebook/PDF; a very large scanned volume will be
/// slower to open.
#[tauri::command]
pub fn library_read_file(state: State<'_, AppState>, id: String) -> AppResult<String> {
    library::read_file_base64(&state.root()?, &id)
}

// ---- online manga: catalog (network only, no vault state needed) ----

#[tauri::command]
pub async fn manga_online_browse(params: MangaBrowseParams) -> AppResult<MangaPage> {
    manga_source::browse(params).await
}

#[tauri::command]
pub async fn manga_online_details(manga_id: String) -> AppResult<MangaDetails> {
    manga_source::details(&manga_id).await
}

#[tauri::command]
pub async fn manga_online_chapters(
    manga_id: String,
    language: Option<manga_source::MangaLanguage>,
    page: u32,
) -> AppResult<Vec<MangaChapter>> {
    manga_source::chapters(&manga_id, language, page).await
}

#[tauri::command]
pub async fn manga_online_chapter_pages(chapter_id: String) -> AppResult<manga_source::ChapterPages> {
    manga_source::chapter_pages(&chapter_id).await
}

#[tauri::command]
pub async fn manga_online_genres() -> AppResult<Vec<MangaTag>> {
    manga_source::genres().await
}

// ---- online manga: follows, progress, history, bookmarks, downloads ----

#[tauri::command]
pub fn manga_follows_list(state: State<'_, AppState>) -> AppResult<Vec<MangaFollow>> {
    manga_online::list_follows(&state.root()?)
}

#[tauri::command]
pub async fn manga_follow(
    state: State<'_, AppState>,
    manga_id: String,
    title: String,
    cover_url: Option<String>,
) -> AppResult<MangaFollow> {
    let root = state.root()?;
    manga_online::follow(&root, &manga_id, &title, cover_url).await
}

#[tauri::command]
pub fn manga_unfollow(state: State<'_, AppState>, manga_id: String) -> AppResult<()> {
    manga_online::unfollow(&state.root()?, &manga_id)
}

#[tauri::command]
pub fn manga_set_favorite(
    state: State<'_, AppState>,
    manga_id: String,
    favorite: bool,
) -> AppResult<MangaFollow> {
    manga_online::set_favorite(&state.root()?, &manga_id, favorite)
}

#[tauri::command]
pub fn manga_mark_seen(state: State<'_, AppState>, manga_id: String) -> AppResult<()> {
    manga_online::mark_seen(&state.root()?, &manga_id)
}

#[tauri::command]
pub async fn manga_check_updates(state: State<'_, AppState>) -> AppResult<Vec<MangaFollow>> {
    let root = state.root()?;
    manga_online::check_updates(&root).await
}

#[tauri::command]
pub fn manga_progress_list(state: State<'_, AppState>) -> AppResult<Vec<ReadingProgress>> {
    manga_online::list_progress(&state.root()?)
}

#[tauri::command]
pub fn manga_progress_get(
    state: State<'_, AppState>,
    manga_id: String,
) -> AppResult<Option<ReadingProgress>> {
    manga_online::get_progress(&state.root()?, &manga_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn manga_progress_set(
    state: State<'_, AppState>,
    manga_id: String,
    manga_title: String,
    cover_url: Option<String>,
    chapter_id: String,
    chapter_label: String,
    page: u32,
    page_count: u32,
) -> AppResult<ReadingProgress> {
    manga_online::set_progress(
        &state.root()?,
        &manga_id,
        &manga_title,
        cover_url,
        &chapter_id,
        &chapter_label,
        page,
        page_count,
    )
}

#[tauri::command]
pub fn manga_history_list(state: State<'_, AppState>) -> AppResult<Vec<HistoryEntry>> {
    manga_online::list_history(&state.root()?)
}

#[tauri::command]
pub fn manga_history_clear(state: State<'_, AppState>) -> AppResult<()> {
    manga_online::clear_history(&state.root()?)
}

#[tauri::command]
pub fn manga_bookmarks_list(
    state: State<'_, AppState>,
    manga_id: Option<String>,
) -> AppResult<Vec<MangaBookmarkEntry>> {
    manga_online::list_bookmarks(&state.root()?, manga_id.as_deref())
}

#[tauri::command]
pub fn manga_bookmark_add(
    state: State<'_, AppState>,
    manga_id: String,
    manga_title: String,
    chapter_id: String,
    chapter_label: String,
    page: u32,
) -> AppResult<MangaBookmarkEntry> {
    manga_online::add_bookmark(
        &state.root()?,
        &manga_id,
        &manga_title,
        &chapter_id,
        &chapter_label,
        page,
    )
}

#[tauri::command]
pub fn manga_bookmark_remove(state: State<'_, AppState>, id: String) -> AppResult<()> {
    manga_online::remove_bookmark(&state.root()?, &id)
}

#[tauri::command]
pub fn manga_downloads_list(
    state: State<'_, AppState>,
    manga_id: Option<String>,
) -> AppResult<Vec<DownloadedChapter>> {
    manga_online::list_downloads(&state.root()?, manga_id.as_deref())
}

#[tauri::command]
pub fn manga_is_downloaded(state: State<'_, AppState>, chapter_id: String) -> AppResult<bool> {
    manga_online::is_downloaded(&state.root()?, &chapter_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn manga_download_chapter(
    state: State<'_, AppState>,
    manga_id: String,
    manga_title: String,
    cover_url: Option<String>,
    chapter_id: String,
    chapter_label: String,
    language: String,
) -> AppResult<DownloadedChapter> {
    let root = state.root()?;
    manga_online::download_chapter(
        &root,
        &manga_id,
        &manga_title,
        cover_url,
        &chapter_id,
        &chapter_label,
        &language,
    )
    .await
}

#[tauri::command]
pub fn manga_download_remove(state: State<'_, AppState>, chapter_id: String) -> AppResult<()> {
    manga_online::remove_download(&state.root()?, &chapter_id)
}

#[tauri::command]
pub fn manga_download_read_page(
    state: State<'_, AppState>,
    chapter_id: String,
    page_index: usize,
) -> AppResult<String> {
    manga_online::read_downloaded_page(&state.root()?, &chapter_id, page_index)
}

// ---- Inkwell (studio) ----

#[tauri::command]
pub fn studio_list(state: State<'_, AppState>) -> AppResult<Vec<ProjectSummary>> {
    studio::list(&state.root()?)
}

#[tauri::command]
pub fn studio_get(state: State<'_, AppState>, project_id: String) -> AppResult<Project> {
    studio::get(&state.root()?, &project_id)
}

#[tauri::command]
pub fn studio_create(state: State<'_, AppState>, title: String) -> AppResult<Project> {
    studio::create(&state.root()?, &title)
}

#[tauri::command]
pub fn studio_rename(
    state: State<'_, AppState>,
    project_id: String,
    title: String,
) -> AppResult<ProjectSummary> {
    studio::rename(&state.root()?, &project_id, &title)
}

#[tauri::command]
pub fn studio_delete(state: State<'_, AppState>, project_id: String) -> AppResult<()> {
    studio::delete(&state.root()?, &project_id)
}

#[tauri::command]
pub fn studio_add_chapter(
    state: State<'_, AppState>,
    project_id: String,
    title: String,
) -> AppResult<Chapter> {
    studio::add_chapter(&state.root()?, &project_id, &title)
}

#[tauri::command]
pub fn studio_update_chapter(
    state: State<'_, AppState>,
    project_id: String,
    chapter_id: String,
    title: String,
    content: String,
    word_count: u32,
) -> AppResult<Chapter> {
    studio::update_chapter(&state.root()?, &project_id, &chapter_id, &title, &content, word_count)
}

#[tauri::command]
pub fn studio_delete_chapter(
    state: State<'_, AppState>,
    project_id: String,
    chapter_id: String,
) -> AppResult<()> {
    studio::delete_chapter(&state.root()?, &project_id, &chapter_id)
}

#[tauri::command]
pub fn studio_reorder_chapters(
    state: State<'_, AppState>,
    project_id: String,
    ordered_ids: Vec<String>,
) -> AppResult<Project> {
    studio::reorder_chapters(&state.root()?, &project_id, &ordered_ids)
}

/// Saves plain text (Markdown or .txt) to a location the person picks —
/// the frontend flattens Tiptap's HTML to plain text itself (trivial via
/// `editor.getText()`), so this command is just "open a save dialog and
/// write bytes", same shape as the other export commands below it.
#[tauri::command]
pub async fn studio_export_text(
    app: AppHandle,
    project_title: String,
    extension: String,
    text: String,
) -> AppResult<Option<String>> {
    let file_name = format!("{}.{}", crate::util::sanitize_name(&project_title), extension);
    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || app.dialog().file().set_file_name(file_name).blocking_save_file()
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;
    let Some(dest) = picked else {
        return Ok(None);
    };
    let path = dest
        .into_path()
        .map_err(|e| AppError::InvalidPath(e.to_string()))?;
    std::fs::write(&path, text)?;
    Ok(Some(path.display().to_string()))
}

/// Same rendered-client-side-to-PDF approach as `export_note_pdf`, kept as
/// its own command rather than reused since that one is tightly coupled to
/// an existing note (`notes::read_note`) — Inkwell projects aren't notes.
#[tauri::command]
pub async fn studio_export_pdf(
    app: AppHandle,
    project_title: String,
    pdf_base64: String,
) -> AppResult<Option<String>> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    let file_name = format!("{}.pdf", crate::util::sanitize_name(&project_title));
    let bytes = STANDARD
        .decode(pdf_base64)
        .map_err(|e| AppError::InvalidInput(format!("invalid PDF data: {e}")))?;

    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || app.dialog().file().set_file_name(file_name).blocking_save_file()
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;
    let Some(dest) = picked else {
        return Ok(None);
    };
    let path = dest
        .into_path()
        .map_err(|e| AppError::InvalidPath(e.to_string()))?;
    std::fs::write(&path, bytes)?;
    Ok(Some(path.display().to_string()))
}

// ---- debug log ----

#[tauri::command]
pub fn debug_log_add(
    app: AppHandle,
    level: String,
    source: String,
    message: String,
    context: Option<String>,
) {
    crate::debug_log::add(&app, &level, &source, &message, context);
}

#[tauri::command]
pub fn debug_log_list(app: AppHandle) -> Vec<crate::debug_log::DebugEntry> {
    crate::debug_log::list(&app)
}

#[tauri::command]
pub fn debug_log_clear(app: AppHandle) -> AppResult<()> {
    crate::debug_log::clear(&app)
}

#[tauri::command]
pub async fn debug_health_check(state: State<'_, AppState>) -> AppResult<crate::debug_log::HealthCheck> {
    let vault_root = state.root().ok();
    Ok(crate::debug_log::run_health_check(vault_root).await)
}

/// Open a native file picker for a book/manga file to upload. Returns the
/// picked path as a string for the frontend to pass straight to
/// `library_upload`; async for the same reason as `choose_vault` — the
/// blocking dialog call must not run on the main thread.
#[tauri::command]
pub async fn library_pick_upload_file(app: AppHandle) -> AppResult<Option<String>> {
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title("Choose a book or manga file")
            .add_filter("Documents", &["pdf", "epub", "cbz", "cbr"])
            .blocking_pick_file()
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|e| AppError::InvalidPath(e.to_string()))?;
    Ok(Some(path.to_string_lossy().to_string()))
}

// ---- bookmarks ----

#[tauri::command]
pub fn bookmarks_list(state: State<'_, AppState>) -> AppResult<Vec<Bookmark>> {
    bookmarks::list(&state.root()?)
}

#[tauri::command]
pub fn bookmark_add(state: State<'_, AppState>, url: String) -> AppResult<Bookmark> {
    bookmarks::add(&state.root()?, &url)
}

#[tauri::command]
pub fn bookmark_update_title(
    state: State<'_, AppState>,
    id: String,
    title: String,
) -> AppResult<Bookmark> {
    bookmarks::update(&state.root()?, &id, Some(title), None, None, None)
}

#[tauri::command]
pub fn bookmark_set_tags(
    state: State<'_, AppState>,
    id: String,
    tags: Vec<String>,
) -> AppResult<Bookmark> {
    bookmarks::set_tags(&state.root()?, &id, tags)
}

#[tauri::command]
pub fn bookmark_tags_list(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    bookmarks::list_tags(&state.root()?)
}

#[tauri::command]
pub fn bookmark_tag_create(state: State<'_, AppState>, name: String) -> AppResult<Vec<String>> {
    bookmarks::create_tag(&state.root()?, &name)
}

#[tauri::command]
pub fn bookmark_tag_delete(state: State<'_, AppState>, name: String) -> AppResult<Vec<String>> {
    bookmarks::delete_tag(&state.root()?, &name)
}

#[tauri::command]
pub fn bookmark_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    bookmarks::delete(&state.root()?, &id)
}

/// Export all bookmarks to a markdown file the user picks. Async so the
/// blocking save dialog runs off the main thread. Returns the written path,
/// or None if the user cancelled.
#[tauri::command]
pub async fn export_bookmarks(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<Option<String>> {
    let markdown = bookmarks::to_markdown(&bookmarks::list(&state.root()?)?);

    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            app.dialog()
                .file()
                .set_file_name("bookmarks.md")
                .blocking_save_file()
        }
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let Some(dest) = picked else {
        return Ok(None);
    };
    let path = dest
        .into_path()
        .map_err(|e| AppError::InvalidPath(e.to_string()))?;
    std::fs::write(&path, markdown)?;
    Ok(Some(path.display().to_string()))
}

/// Export the current note as a PDF, from bytes rendered client-side (the
/// frontend renders the live editor DOM to PDF so math, tables, and images
/// come out exactly as shown — Rust just picks a destination and writes the
/// bytes). `pdf_base64` is the PDF file contents, base64-encoded.
#[tauri::command]
pub async fn export_note_pdf(
    app: AppHandle,
    state: State<'_, AppState>,
    rel: String,
    pdf_base64: String,
) -> AppResult<Option<String>> {
    use base64::engine::general_purpose::STANDARD;
    use base64::Engine;

    // Validate that the source note still exists and `rel` stays in the vault.
    notes::read_note(&state.root()?, &rel)?;
    let file_name = PathBuf::from(&rel)
        .file_stem()
        .map(|stem| format!("{}.pdf", stem.to_string_lossy()))
        .unwrap_or_else(|| "note.pdf".to_string());

    let bytes = STANDARD
        .decode(pdf_base64)
        .map_err(|e| AppError::InvalidInput(format!("invalid PDF data: {e}")))?;

    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            app.dialog()
                .file()
                .set_file_name(file_name)
                .add_filter("PDF", &["pdf"])
                .blocking_save_file()
        }
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let Some(dest) = picked else {
        return Ok(None);
    };
    let path = dest
        .into_path()
        .map_err(|e| AppError::InvalidPath(e.to_string()))?;
    std::fs::write(&path, bytes)?;
    Ok(Some(path.display().to_string()))
}

/// Export the current note contents to a markdown file chosen by the user.
/// The frontend supplies its live editor contents so an in-flight autosave
/// cannot make the exported copy stale.
#[tauri::command]
pub async fn export_note(
    app: AppHandle,
    state: State<'_, AppState>,
    rel: String,
    content: String,
) -> AppResult<Option<String>> {
    // Validate that the source note still exists and `rel` stays in the vault.
    notes::read_note(&state.root()?, &rel)?;
    let file_name = PathBuf::from(&rel)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "note.md".to_string());

    let picked = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || {
            app.dialog()
                .file()
                .set_file_name(file_name)
                .blocking_save_file()
        }
    })
    .await
    .map_err(|e| AppError::Other(e.to_string()))?;

    let Some(dest) = picked else {
        return Ok(None);
    };
    let path = dest
        .into_path()
        .map_err(|e| AppError::InvalidPath(e.to_string()))?;
    std::fs::write(&path, content)?;
    Ok(Some(path.display().to_string()))
}

/// Fetch title/preview-image/favicon for a bookmark and persist them.
/// Marks the bookmark as fetched even on failure so the UI can offer retry
/// without hammering the network on every load.
#[tauri::command]
pub async fn bookmark_fetch_meta(state: State<'_, AppState>, id: String) -> AppResult<Bookmark> {
    let root = state.root()?;
    let bookmark = bookmarks::list(&root)?
        .into_iter()
        .find(|b| b.id == id)
        .ok_or_else(|| AppError::NotFound(id.clone()))?;

    match link_meta::fetch(&bookmark.url).await {
        Ok(meta) => bookmarks::update(&root, &id, meta.title, meta.image, meta.favicon, Some(true)),
        Err(_) => bookmarks::update(&root, &id, None, None, None, Some(true)),
    }
}

// ---- assets / misc ----

#[tauri::command]
pub fn save_image_asset(
    state: State<'_, AppState>,
    data: String,
    extension: String,
) -> AppResult<String> {
    let path = assets::save_image(&state.root()?, &data, &extension)?;
    Ok(path.display().to_string())
}

#[tauri::command]
pub fn set_theme(app: AppHandle, theme: Theme) -> AppResult<()> {
    let mut cfg = config::load(&app);
    cfg.theme = theme;
    config::save(&app, &cfg)
}

#[tauri::command]
pub fn get_theme(app: AppHandle) -> Theme {
    config::load(&app).theme
}

#[tauri::command]
pub fn set_accent_color(
    app: AppHandle,
    accent_color: AccentColor,
    custom_hex: Option<String>,
) -> AppResult<()> {
    let mut cfg = config::load(&app);
    if accent_color == AccentColor::Custom {
        let hex = custom_hex
            .as_deref()
            .ok_or_else(|| AppError::InvalidInput("custom accent color is required".into()))?;
        cfg.accent_custom_hex = Some(validate_hex_color(hex)?);
    }
    cfg.accent_color = accent_color;
    config::save(&app, &cfg)
}

#[tauri::command]
pub fn get_accent_color(app: AppHandle) -> (AccentColor, Option<String>) {
    let cfg = config::load(&app);
    (cfg.accent_color, cfg.accent_custom_hex)
}

#[tauri::command]
pub fn set_background_style(app: AppHandle, background_style: BackgroundStyle) -> AppResult<()> {
    let mut cfg = config::load(&app);
    cfg.background_style = background_style;
    config::save(&app, &cfg)
}

#[tauri::command]
pub fn get_background_style(app: AppHandle) -> BackgroundStyle {
    config::load(&app).background_style
}

/// Accepts `#rgb`, `#rrggbb`, or `#rrggbbaa` only — rejects anything else so
/// a stray value can never inject extra CSS through a custom property.
fn validate_hex_color(value: &str) -> AppResult<String> {
    let ok = matches!(value.len(), 4 | 7 | 9)
        && value.starts_with('#')
        && value[1..].chars().all(|c| c.is_ascii_hexdigit());
    if ok {
        Ok(value.to_lowercase())
    } else {
        Err(AppError::InvalidInput(format!(
            "'{value}' is not a valid hex color"
        )))
    }
}
