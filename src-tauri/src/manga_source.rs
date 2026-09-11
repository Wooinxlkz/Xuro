//! Thin client for MangaDex's free, keyless public API — the actual
//! catalog behind Online Manga (`manga_online.rs`, which owns follows,
//! reading progress, history, bookmarks, and offline downloads; this file
//! only ever talks to the network and shapes the response).
//!
//! Content safety: every list/search request restricts `contentRating[]`
//! to `safe` and `suggestive` — `erotica` and `pornographic` are never
//! requested, not just filtered client-side. As defense in depth (same
//! pattern `library.rs` uses for book/manga search), results are also
//! dropped locally if they carry an explicit-content tag, in case a
//! result's rating is ever wrong upstream.
//!
//! MangaDex asks that integrations credit the source and the scanlation
//! groups that translate each chapter — the frontend reader surfaces the
//! scanlation group name on every chapter for that reason.

use std::collections::HashMap;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

const API_BASE: &str = "https://api.mangadex.org";
const UPLOADS_BASE: &str = "https://uploads.mangadex.org";
const SAFE_CONTENT_RATINGS: [&str; 2] = ["safe", "suggestive"];
const BLOCKED_TAGS: &[&str] = &["hentai", "ecchi", "erotica"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MangaLanguage {
    English,
    Spanish,
    Arabic,
    Japanese,
}

impl MangaLanguage {
    /// MangaDex language codes this maps to — Spanish covers both the
    /// European and Latin-American scanlation tags, since readers looking
    /// for "Spanish" almost always mean either.
    fn codes(self) -> &'static [&'static str] {
        match self {
            MangaLanguage::English => &["en"],
            MangaLanguage::Spanish => &["es", "es-la"],
            MangaLanguage::Arabic => &["ar"],
            MangaLanguage::Japanese => &["ja"],
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            MangaLanguage::English => "English",
            MangaLanguage::Spanish => "Spanish",
            MangaLanguage::Arabic => "Arabic",
            MangaLanguage::Japanese => "Japanese",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MangaSort {
    Latest,
    Popular,
    Newest,
    TitleAsc,
    Rating,
}

impl MangaSort {
    fn order_param(self) -> (&'static str, &'static str) {
        match self {
            MangaSort::Latest => ("order[latestUploadedChapter]", "desc"),
            MangaSort::Popular => ("order[followedCount]", "desc"),
            MangaSort::Newest => ("order[createdAt]", "desc"),
            MangaSort::TitleAsc => ("order[title]", "asc"),
            MangaSort::Rating => ("order[rating]", "desc"),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaBrowseParams {
    pub query: Option<String>,
    pub language: Option<MangaLanguage>,
    #[serde(default)]
    pub genre_ids: Vec<String>,
    pub status: Option<String>,
    pub sort: Option<MangaSort>,
    #[serde(default)]
    pub page: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaTag {
    pub id: String,
    pub name: String,
    pub group: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaSummary {
    pub id: String,
    pub title: String,
    pub cover_url: Option<String>,
    pub status: Option<String>,
    pub year: Option<i32>,
    pub content_rating: String,
    pub tags: Vec<String>,
    pub demographic: Option<String>,
    pub available_languages: Vec<String>,
    pub last_chapter: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaPage {
    pub items: Vec<MangaSummary>,
    pub total: i64,
    pub page: u32,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaDetails {
    #[serde(flatten)]
    pub summary: MangaSummary,
    pub description: Option<String>,
    pub authors: Vec<String>,
    pub alt_titles: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaChapter {
    pub id: String,
    pub chapter: Option<String>,
    pub title: Option<String>,
    pub translated_language: String,
    pub pages: i32,
    pub publish_at: Option<String>,
    pub scanlation_group: Option<String>,
    /// Chapters MangaDex hosts only as a link to an outside site have no
    /// readable page images through `/at-home` — the frontend shows these
    /// as "read on source" instead of opening the in-app reader.
    pub external: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterPages {
    pub chapter_id: String,
    pub image_urls: Vec<String>,
}

fn client() -> AppResult<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .user_agent("Xuro/0.1.4")
        .build()
        .map_err(|error| AppError::Network(error.to_string()))
}

/// GETs `path` on the MangaDex API with `query` (repeated keys allowed,
/// e.g. multiple `("contentRating[]", "safe")` pairs), retrying once on a
/// transient 5xx — mirrors `library.rs`'s `fetch_json_with_retry`, kept as
/// its own small copy here rather than a shared helper so this module has
/// no dependency on `library.rs` at all.
async fn get_json<T: for<'de> Deserialize<'de>>(
    path: &str,
    query: &[(String, String)],
) -> AppResult<T> {
    let http = client()?;
    let url = format!("{API_BASE}{path}");

    let mut last_error = None;
    for attempt in 0..2 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(700)).await;
        }
        match http.get(&url).query(query).send().await {
            Ok(response) => {
                let status = response.status();
                if status.is_success() {
                    return response
                        .json::<T>()
                        .await
                        .map_err(|error| AppError::Other(format!("invalid MangaDex response: {error}")));
                }
                if status.is_server_error() || status.as_u16() == 429 {
                    last_error = Some(AppError::Network(format!("MangaDex returned {status}")));
                    continue;
                }
                return Err(AppError::Network(format!("MangaDex returned {status}")));
            }
            Err(error) => last_error = Some(AppError::Network(format!("MangaDex: {error}"))),
        }
    }
    Err(last_error.unwrap_or_else(|| AppError::Network("MangaDex request failed".to_string())))
}

fn content_rating_pairs() -> Vec<(String, String)> {
    SAFE_CONTENT_RATINGS
        .iter()
        .map(|rating| ("contentRating[]".to_string(), rating.to_string()))
        .collect()
}

fn is_blocked_tag(name: &str) -> bool {
    let lower = name.to_lowercase();
    BLOCKED_TAGS.iter().any(|blocked| lower.contains(blocked))
}

fn pick_text(map: &Option<HashMap<String, String>>, preferred: &[&str]) -> Option<String> {
    let map = map.as_ref()?;
    for lang in preferred {
        if let Some(value) = map.get(*lang) {
            if !value.trim().is_empty() {
                return Some(value.clone());
            }
        }
    }
    map.values().find(|v| !v.trim().is_empty()).cloned()
}

const TITLE_PREFERENCE: &[&str] = &["en", "ja-ro", "ja", "x-user_readable"];

// ---- raw MangaDex JSON shapes ----

#[derive(Debug, Deserialize)]
struct RawCollection<T> {
    data: Vec<T>,
    #[serde(default)]
    total: i64,
}

#[derive(Debug, Deserialize)]
struct RawEntity<T> {
    data: T,
}

#[derive(Debug, Deserialize)]
struct RawManga {
    id: String,
    attributes: RawMangaAttributes,
    #[serde(default)]
    relationships: Vec<RawRelationship>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawMangaAttributes {
    title: Option<HashMap<String, String>>,
    #[serde(default)]
    alt_titles: Vec<HashMap<String, String>>,
    description: Option<HashMap<String, String>>,
    status: Option<String>,
    year: Option<i32>,
    #[serde(default = "default_rating")]
    content_rating: String,
    #[serde(default)]
    tags: Vec<RawTag>,
    publication_demographic: Option<String>,
    #[serde(default)]
    available_translated_languages: Vec<Option<String>>,
    last_chapter: Option<String>,
}

fn default_rating() -> String {
    "safe".to_string()
}

#[derive(Debug, Deserialize)]
struct RawTag {
    id: String,
    attributes: RawTagAttributes,
}

#[derive(Debug, Deserialize)]
struct RawTagAttributes {
    name: Option<HashMap<String, String>>,
    group: String,
}

#[derive(Debug, Deserialize)]
struct RawRelationship {
    #[serde(rename = "type")]
    kind: String,
    attributes: Option<RawRelationshipAttributes>,
}

#[derive(Debug, Deserialize, Default)]
struct RawRelationshipAttributes {
    #[serde(rename = "fileName")]
    file_name: Option<String>,
    name: Option<String>,
}

impl RawManga {
    fn cover_file_name(&self) -> Option<String> {
        self.relationships
            .iter()
            .find(|r| r.kind == "cover_art")
            .and_then(|r| r.attributes.as_ref())
            .and_then(|a| a.file_name.clone())
    }

    fn people(&self, kind: &str) -> Vec<String> {
        self.relationships
            .iter()
            .filter(|r| r.kind == kind)
            .filter_map(|r| r.attributes.as_ref())
            .filter_map(|a| a.name.clone())
            .collect()
    }

    fn has_blocked_tag(&self) -> bool {
        self.attributes.tags.iter().any(|tag| {
            pick_text(&tag.attributes.name, TITLE_PREFERENCE)
                .is_some_and(|name| is_blocked_tag(&name))
        })
    }

    fn tag_names(&self) -> Vec<String> {
        self.attributes
            .tags
            .iter()
            .filter_map(|tag| pick_text(&tag.attributes.name, TITLE_PREFERENCE))
            .collect()
    }

    fn to_summary(&self) -> MangaSummary {
        let cover_url = self
            .cover_file_name()
            .map(|file| format!("{UPLOADS_BASE}/covers/{}/{file}.512.jpg", self.id));
        MangaSummary {
            id: self.id.clone(),
            title: pick_text(&self.attributes.title, TITLE_PREFERENCE)
                .unwrap_or_else(|| "Untitled".to_string()),
            cover_url,
            status: self.attributes.status.clone(),
            year: self.attributes.year,
            content_rating: self.attributes.content_rating.clone(),
            tags: self.tag_names(),
            demographic: self.attributes.publication_demographic.clone(),
            available_languages: self
                .attributes
                .available_translated_languages
                .iter()
                .filter_map(|l| l.clone())
                .collect(),
            last_chapter: self.attributes.last_chapter.clone(),
        }
    }

    fn to_details(&self) -> MangaDetails {
        MangaDetails {
            summary: self.to_summary(),
            description: pick_text(&self.attributes.description, TITLE_PREFERENCE),
            authors: {
                let mut people = self.people("author");
                people.extend(self.people("artist"));
                people.sort();
                people.dedup();
                people
            },
            alt_titles: self
                .attributes
                .alt_titles
                .iter()
                .filter_map(|m| pick_text(&Some(m.clone()), TITLE_PREFERENCE))
                .collect(),
        }
    }
}

/// Browse or search the catalog. `params.query` empty/`None` means "browse
/// by sort" (latest updates, popular, newest) rather than a text search.
pub async fn browse(params: MangaBrowseParams) -> AppResult<MangaPage> {
    let limit: u32 = 24;
    let offset = params.page * limit;
    let mut query = content_rating_pairs();
    query.push(("limit".to_string(), limit.to_string()));
    query.push(("offset".to_string(), offset.to_string()));
    query.push(("includes[]".to_string(), "cover_art".to_string()));
    query.push(("includes[]".to_string(), "author".to_string()));
    query.push(("includes[]".to_string(), "artist".to_string()));

    if let Some(q) = params.query.as_ref().map(|q| q.trim()).filter(|q| !q.is_empty()) {
        query.push(("title".to_string(), q.to_string()));
    }
    if let Some(language) = params.language {
        for code in language.codes() {
            query.push(("availableTranslatedLanguage[]".to_string(), code.to_string()));
        }
    }
    for genre in &params.genre_ids {
        query.push(("includedTags[]".to_string(), genre.clone()));
    }
    if let Some(status) = params.status.as_ref().filter(|s| !s.is_empty()) {
        query.push(("status[]".to_string(), status.clone()));
    }
    let sort = params.sort.unwrap_or(MangaSort::Latest);
    let (order_key, order_value) = sort.order_param();
    query.push((order_key.to_string(), order_value.to_string()));

    let parsed: RawCollection<RawManga> = get_json("/manga", &query).await?;
    let items: Vec<MangaSummary> = parsed
        .data
        .iter()
        .filter(|manga| !manga.has_blocked_tag())
        .map(RawManga::to_summary)
        .collect();

    let has_more = (offset as i64) + (items.len() as i64) < parsed.total;

    Ok(MangaPage {
        has_more,
        items,
        total: parsed.total,
        page: params.page,
    })
}

pub async fn details(manga_id: &str) -> AppResult<MangaDetails> {
    let query = [
        ("includes[]".to_string(), "cover_art".to_string()),
        ("includes[]".to_string(), "author".to_string()),
        ("includes[]".to_string(), "artist".to_string()),
    ];
    let parsed: RawEntity<RawManga> =
        get_json(&format!("/manga/{manga_id}"), &query).await?;
    Ok(parsed.data.to_details())
}

#[derive(Debug, Deserialize)]
struct RawChapter {
    id: String,
    attributes: RawChapterAttributes,
    #[serde(default)]
    relationships: Vec<RawRelationship>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawChapterAttributes {
    chapter: Option<String>,
    title: Option<String>,
    translated_language: String,
    #[serde(default)]
    pages: i32,
    publish_at: Option<String>,
    external_url: Option<String>,
}

/// Chapters for a manga, newest-first, optionally restricted to one of the
/// four supported languages. MangaDex paginates at 100 per page; `page` is
/// the same style of 0-based page index `browse` uses.
pub async fn chapters(
    manga_id: &str,
    language: Option<MangaLanguage>,
    page: u32,
) -> AppResult<Vec<MangaChapter>> {
    let limit: u32 = 100;
    let mut query = vec![
        ("limit".to_string(), limit.to_string()),
        ("offset".to_string(), (page * limit).to_string()),
        ("order[chapter]".to_string(), "desc".to_string()),
        ("includes[]".to_string(), "scanlation_group".to_string()),
        ("contentRating[]".to_string(), "safe".to_string()),
        ("contentRating[]".to_string(), "suggestive".to_string()),
    ];
    if let Some(language) = language {
        for code in language.codes() {
            query.push(("translatedLanguage[]".to_string(), code.to_string()));
        }
    }
    let parsed: RawCollection<RawChapter> =
        get_json(&format!("/manga/{manga_id}/feed"), &query).await?;

    Ok(parsed
        .data
        .into_iter()
        .map(|chapter| {
            let group = chapter
                .relationships
                .iter()
                .find(|r| r.kind == "scanlation_group")
                .and_then(|r| r.attributes.as_ref())
                .and_then(|a| a.name.clone());
            MangaChapter {
                id: chapter.id,
                chapter: chapter.attributes.chapter,
                title: chapter.attributes.title,
                translated_language: chapter.attributes.translated_language,
                pages: chapter.attributes.pages,
                publish_at: chapter.attributes.publish_at,
                scanlation_group: group,
                external: chapter.attributes.external_url.is_some(),
            }
        })
        .collect())
}

/// The most recent readable chapter's id + human label for a manga, used
/// to detect new releases for followed manga without needing an account —
/// `None` if the manga simply has nothing readable yet.
pub async fn latest_chapter_marker(
    manga_id: &str,
    language: Option<MangaLanguage>,
) -> AppResult<Option<(String, String)>> {
    let list = chapters(manga_id, language, 0).await?;
    let latest = list.into_iter().find(|c| !c.external);
    Ok(latest.map(|c| (c.id.clone(), chapter_label(&c))))
}

pub fn chapter_label(chapter: &MangaChapter) -> String {
    match (&chapter.chapter, &chapter.title) {
        (Some(number), Some(title)) if !title.trim().is_empty() => {
            format!("Ch. {number} — {title}")
        }
        (Some(number), _) => format!("Ch. {number}"),
        (None, Some(title)) if !title.trim().is_empty() => title.clone(),
        _ => "Oneshot".to_string(),
    }
}

#[derive(Debug, Deserialize)]
struct AtHomeResponse {
    #[serde(rename = "baseUrl")]
    base_url: String,
    chapter: AtHomeChapter,
}

#[derive(Debug, Deserialize)]
struct AtHomeChapter {
    hash: String,
    data: Vec<String>,
}

/// Full-resolution page image URLs for a chapter, via MangaDex's
/// `/at-home/server` endpoint (a short-lived, per-request base URL — never
/// cached across sessions, only used immediately to read or download).
pub async fn chapter_pages(chapter_id: &str) -> AppResult<ChapterPages> {
    let parsed: AtHomeResponse =
        get_json(&format!("/at-home/server/{chapter_id}"), &[]).await?;
    let image_urls = parsed
        .chapter
        .data
        .iter()
        .map(|file| format!("{}/data/{}/{file}", parsed.base_url, parsed.chapter.hash))
        .collect();
    Ok(ChapterPages {
        chapter_id: chapter_id.to_string(),
        image_urls,
    })
}

#[derive(Debug, Deserialize)]
struct RawTagsCollection {
    data: Vec<RawTagEntry>,
}

#[derive(Debug, Deserialize)]
struct RawTagEntry {
    id: String,
    attributes: RawTagAttributes,
}

/// The full genre/theme tag list MangaDex uses for `includedTags[]` — a
/// fixed, slow-changing vocabulary, so the frontend fetches it once per
/// session rather than per keystroke.
pub async fn genres() -> AppResult<Vec<MangaTag>> {
    let parsed: RawTagsCollection = get_json("/manga/tag", &[]).await?;
    Ok(parsed
        .data
        .into_iter()
        .filter(|tag| matches!(tag.attributes.group.as_str(), "genre" | "theme"))
        .filter_map(|tag| {
            let name = pick_text(&tag.attributes.name, TITLE_PREFERENCE)?;
            if is_blocked_tag(&name) {
                return None;
            }
            Some(MangaTag {
                id: tag.id,
                name,
                group: tag.attributes.group,
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_blocked_tag_matches_case_insensitively() {
        assert!(is_blocked_tag("Hentai"));
        assert!(is_blocked_tag("ECCHI"));
        assert!(!is_blocked_tag("Action"));
    }

    #[test]
    fn pick_text_prefers_english_then_falls_back() {
        let mut map = HashMap::new();
        map.insert("ja".to_string(), "こんにちは".to_string());
        assert_eq!(pick_text(&Some(map.clone()), TITLE_PREFERENCE), Some("こんにちは".to_string()));
        map.insert("en".to_string(), "Hello".to_string());
        assert_eq!(pick_text(&Some(map), TITLE_PREFERENCE), Some("Hello".to_string()));
    }

    #[test]
    fn chapter_label_prefers_number_and_title() {
        let chapter = MangaChapter {
            id: "1".to_string(),
            chapter: Some("12".to_string()),
            title: Some("A New Start".to_string()),
            translated_language: "en".to_string(),
            pages: 20,
            publish_at: None,
            scanlation_group: None,
            external: false,
        };
        assert_eq!(chapter_label(&chapter), "Ch. 12 — A New Start");
    }

    #[test]
    fn chapter_label_falls_back_to_oneshot() {
        let chapter = MangaChapter {
            id: "1".to_string(),
            chapter: None,
            title: None,
            translated_language: "en".to_string(),
            pages: 20,
            publish_at: None,
            scanlation_group: None,
            external: false,
        };
        assert_eq!(chapter_label(&chapter), "Oneshot");
    }

    #[test]
    fn language_codes_cover_spanish_variants() {
        assert_eq!(MangaLanguage::Spanish.codes(), &["es", "es-la"]);
    }
}
