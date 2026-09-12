//! Inkwell: Xuro's writing studio. Phase 1 is prose-only — chaptered
//! long-form writing (novels, fanfiction, scripts), each project a
//! sequence of rich-text chapters. Deliberately its own module and its own
//! storage, entirely separate from Notes and Library — a "project" here is
//! never a note and never a library item, even though all three ultimately
//! live in the same vault.
//!
//! Storage mirrors `manga_online.rs`'s approach: one JSON store
//! (`.xuro/studio.json`) holding every project, rather than a file per
//! project — simple, and prose content is plain text/HTML, so there's no
//! real size concern here the way there would be with embedded images.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::util::now_ms;
use crate::vault::DATA_DIR;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub title: String,
    /// Markdown source — same content model the Notes editor already uses
    /// (Tiptap's markdown extension), so a chapter is just plain portable
    /// text, not markup tied to Xuro's own renderer.
    pub content: String,
    pub word_count: u32,
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub title: String,
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
    pub word_count: u32,
}

impl Project {
    fn summary(&self) -> ProjectSummary {
        ProjectSummary {
            id: self.id.clone(),
            title: self.title.clone(),
            updated_at: self.updated_at,
            chapter_count: self.chapters.len(),
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
    Ok(serde_json::from_str(&fs::read_to_string(path)?).unwrap_or_default())
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

pub fn create(root: &Path, title: &str) -> AppResult<Project> {
    let mut store = read(root)?;
    let now = now_ms();
    let project = Project {
        id: Uuid::new_v4().to_string(),
        title: if title.trim().is_empty() {
            "Untitled project".to_string()
        } else {
            title.trim().to_string()
        },
        created_at: now,
        updated_at: now,
        chapters: vec![Chapter {
            id: Uuid::new_v4().to_string(),
            title: "Chapter 1".to_string(),
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

pub fn add_chapter(root: &Path, project_id: &str, title: &str) -> AppResult<Chapter> {
    let mut store = read(root)?;
    let now = now_ms();
    let project = find_project(&mut store, project_id)?;
    let chapter = Chapter {
        id: Uuid::new_v4().to_string(),
        title: if title.trim().is_empty() {
            format!("Chapter {}", project.chapters.len() + 1)
        } else {
            title.trim().to_string()
        },
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
        let project = create(dir.path(), "My Novel").unwrap();
        assert_eq!(project.title, "My Novel");
        assert_eq!(project.chapters.len(), 1);
        assert_eq!(project.chapters[0].title, "Chapter 1");
    }

    #[test]
    fn update_chapter_stores_content_and_word_count() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let project = create(dir.path(), "My Novel").unwrap();
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
        let project = create(dir.path(), "My Novel").unwrap();
        let c2 = add_chapter(dir.path(), &project.id, "Chapter 2").unwrap();
        let c3 = add_chapter(dir.path(), &project.id, "Chapter 3").unwrap();
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
        let project = create(dir.path(), "Temp").unwrap();
        delete(dir.path(), &project.id).unwrap();
        assert!(get(dir.path(), &project.id).is_err());
    }
}
