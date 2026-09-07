use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::util::now_ms;
use crate::vault::DATA_DIR;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    pub id: String,
    pub title: String,
    /// Freeform, e.g. "javascript", "bash", "" for plain text — not
    /// validated against a fixed list, just used for display/copy.
    #[serde(default)]
    pub language: String,
    pub content: String,
    pub created_at: i64,
}

fn store_path(root: &Path) -> PathBuf {
    root.join(DATA_DIR).join("snippets.json")
}

pub fn list(root: &Path) -> AppResult<Vec<Snippet>> {
    let path = store_path(root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn save(root: &Path, snippets: &[Snippet]) -> AppResult<()> {
    fs::write(store_path(root), serde_json::to_string_pretty(snippets)?)?;
    Ok(())
}

pub fn add(root: &Path, title: &str, language: &str, content: &str) -> AppResult<Snippet> {
    let trimmed_title = title.trim();
    if trimmed_title.is_empty() {
        return Err(AppError::InvalidInput("title is empty".to_string()));
    }
    if content.trim().is_empty() {
        return Err(AppError::InvalidInput("snippet content is empty".to_string()));
    }
    let mut snippets = list(root)?;
    let snippet = Snippet {
        id: Uuid::new_v4().to_string(),
        title: trimmed_title.to_string(),
        language: language.trim().to_string(),
        content: content.to_string(),
        created_at: now_ms(),
    };
    snippets.insert(0, snippet.clone());
    save(root, &snippets)?;
    Ok(snippet)
}

pub fn update(
    root: &Path,
    id: &str,
    title: &str,
    language: &str,
    content: &str,
) -> AppResult<Snippet> {
    let trimmed_title = title.trim();
    if trimmed_title.is_empty() {
        return Err(AppError::InvalidInput("title is empty".to_string()));
    }
    let mut snippets = list(root)?;
    let snippet = snippets
        .iter_mut()
        .find(|s| s.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    snippet.title = trimmed_title.to_string();
    snippet.language = language.trim().to_string();
    snippet.content = content.to_string();
    let updated = snippet.clone();
    save(root, &snippets)?;
    Ok(updated)
}

pub fn delete(root: &Path, id: &str) -> AppResult<()> {
    let mut snippets = list(root)?;
    let before = snippets.len();
    snippets.retain(|s| s.id != id);
    if snippets.len() == before {
        return Err(AppError::NotFound(id.to_string()));
    }
    save(root, &snippets)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::ensure_layout;
    use tempfile::tempdir;

    #[test]
    fn add_update_delete_roundtrip() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();

        let created = add(dir.path(), "Fetch helper", "javascript", "fetch(url)").unwrap();
        assert_eq!(list(dir.path()).unwrap().len(), 1);

        let updated = update(dir.path(), &created.id, "Fetch helper v2", "ts", "fetch(url)").unwrap();
        assert_eq!(updated.title, "Fetch helper v2");
        assert_eq!(updated.language, "ts");

        delete(dir.path(), &created.id).unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn rejects_empty_title_or_content() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        assert!(add(dir.path(), "  ", "", "content").is_err());
        assert!(add(dir.path(), "Title", "", "   ").is_err());
    }

    #[test]
    fn newest_first() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        add(dir.path(), "first", "", "a").unwrap();
        add(dir.path(), "second", "", "b").unwrap();
        assert_eq!(list(dir.path()).unwrap()[0].title, "second");
    }
}
