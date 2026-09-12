//! Online Manga: everything Xuro remembers locally about the online
//! catalog — followed titles, reading progress, history, bookmarks, and
//! offline chapter downloads. `manga_source.rs` is the only thing that
//! talks to the network; this module owns the on-disk state and the
//! rate-limited "did any followed manga update" sweep.
//!
//! Deliberately kept entirely separate from `library.rs`'s
//! `library.json`/`LibraryItem` (the existing local Manga/Books list) —
//! Online Manga is its own catalog with its own metadata, so the two never
//! collide or need reconciling. Downloaded chapters *do* live inside the
//! vault's existing `Library/` folder (under `Library/OnlineManga/…`), the
//! same "it's just a real part of the vault" storage model `library.rs`
//! and `canvas.rs` already use — but they're tracked in their own store
//! and shown in their own section of the UI, never merged into "Your
//! library".

use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::library::LIBRARY_FOLDER;
use crate::manga_source::{self, ChapterPages};
use crate::util::{now_ms, sanitize_name};
use crate::vault::{notes_root, DATA_DIR};

const ONLINE_MANGA_SUBFOLDER: &str = "OnlineManga";
const MAX_HISTORY: usize = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaFollow {
    pub manga_id: String,
    pub title: String,
    pub cover_url: Option<String>,
    pub followed_at: i64,
    #[serde(default)]
    pub is_favorite: bool,
    #[serde(default)]
    pub last_known_chapter_id: Option<String>,
    #[serde(default)]
    pub last_known_chapter_label: Option<String>,
    #[serde(default)]
    pub has_update: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgress {
    pub manga_id: String,
    pub manga_title: String,
    pub cover_url: Option<String>,
    pub chapter_id: String,
    pub chapter_label: String,
    pub page: u32,
    pub page_count: u32,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub manga_id: String,
    pub manga_title: String,
    pub cover_url: Option<String>,
    pub chapter_id: String,
    pub chapter_label: String,
    pub read_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaBookmarkEntry {
    pub id: String,
    pub manga_id: String,
    pub manga_title: String,
    pub chapter_id: String,
    pub chapter_label: String,
    pub page: u32,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadedChapter {
    pub manga_id: String,
    pub manga_title: String,
    pub cover_url: Option<String>,
    pub chapter_id: String,
    pub chapter_label: String,
    pub language: String,
    pub folder_rel: String,
    pub page_files: Vec<String>,
    pub downloaded_at: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Store {
    #[serde(default)]
    follows: Vec<MangaFollow>,
    #[serde(default)]
    progress: Vec<ReadingProgress>,
    #[serde(default)]
    history: Vec<HistoryEntry>,
    #[serde(default)]
    bookmarks: Vec<MangaBookmarkEntry>,
    #[serde(default)]
    downloads: Vec<DownloadedChapter>,
}

fn store_path(root: &Path) -> PathBuf {
    root.join(DATA_DIR).join("online_manga.json")
}

fn read(root: &Path) -> AppResult<Store> {
    let path = store_path(root);
    if !path.exists() {
        return Ok(Store::default());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?).unwrap_or_default())
}

fn save(root: &Path, store: &Store) -> AppResult<()> {
    fs::write(store_path(root), serde_json::to_string_pretty(store)?)?;
    Ok(())
}

fn downloads_root(root: &Path) -> PathBuf {
    notes_root(root).join(LIBRARY_FOLDER).join(ONLINE_MANGA_SUBFOLDER)
}

// ---- follows ----

pub fn list_follows(root: &Path) -> AppResult<Vec<MangaFollow>> {
    Ok(read(root)?.follows)
}

/// Follows a manga, best-effort recording today's latest readable chapter
/// as the baseline so the very first update check afterwards doesn't
/// falsely flag "new chapter" for something that was already out when the
/// person hit Follow.
pub async fn follow(
    root: &Path,
    manga_id: &str,
    title: &str,
    cover_url: Option<String>,
) -> AppResult<MangaFollow> {
    let mut store = read(root)?;
    if let Some(existing) = store.follows.iter().find(|f| f.manga_id == manga_id) {
        return Ok(existing.clone());
    }
    let baseline = manga_source::latest_chapter_marker(manga_id, None)
        .await
        .ok()
        .flatten();
    let entry = MangaFollow {
        manga_id: manga_id.to_string(),
        title: title.to_string(),
        cover_url,
        followed_at: now_ms(),
        is_favorite: false,
        last_known_chapter_id: baseline.as_ref().map(|(id, _)| id.clone()),
        last_known_chapter_label: baseline.map(|(_, label)| label),
        has_update: false,
    };
    store.follows.insert(0, entry.clone());
    save(root, &store)?;
    Ok(entry)
}

pub fn unfollow(root: &Path, manga_id: &str) -> AppResult<()> {
    let mut store = read(root)?;
    store.follows.retain(|f| f.manga_id != manga_id);
    save(root, &store)
}

pub fn set_favorite(root: &Path, manga_id: &str, favorite: bool) -> AppResult<MangaFollow> {
    let mut store = read(root)?;
    let entry = store
        .follows
        .iter_mut()
        .find(|f| f.manga_id == manga_id)
        .ok_or_else(|| AppError::NotFound(manga_id.to_string()))?;
    entry.is_favorite = favorite;
    let updated = entry.clone();
    save(root, &store)?;
    Ok(updated)
}

pub fn mark_seen(root: &Path, manga_id: &str) -> AppResult<()> {
    let mut store = read(root)?;
    if let Some(entry) = store.follows.iter_mut().find(|f| f.manga_id == manga_id) {
        entry.has_update = false;
    }
    save(root, &store)
}

/// Sweeps every followed manga for a newer readable chapter than the one
/// last recorded, one request at a time with a small delay between each —
/// MangaDex's public rate limit is 5 requests/second per IP, and this is
/// meant to run occasionally (Manga tab opening, a manual refresh), not on
/// a tight timer, so being polite here costs nothing in practice. Returns
/// the full, updated follow list.
pub async fn check_updates(root: &Path) -> AppResult<Vec<MangaFollow>> {
    let mut store = read(root)?;
    for i in 0..store.follows.len() {
        if i > 0 {
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        let manga_id = store.follows[i].manga_id.clone();
        let Ok(Some((latest_id, latest_label))) =
            manga_source::latest_chapter_marker(&manga_id, None).await
        else {
            continue;
        };
        let follow = &mut store.follows[i];
        let is_new = follow
            .last_known_chapter_id
            .as_deref()
            .is_some_and(|known| known != latest_id);
        if is_new {
            follow.has_update = true;
        }
        follow.last_known_chapter_id = Some(latest_id);
        follow.last_known_chapter_label = Some(latest_label);
    }
    save(root, &store)?;
    Ok(store.follows)
}

// ---- reading progress + history ----

pub fn list_progress(root: &Path) -> AppResult<Vec<ReadingProgress>> {
    Ok(read(root)?.progress)
}

pub fn get_progress(root: &Path, manga_id: &str) -> AppResult<Option<ReadingProgress>> {
    Ok(read(root)?
        .progress
        .into_iter()
        .find(|p| p.manga_id == manga_id))
}

#[allow(clippy::too_many_arguments)]
pub fn set_progress(
    root: &Path,
    manga_id: &str,
    manga_title: &str,
    cover_url: Option<String>,
    chapter_id: &str,
    chapter_label: &str,
    page: u32,
    page_count: u32,
) -> AppResult<ReadingProgress> {
    let mut store = read(root)?;
    let now = now_ms();
    let entry = ReadingProgress {
        manga_id: manga_id.to_string(),
        manga_title: manga_title.to_string(),
        cover_url: cover_url.clone(),
        chapter_id: chapter_id.to_string(),
        chapter_label: chapter_label.to_string(),
        page,
        page_count,
        updated_at: now,
    };
    store.progress.retain(|p| p.manga_id != manga_id);
    store.progress.insert(0, entry.clone());

    store.history.retain(|h| h.manga_id != manga_id);
    store.history.insert(
        0,
        HistoryEntry {
            manga_id: manga_id.to_string(),
            manga_title: manga_title.to_string(),
            cover_url,
            chapter_id: chapter_id.to_string(),
            chapter_label: chapter_label.to_string(),
            read_at: now,
        },
    );
    store.history.truncate(MAX_HISTORY);

    save(root, &store)?;
    Ok(entry)
}

pub fn list_history(root: &Path) -> AppResult<Vec<HistoryEntry>> {
    Ok(read(root)?.history)
}

pub fn clear_history(root: &Path) -> AppResult<()> {
    let mut store = read(root)?;
    store.history.clear();
    save(root, &store)
}

// ---- bookmarks ----

pub fn list_bookmarks(root: &Path, manga_id: Option<&str>) -> AppResult<Vec<MangaBookmarkEntry>> {
    let all = read(root)?.bookmarks;
    Ok(match manga_id {
        Some(id) => all.into_iter().filter(|b| b.manga_id == id).collect(),
        None => all,
    })
}

pub fn add_bookmark(
    root: &Path,
    manga_id: &str,
    manga_title: &str,
    chapter_id: &str,
    chapter_label: &str,
    page: u32,
) -> AppResult<MangaBookmarkEntry> {
    let mut store = read(root)?;
    let entry = MangaBookmarkEntry {
        id: Uuid::new_v4().to_string(),
        manga_id: manga_id.to_string(),
        manga_title: manga_title.to_string(),
        chapter_id: chapter_id.to_string(),
        chapter_label: chapter_label.to_string(),
        page,
        created_at: now_ms(),
    };
    store.bookmarks.insert(0, entry.clone());
    save(root, &store)?;
    Ok(entry)
}

pub fn remove_bookmark(root: &Path, id: &str) -> AppResult<()> {
    let mut store = read(root)?;
    store.bookmarks.retain(|b| b.id != id);
    save(root, &store)
}

// ---- offline downloads ----

pub fn list_downloads(root: &Path, manga_id: Option<&str>) -> AppResult<Vec<DownloadedChapter>> {
    let all = read(root)?.downloads;
    Ok(match manga_id {
        Some(id) => all.into_iter().filter(|d| d.manga_id == id).collect(),
        None => all,
    })
}

pub fn is_downloaded(root: &Path, chapter_id: &str) -> AppResult<bool> {
    Ok(read(root)?.downloads.iter().any(|d| d.chapter_id == chapter_id))
}

fn extension_from_url(url: &str) -> String {
    url.rsplit('/')
        .next()
        .and_then(|name| name.rsplit('.').next())
        .filter(|ext| ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or("jpg")
        .to_lowercase()
}

/// Downloads every page of a chapter into the vault's
/// `Library/OnlineManga/<manga>/<chapter>/` folder for offline reading,
/// and records it so the reader can find it without the network. Pages
/// are fetched one at a time — chapter lengths are small (dozens of
/// images, not hundreds), so simplicity here matters more than shaving a
/// few seconds off a download with parallel requests.
#[allow(clippy::too_many_arguments)]
pub async fn download_chapter(
    root: &Path,
    manga_id: &str,
    manga_title: &str,
    cover_url: Option<String>,
    chapter_id: &str,
    chapter_label: &str,
    language: &str,
) -> AppResult<DownloadedChapter> {
    if is_downloaded(root, chapter_id)? {
        return list_downloads(root, None)?
            .into_iter()
            .find(|d| d.chapter_id == chapter_id)
            .ok_or_else(|| AppError::Other("download vanished mid-request".to_string()));
    }

    let ChapterPages { image_urls, .. } = manga_source::chapter_pages(chapter_id).await?;
    if image_urls.is_empty() {
        return Err(AppError::Other("this chapter has no pages to download".to_string()));
    }

    let manga_slug = format!(
        "{} ({})",
        sanitize_name(manga_title),
        &manga_id[..manga_id.len().min(8)]
    );
    let chapter_slug = sanitize_name(chapter_label);
    let folder = downloads_root(root).join(&manga_slug).join(&chapter_slug);
    fs::create_dir_all(&folder)?;

    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .user_agent("Xuro/0.1.7")
        .build()
        .map_err(|error| AppError::Network(error.to_string()))?;

    let mut page_files = Vec::with_capacity(image_urls.len());
    for (index, url) in image_urls.iter().enumerate() {
        let bytes = http
            .get(url)
            .send()
            .await
            .map_err(|error| AppError::Network(format!("downloading page {index}: {error}")))?
            .bytes()
            .await
            .map_err(|error| AppError::Network(format!("reading page {index}: {error}")))?;
        let file_name = format!("{:03}.{}", index + 1, extension_from_url(url));
        fs::write(folder.join(&file_name), &bytes)?;
        page_files.push(file_name);
    }

    let folder_rel = crate::vault::rel_of(root, &folder)?;
    let entry = DownloadedChapter {
        manga_id: manga_id.to_string(),
        manga_title: manga_title.to_string(),
        cover_url,
        chapter_id: chapter_id.to_string(),
        chapter_label: chapter_label.to_string(),
        language: language.to_string(),
        folder_rel,
        page_files,
        downloaded_at: now_ms(),
    };

    let mut store = read(root)?;
    store.downloads.retain(|d| d.chapter_id != chapter_id);
    store.downloads.insert(0, entry.clone());
    save(root, &store)?;
    Ok(entry)
}

pub fn remove_download(root: &Path, chapter_id: &str) -> AppResult<()> {
    let mut store = read(root)?;
    if let Some(entry) = store.downloads.iter().find(|d| d.chapter_id == chapter_id) {
        if let Ok(path) = crate::vault::resolve_rel(root, &entry.folder_rel) {
            let _ = fs::remove_dir_all(path);
        }
    }
    store.downloads.retain(|d| d.chapter_id != chapter_id);
    save(root, &store)
}

/// Base64 bytes of one downloaded page, for the offline reader — same
/// "read raw bytes over the command channel" pattern `library.rs` uses
/// for uploaded PDFs, for the same reason (no asset-scope/CSP changes).
pub fn read_downloaded_page(root: &Path, chapter_id: &str, page_index: usize) -> AppResult<String> {
    let store = read(root)?;
    let entry = store
        .downloads
        .iter()
        .find(|d| d.chapter_id == chapter_id)
        .ok_or_else(|| AppError::NotFound(chapter_id.to_string()))?;
    let file_name = entry
        .page_files
        .get(page_index)
        .ok_or_else(|| AppError::InvalidInput("page index out of range".to_string()))?;
    let path = crate::vault::resolve_rel(root, &entry.folder_rel)?.join(file_name);
    Ok(STANDARD.encode(fs::read(path)?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::ensure_layout;
    use tempfile::tempdir;

    #[test]
    fn set_progress_upserts_and_records_history() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        set_progress(dir.path(), "m1", "Test Manga", None, "c1", "Ch. 1", 3, 20).unwrap();
        let updated = set_progress(dir.path(), "m1", "Test Manga", None, "c2", "Ch. 2", 1, 18)
            .unwrap();
        assert_eq!(updated.chapter_id, "c2");
        assert_eq!(list_progress(dir.path()).unwrap().len(), 1);
        let history = list_history(dir.path()).unwrap();
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].chapter_id, "c2");
    }

    #[test]
    fn favorite_requires_an_existing_follow() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        assert!(set_favorite(dir.path(), "missing", true).is_err());
    }

    #[test]
    fn bookmarks_roundtrip() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let bookmark = add_bookmark(dir.path(), "m1", "Test Manga", "c1", "Ch. 1", 5).unwrap();
        assert_eq!(list_bookmarks(dir.path(), Some("m1")).unwrap().len(), 1);
        remove_bookmark(dir.path(), &bookmark.id).unwrap();
        assert!(list_bookmarks(dir.path(), Some("m1")).unwrap().is_empty());
    }

    #[test]
    fn mark_seen_clears_has_update_only_for_that_manga() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let mut store = Store::default();
        store.follows.push(MangaFollow {
            manga_id: "m1".to_string(),
            title: "A".to_string(),
            cover_url: None,
            followed_at: 0,
            is_favorite: false,
            last_known_chapter_id: None,
            last_known_chapter_label: None,
            has_update: true,
        });
        store.follows.push(MangaFollow {
            manga_id: "m2".to_string(),
            title: "B".to_string(),
            cover_url: None,
            followed_at: 0,
            is_favorite: false,
            last_known_chapter_id: None,
            last_known_chapter_label: None,
            has_update: true,
        });
        save(dir.path(), &store).unwrap();

        mark_seen(dir.path(), "m1").unwrap();
        let follows = list_follows(dir.path()).unwrap();
        assert!(!follows.iter().find(|f| f.manga_id == "m1").unwrap().has_update);
        assert!(follows.iter().find(|f| f.manga_id == "m2").unwrap().has_update);
    }

    #[test]
    fn extension_from_url_falls_back_to_jpg() {
        assert_eq!(extension_from_url("https://x.test/data/hash/12.png"), "png");
        assert_eq!(extension_from_url("https://x.test/data/hash/no-extension"), "jpg");
    }
}
