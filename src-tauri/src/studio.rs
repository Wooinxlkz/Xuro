//! Inkwell: Xuro's writing studio. Every chapter/page has its own kind —
//! Prose (chaptered long-form writing — `content` is Markdown, same
//! content model the Notes editor already uses) or Panel (manga/manhwa
//! page layouts — `content` is a serialized Excalidraw scene instead) —
//! so one project can freely mix both: a novel with an illustrated title
//! page, a comic with a prose afterword, whatever. Both kinds share the
//! exact same `Chapter` struct and every CRUD function (add/delete/
//! reorder/rename); only `kind` and how the frontend interprets `content`
//! differ.
//!
//! (Earlier versions locked the *whole project* to one kind. `read()`
//! migrates those old saves: since chapters never had their own `kind`
//! field before, every chapter in an old project unconditionally inherits
//! that project's old kind.)
//!
//! Deliberately its own module and its own storage, entirely separate
//! from Notes and Library — a "project" here is never a note and never a
//! library item, even though all three ultimately live in the same vault.
//!
//! Storage mirrors `manga_online.rs`'s approach: one JSON store
//! (`.xuro/studio.json`) holding every project, rather than a file per
//! project.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::util::now_ms;
use crate::vault::DATA_DIR;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChapterKind {
    Prose,
    Panel,
}

impl Default for ChapterKind {
    fn default() -> Self {
        ChapterKind::Prose
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub kind: ChapterKind,
    /// Markdown for a Prose-kind chapter, a serialized Excalidraw scene
    /// (JSON string) for a Panel-kind page — the frontend is the only
    /// thing that ever interprets this; Rust just stores and returns it.
    pub content: String,
    pub word_count: u32,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
    /// Pre-0.1.9 saves had `kind` here, at the project level. Kept only to
    /// read old files during migration in `read()` — never written back
    /// out (see `skip_serializing`), so a resave drops it for good.
    #[serde(default, rename = "kind", skip_serializing)]
    legacy_kind: Option<ChapterKind>,
    pub created_at: i64,
    pub updated_at: i64,
    pub chapters: Vec<Chapter>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub title: String,
    pub updated_at: i64,
    pub chapter_count: usize,
    /// How many of `chapter_count` are Panel-kind — lets the frontend show
    /// "Prose" / "Panel" / "Mixed" without needing the full project.
    pub panel_count: usize,
    pub word_count: u32,
}

impl Project {
    fn summary(&self) -> ProjectSummary {
        let panel_count = self
            .chapters
            .iter()
            .filter(|c| c.kind == ChapterKind::Panel)
            .count();
        ProjectSummary {
            id: self.id.clone(),
            title: self.title.clone(),
            updated_at: self.updated_at,
            chapter_count: self.chapters.len(),
            panel_count,
            word_count: self.chapters.iter().map(|c| c.word_count).sum(),
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Store {
    #[serde(default)]
    projects: Vec<Project>,
}

fn store_path(root: &Path) -> PathBuf {
    root.join(DATA_DIR).join("studio.json")
}

fn read(root: &Path) -> AppResult<Store> {
    let path = store_path(root);
    if !path.exists() {
        return Ok(Store::default());
    }
    let mut store: Store = serde_json::from_str(&fs::read_to_string(path)?).unwrap_or_default();
    for project in &mut store.projects {
        if let Some(legacy) = project.legacy_kind.take() {
            for chapter in &mut project.chapters {
                chapter.kind = legacy;
            }
        }
    }
    Ok(store)
}

fn save(root: &Path, store: &Store) -> AppResult<()> {
    fs::write(store_path(root), serde_json::to_string_pretty(store)?)?;
    Ok(())
}

fn find_project<'a>(store: &'a mut Store, project_id: &str) -> AppResult<&'a mut Project> {
    store
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError::NotFound(project_id.to_string()))
}

fn default_title(kind: ChapterKind, index: usize) -> String {
    match kind {
        ChapterKind::Prose => format!("Chapter {index}"),
        ChapterKind::Panel => format!("Page {index}"),
    }
}

pub fn list(root: &Path) -> AppResult<Vec<ProjectSummary>> {
    let mut summaries: Vec<ProjectSummary> =
        read(root)?.projects.iter().map(Project::summary).collect();
    summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(summaries)
}

pub fn get(root: &Path, project_id: &str) -> AppResult<Project> {
    read(root)?
        .projects
        .into_iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError::NotFound(project_id.to_string()))
}

pub fn create(root: &Path, title: &str, first_chapter_kind: ChapterKind) -> AppResult<Project> {
    let mut store = read(root)?;
    let now = now_ms();
    let project = Project {
        id: Uuid::new_v4().to_string(),
        title: if title.trim().is_empty() {
            "Untitled project".to_string()
        } else {
            title.trim().to_string()
        },
        legacy_kind: None,
        created_at: now,
        updated_at: now,
        chapters: vec![Chapter {
            id: Uuid::new_v4().to_string(),
            title: default_title(first_chapter_kind, 1),
            kind: first_chapter_kind,
            content: String::new(),
            word_count: 0,
            updated_at: now,
        }],
    };
    store.projects.insert(0, project.clone());
    save(root, &store)?;
    Ok(project)
}

pub fn rename(root: &Path, project_id: &str, title: &str) -> AppResult<ProjectSummary> {
    let mut store = read(root)?;
    let now = now_ms();
    let project = find_project(&mut store, project_id)?;
    project.title = if title.trim().is_empty() {
        project.title.clone()
    } else {
        title.trim().to_string()
    };
    project.updated_at = now;
    let summary = project.summary();
    save(root, &store)?;
    Ok(summary)
}

pub fn delete(root: &Path, project_id: &str) -> AppResult<()> {
    let mut store = read(root)?;
    store.projects.retain(|p| p.id != project_id);
    save(root, &store)
}

pub fn add_chapter(root: &Path, project_id: &str, title: &str, kind: ChapterKind) -> AppResult<Chapter> {
    let mut store = read(root)?;
    let now = now_ms();
    let project = find_project(&mut store, project_id)?;
    let same_kind_count = project.chapters.iter().filter(|c| c.kind == kind).count();
    let chapter = Chapter {
        id: Uuid::new_v4().to_string(),
        title: if title.trim().is_empty() {
            default_title(kind, same_kind_count + 1)
        } else {
            title.trim().to_string()
        },
        kind,
        content: String::new(),
        word_count: 0,
        updated_at: now,
    };
    project.chapters.push(chapter.clone());
    project.updated_at = now;
    save(root, &store)?;
    Ok(chapter)
}

/// `word_count` is computed by the frontend (Tiptap already has the plain
/// text via `editor.getText()`) rather than re-derived here from Markdown
/// source — counting words from formatting syntax in Rust would double-count
/// things like `**bold**` or `# heading` markers as part of a word.
pub fn update_chapter(
    root: &Path,
    project_id: &str,
    chapter_id: &str,
    title: &str,
    content: &str,
    word_count: u32,
) -> AppResult<Chapter> {
    let mut store = read(root)?;
    let now = now_ms();
    let project = find_project(&mut store, project_id)?;
    let chapter = project
        .chapters
        .iter_mut()
        .find(|c| c.id == chapter_id)
        .ok_or_else(|| AppError::NotFound(chapter_id.to_string()))?;
    if !title.trim().is_empty() {
        chapter.title = title.trim().to_string();
    }
    chapter.content = content.to_string();
    chapter.word_count = word_count;
    chapter.updated_at = now;
    let updated = chapter.clone();
    project.updated_at = now;
    save(root, &store)?;
    Ok(updated)
}

pub fn delete_chapter(root: &Path, project_id: &str, chapter_id: &str) -> AppResult<()> {
    let mut store = read(root)?;
    let project = find_project(&mut store, project_id)?;
    project.chapters.retain(|c| c.id != chapter_id);
    project.updated_at = now_ms();
    save(root, &store)
}

/// Reorders chapters to match `ordered_ids` exactly — any chapter id not
/// present in the list is dropped from the reorder (left in its relative
/// position at the end) rather than silently deleted, so a stale/partial
/// list from the frontend can't destroy chapters.
pub fn reorder_chapters(root: &Path, project_id: &str, ordered_ids: &[String]) -> AppResult<Project> {
    let mut store = read(root)?;
    let project = find_project(&mut store, project_id)?;
    let mut reordered = Vec::with_capacity(project.chapters.len());
    for id in ordered_ids {
        if let Some(pos) = project.chapters.iter().position(|c| &c.id == id) {
            reordered.push(project.chapters.remove(pos));
        }
    }
    reordered.append(&mut project.chapters);
    project.chapters = reordered;
    project.updated_at = now_ms();
    let updated = project.clone();
    save(root, &store)?;
    Ok(updated)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::ensure_layout;
    use tempfile::tempdir;

    #[test]
    fn create_starts_with_one_chapter() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let project = create(dir.path(), "My Novel", ChapterKind::Prose).unwrap();
        assert_eq!(project.title, "My Novel");
        assert_eq!(project.chapters.len(), 1);
        assert_eq!(project.chapters[0].title, "Chapter 1");
        assert_eq!(project.chapters[0].kind, ChapterKind::Prose);
    }

    #[test]
    fn update_chapter_stores_content_and_word_count() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let project = create(dir.path(), "My Novel", ChapterKind::Prose).unwrap();
        let chapter_id = project.chapters[0].id.clone();
        let updated = update_chapter(
            dir.path(),
            &project.id,
            &chapter_id,
            "",
            "The quick brown fox jumps.",
            5,
        )
        .unwrap();
        assert_eq!(updated.content, "The quick brown fox jumps.");
        assert_eq!(updated.word_count, 5);
    }

    #[test]
    fn reorder_chapters_matches_requested_order() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let project = create(dir.path(), "My Novel", ChapterKind::Prose).unwrap();
        let c2 = add_chapter(dir.path(), &project.id, "Chapter 2", ChapterKind::Prose).unwrap();
        let c3 = add_chapter(dir.path(), &project.id, "Chapter 3", ChapterKind::Prose).unwrap();
        let c1_id = project.chapters[0].id.clone();

        let reordered = reorder_chapters(dir.path(), &project.id, &[c3.id.clone(), c1_id.clone()])
            .unwrap();
        let ids: Vec<&str> = reordered.chapters.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec![c3.id.as_str(), c1_id.as_str(), c2.id.as_str()]);
    }

    #[test]
    fn delete_removes_project() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let project = create(dir.path(), "Temp", ChapterKind::Prose).unwrap();
        delete(dir.path(), &project.id).unwrap();
        assert!(get(dir.path(), &project.id).is_err());
    }

    #[test]
    fn a_project_can_mix_prose_and_panel_chapters() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let project = create(dir.path(), "My Comic Novel", ChapterKind::Prose).unwrap();
        let page = add_chapter(dir.path(), &project.id, "", ChapterKind::Panel).unwrap();
        assert_eq!(page.title, "Page 1");
        let chapter2 = add_chapter(dir.path(), &project.id, "", ChapterKind::Prose).unwrap();
        assert_eq!(chapter2.title, "Chapter 2");

        let full = get(dir.path(), &project.id).unwrap();
        assert_eq!(full.chapters.len(), 3);
        let summary = list(dir.path()).unwrap().into_iter().find(|p| p.id == project.id).unwrap();
        assert_eq!(summary.chapter_count, 3);
        assert_eq!(summary.panel_count, 1);
    }

    #[test]
    fn old_project_level_kind_migrates_onto_every_chapter() {
        // Guards backward compatibility with 0.1.8 saves, where `kind`
        // lived on the project and chapters had no `kind` field at all.
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let raw = r#"{"projects":[{"id":"p1","title":"Old Comic","kind":"panel","createdAt":0,"updatedAt":0,"chapters":[{"id":"c1","title":"Page 1","content":"","wordCount":0,"updatedAt":0},{"id":"c2","title":"Page 2","content":"","wordCount":0,"updatedAt":0}]}]}"#;
        fs::write(store_path(dir.path()), raw).unwrap();
        let project = get(dir.path(), "p1").unwrap();
        assert_eq!(project.chapters[0].kind, ChapterKind::Panel);
        assert_eq!(project.chapters[1].kind, ChapterKind::Panel);
    }

    #[test]
    fn old_prose_only_project_with_no_kind_field_at_all_defaults_to_prose() {
        // Even older (0.1.7) saves had no `kind` anywhere.
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let raw = r#"{"projects":[{"id":"p1","title":"Old Novel","createdAt":0,"updatedAt":0,"chapters":[{"id":"c1","title":"Chapter 1","content":"","wordCount":0,"updatedAt":0}]}]}"#;
        fs::write(store_path(dir.path()), raw).unwrap();
        let project = get(dir.path(), "p1").unwrap();
        assert_eq!(project.chapters[0].kind, ChapterKind::Prose);
    }
}
