//! A small personal library: books and manga you're tracking or reading,
//! shown in the frontend as a switchable list/grid/bento view.
//!
//! An item gets into the library one of two ways:
//! - **Searched and added** (`search_books`/`search_manga` then `add_from_search`)
//!   — metadata only (title, author, a cover image URL), fetched from a
//!   free, keyless public API: Open Library for books, Jikan (the
//!   unofficial MyAnimeList API) for manga. Nothing is uploaded anywhere;
//!   these calls just read from an already-public catalog.
//! - **Uploaded** (`upload`) — the user's own file (PDF today; other
//!   formats are accepted and saved, but only PDFs render in-app — see
//!   the frontend's reader). The file is copied into a `Library/` folder
//!   inside the vault itself, the same pattern `canvas.rs` uses for
//!   `Canvases/` — so it's a real part of the vault, backed up and synced
//!   with everything else, not a separate app-data location.
//!
//! Content safety: manga search asks Jikan for SFW-only results (`sfw=true`)
//! and, as defense in depth, also drops anything tagged Hentai/Ecchi or
//! rated for explicit content even if that flag ever misses something.
//! Book search drops a small denylist of explicit-content subject tags.
//! This is a best-effort filter against a third-party catalog Xuro doesn't
//! control, not a guarantee — flagged here rather than implied otherwise.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::cloud::client;
use crate::error::{AppError, AppResult};
use crate::util::{now_ms, sanitize_name};
use crate::vault::{notes_root, rel_of, DATA_DIR};

pub const LIBRARY_FOLDER: &str = "Library";

/// Genre/tag names that mean "not safe for the library view" — checked
/// case-insensitively against whatever a source API returns, regardless
/// of whether that API's own SFW flag already should have excluded them.
const BLOCKED_MANGA_TAGS: &[&str] = &["hentai", "ecchi", "erotica"];
const BLOCKED_BOOK_SUBJECTS: &[&str] = &["erotica", "erotic fiction", "pornography"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LibraryKind {
    Book,
    Manga,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub kind: LibraryKind,
    /// A remote cover image URL (for searched/added items) — never
    /// downloaded or cached locally, just linked.
    pub cover_url: Option<String>,
    /// Set only for uploaded files: the rel path of the file inside the
    /// vault, e.g. "Library/Some Book.pdf".
    pub file_rel: Option<String>,
    pub added_at: i64,
    /// Last-read page for an uploaded PDF, if the reader has recorded one.
    #[serde(default)]
    pub last_page: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySearchResult {
    /// Opaque id from the source catalog — re-supplied to `add_from_search`.
    pub external_id: String,
    pub title: String,
    pub author: Option<String>,
    pub kind: LibraryKind,
    pub cover_url: Option<String>,
    pub year: Option<i32>,
}

fn store_path(root: &Path) -> PathBuf {
    root.join(DATA_DIR).join("library.json")
}

fn library_folder(root: &Path) -> PathBuf {
    notes_root(root).join(LIBRARY_FOLDER)
}

fn read(root: &Path) -> AppResult<Vec<LibraryItem>> {
    let path = store_path(root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?).unwrap_or_default())
}

fn save(root: &Path, items: &[LibraryItem]) -> AppResult<()> {
    fs::write(store_path(root), serde_json::to_string_pretty(items)?)?;
    Ok(())
}

pub fn list(root: &Path) -> AppResult<Vec<LibraryItem>> {
    read(root)
}

pub fn remove(root: &Path, id: &str) -> AppResult<()> {
    let mut items = read(root)?;
    let Some(index) = items.iter().position(|item| item.id == id) else {
        return Err(AppError::NotFound(id.to_string()));
    };
    let removed = items.remove(index);
    if let Some(file_rel) = &removed.file_rel {
        // Best-effort: the metadata entry is gone either way, but try to
        // clean up the file it pointed at too rather than leaving an
        // orphan in Library/.
        if let Ok(path) = crate::vault::resolve_rel(root, file_rel) {
            let _ = fs::remove_file(path);
        }
    }
    save(root, &items)
}

pub fn set_last_page(root: &Path, id: &str, page: u32) -> AppResult<LibraryItem> {
    let mut items = read(root)?;
    let item = items
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    item.last_page = Some(page);
    let updated = item.clone();
    save(root, &items)?;
    Ok(updated)
}

pub fn add_from_search(root: &Path, result: LibrarySearchResult) -> AppResult<LibraryItem> {
    let item = LibraryItem {
        id: Uuid::new_v4().to_string(),
        title: result.title,
        author: result.author,
        kind: result.kind,
        cover_url: result.cover_url,
        file_rel: None,
        added_at: now_ms(),
        last_page: None,
    };
    let mut items = read(root)?;
    items.insert(0, item.clone());
    save(root, &items)?;
    Ok(item)
}

/// Copies a file the user picked (via the OS file dialog — the frontend
/// resolves that to a real path before calling this) into `Library/`
/// inside the vault, and records it as a new item. `source_path` must
/// already exist; nothing about it needs to be a PDF specifically —
/// anything is accepted and saved, only the in-app reader is currently
/// PDF-only (other formats can still be opened externally).
pub fn upload(
    root: &Path,
    source_path: &str,
    title: &str,
    author: Option<String>,
    kind: LibraryKind,
) -> AppResult<LibraryItem> {
    let source = Path::new(source_path);
    if !source.is_file() {
        return Err(AppError::NotFound(source_path.to_string()));
    }
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("title is empty".to_string()));
    }
    let extension = source
        .extension()
        .map(|e| e.to_string_lossy().to_string())
        .unwrap_or_default();

    let folder = library_folder(root);
    fs::create_dir_all(&folder)?;
    let dest = available_path(&folder, &sanitize_name(title), &extension);
    fs::copy(source, &dest)?;
    let file_rel = rel_of(root, &dest)?;

    let item = LibraryItem {
        id: Uuid::new_v4().to_string(),
        title: title.to_string(),
        author,
        kind,
        cover_url: None,
        file_rel: Some(file_rel),
        added_at: now_ms(),
        last_page: None,
    };
    let mut items = read(root)?;
    items.insert(0, item.clone());
    save(root, &items)?;
    Ok(item)
}

/// `Some Title.pdf`, `Some Title 2.pdf`, ... — same de-duplication idea
/// `notes.rs::available_path` uses for new notes, kept local to this
/// module since the extension handling differs slightly (never `.md`).
fn available_path(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let suffix = if extension.is_empty() {
        String::new()
    } else {
        format!(".{extension}")
    };
    let candidate = dir.join(format!("{stem}{suffix}"));
    if !candidate.exists() {
        return candidate;
    }
    let mut n = 2;
    loop {
        let candidate = dir.join(format!("{stem} {n}{suffix}"));
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

// ---- search: Open Library (books) ----

#[derive(Debug, Deserialize)]
struct OpenLibraryResponse {
    docs: Vec<OpenLibraryDoc>,
}

#[derive(Debug, Deserialize)]
struct OpenLibraryDoc {
    key: String,
    title: String,
    #[serde(default)]
    author_name: Vec<String>,
    #[serde(default)]
    cover_i: Option<i64>,
    #[serde(default)]
    first_publish_year: Option<i32>,
    #[serde(default)]
    subject: Vec<String>,
}

pub async fn search_books(query: &str) -> AppResult<Vec<LibrarySearchResult>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let url = format!(
        "https://openlibrary.org/search.json?q={}&limit=24&fields=key,title,author_name,cover_i,first_publish_year,subject",
        urlencode(query)
    );
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::Network(error.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Open Library returned {}",
            response.status()
        )));
    }
    let parsed = response
        .json::<OpenLibraryResponse>()
        .await
        .map_err(|error| AppError::Other(format!("invalid Open Library response: {error}")))?;

    Ok(parsed
        .docs
        .into_iter()
        .filter(|doc| !has_blocked_tag(&doc.subject, BLOCKED_BOOK_SUBJECTS))
        .map(|doc| LibrarySearchResult {
            external_id: doc.key,
            title: doc.title,
            author: doc.author_name.first().cloned(),
            kind: LibraryKind::Book,
            cover_url: doc
                .cover_i
                .map(|id| format!("https://covers.openlibrary.org/b/id/{id}-M.jpg")),
            year: doc.first_publish_year,
        })
        .collect())
}

// ---- search: Jikan (manga) ----

#[derive(Debug, Deserialize)]
struct JikanResponse {
    data: Vec<JikanManga>,
}

#[derive(Debug, Deserialize)]
struct JikanManga {
    mal_id: i64,
    title: String,
    #[serde(default)]
    authors: Vec<JikanAuthor>,
    images: JikanImages,
    #[serde(default)]
    genres: Vec<JikanNamed>,
    #[serde(default)]
    explicit_genres: Vec<JikanNamed>,
    #[serde(default)]
    rating: Option<String>,
    #[serde(default)]
    published: Option<JikanPublished>,
}

#[derive(Debug, Deserialize)]
struct JikanPublished {
    prop: JikanPublishedProp,
}

#[derive(Debug, Deserialize)]
struct JikanPublishedProp {
    from: JikanDateParts,
}

#[derive(Debug, Deserialize)]
struct JikanDateParts {
    year: Option<i32>,
}

#[derive(Debug, Deserialize)]
struct JikanAuthor {
    name: String,
}

#[derive(Debug, Deserialize)]
struct JikanNamed {
    name: String,
}

#[derive(Debug, Deserialize)]
struct JikanImages {
    jpg: JikanImageUrls,
}

#[derive(Debug, Deserialize)]
struct JikanImageUrls {
    image_url: Option<String>,
    large_image_url: Option<String>,
}

pub async fn search_manga(query: &str) -> AppResult<Vec<LibrarySearchResult>> {
    let query = query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    // `sfw=true` is Jikan's own explicit-content filter; the extra local
    // check below is defense in depth in case a result ever slips through.
    let url = format!(
        "https://api.jikan.moe/v4/manga?q={}&sfw=true&limit=24",
        urlencode(query)
    );
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::Network(error.to_string()))?;
    if !response.status().is_success() {
        return Err(AppError::Network(format!(
            "Jikan returned {}",
            response.status()
        )));
    }
    let parsed = response
        .json::<JikanResponse>()
        .await
        .map_err(|error| AppError::Other(format!("invalid Jikan response: {error}")))?;

    Ok(parsed
        .data
        .into_iter()
        .filter(|manga| !manga.explicit_genres.iter().any(|g| is_blocked(&g.name)))
        .filter(|manga| !manga.genres.iter().any(|g| is_blocked(&g.name)))
        .filter(|manga| {
            !manga
                .rating
                .as_deref()
                .is_some_and(|rating| rating.to_lowercase().contains("hentai"))
        })
        .map(|manga| LibrarySearchResult {
            external_id: manga.mal_id.to_string(),
            title: manga.title,
            author: manga.authors.first().map(|a| a.name.clone()),
            kind: LibraryKind::Manga,
            cover_url: manga
                .images
                .jpg
                .large_image_url
                .or(manga.images.jpg.image_url),
            year: manga.published.and_then(|p| p.prop.from.year),
        })
        .collect())
}

fn is_blocked(tag: &str) -> bool {
    let lower = tag.to_lowercase();
    BLOCKED_MANGA_TAGS.iter().any(|blocked| lower.contains(blocked))
}

fn has_blocked_tag(tags: &[String], denylist: &[&str]) -> bool {
    tags.iter().any(|tag| {
        let lower = tag.to_lowercase();
        denylist.iter().any(|blocked| lower.contains(blocked))
    })
}

/// Minimal query-string escaping — good enough for search terms (letters,
/// numbers, spaces, ordinary punctuation), without pulling in a whole URL
/// crate for one call site.
fn urlencode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            b' ' => out.push('+'),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::ensure_layout;
    use tempfile::tempdir;

    #[test]
    fn add_from_search_then_list_roundtrips() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let result = LibrarySearchResult {
            external_id: "OL123W".to_string(),
            title: "Dune".to_string(),
            author: Some("Frank Herbert".to_string()),
            kind: LibraryKind::Book,
            cover_url: Some("https://covers.openlibrary.org/b/id/1-M.jpg".to_string()),
            year: Some(1965),
        };
        let item = add_from_search(dir.path(), result).unwrap();
        assert_eq!(item.title, "Dune");
        assert_eq!(list(dir.path()).unwrap().len(), 1);
    }

    #[test]
    fn upload_copies_the_file_into_the_vaults_library_folder() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let source_dir = tempdir().unwrap();
        let source = source_dir.path().join("scan.pdf");
        fs::write(&source, b"%PDF-1.4 fake pdf bytes").unwrap();

        let item = upload(
            dir.path(),
            source.to_str().unwrap(),
            "My Scanned Book",
            None,
            LibraryKind::Book,
        )
        .unwrap();

        let file_rel = item.file_rel.unwrap();
        assert_eq!(file_rel, "Library/My Scanned Book.pdf");
        assert!(notes_root(dir.path()).join(&file_rel).is_file());
    }

    #[test]
    fn upload_deduplicates_matching_titles() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let source_dir = tempdir().unwrap();
        let source = source_dir.path().join("a.pdf");
        fs::write(&source, b"one").unwrap();

        let first = upload(dir.path(), source.to_str().unwrap(), "Same Title", None, LibraryKind::Book)
            .unwrap();
        let second = upload(dir.path(), source.to_str().unwrap(), "Same Title", None, LibraryKind::Book)
            .unwrap();
        assert_eq!(first.file_rel.unwrap(), "Library/Same Title.pdf");
        assert_eq!(second.file_rel.unwrap(), "Library/Same Title 2.pdf");
    }

    #[test]
    fn removing_an_uploaded_item_deletes_its_file() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let source_dir = tempdir().unwrap();
        let source = source_dir.path().join("a.pdf");
        fs::write(&source, b"one").unwrap();
        let item = upload(dir.path(), source.to_str().unwrap(), "Gone Soon", None, LibraryKind::Book)
            .unwrap();
        let path = notes_root(dir.path()).join(item.file_rel.clone().unwrap());
        assert!(path.is_file());

        remove(dir.path(), &item.id).unwrap();
        assert!(!path.is_file());
        assert!(list(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn blocked_manga_tag_filter_matches_case_insensitively() {
        assert!(is_blocked("Hentai"));
        assert!(is_blocked("ECCHI"));
        assert!(!is_blocked("Action"));
        assert!(!is_blocked("Slice of Life"));
    }

    #[test]
    fn blocked_book_subject_filter_catches_denylisted_tags() {
        assert!(has_blocked_tag(
            &["Fiction".to_string(), "Erotica".to_string()],
            BLOCKED_BOOK_SUBJECTS
        ));
        assert!(!has_blocked_tag(
            &["Fantasy".to_string(), "Adventure".to_string()],
            BLOCKED_BOOK_SUBJECTS
        ));
    }

    #[test]
    fn urlencode_handles_spaces_and_punctuation() {
        assert_eq!(urlencode("one piece"), "one+piece");
        assert_eq!(urlencode("a&b"), "a%26b");
    }

    #[test]
    fn set_last_page_persists() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let result = LibrarySearchResult {
            external_id: "1".to_string(),
            title: "Reading Progress".to_string(),
            author: None,
            kind: LibraryKind::Manga,
            cover_url: None,
            year: None,
        };
        let item = add_from_search(dir.path(), result).unwrap();
        let updated = set_last_page(dir.path(), &item.id, 42).unwrap();
        assert_eq!(updated.last_page, Some(42));
        assert_eq!(list(dir.path()).unwrap()[0].last_page, Some(42));
    }
}
