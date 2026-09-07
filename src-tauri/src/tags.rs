//! Inline `#tag` extraction across the vault, for the Tags browser page.
//! A line starting with 1-6 `#` characters then a space is a Markdown
//! heading, not a tag, and is skipped. Locked notes/folders are excluded
//! entirely — same rule as search.rs, for the same reason: a tag listing
//! that surfaces a locked note's title would defeat the lock.

use std::collections::BTreeMap;
use std::fs;
use std::path::Path;

use serde::Serialize;

use crate::error::AppResult;
use crate::locks;
use crate::vault::{is_reserved_note_path, notes_root, rel_of};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagEntry {
    pub tag: String,
    pub notes: Vec<TaggedNote>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TaggedNote {
    pub rel: String,
    pub title: String,
}

pub fn list_tags(root: &Path) -> AppResult<Vec<TagEntry>> {
    let mut by_tag: BTreeMap<String, Vec<TaggedNote>> = BTreeMap::new();
    walk(root, &notes_root(root), &mut by_tag)?;
    let mut entries: Vec<TagEntry> = by_tag
        .into_iter()
        .map(|(tag, notes)| TagEntry { tag, notes })
        .collect();
    entries.sort_by(|a, b| b.notes.len().cmp(&a.notes.len()).then(a.tag.cmp(&b.tag)));
    Ok(entries)
}

fn walk(root: &Path, dir: &Path, by_tag: &mut BTreeMap<String, Vec<TaggedNote>>) -> AppResult<()> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Ok(());
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || is_reserved_note_path(root, &path) {
            continue;
        }
        if path.is_dir() {
            walk(root, &path, by_tag)?;
            continue;
        }
        if path.extension().is_none_or(|e| e != "md") {
            continue;
        }
        let rel = rel_of(root, &path)?;
        if locks::is_protected(root, &rel) {
            continue;
        }
        let title = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let content = fs::read_to_string(&path).unwrap_or_default();
        for tag in extract_tags(&content) {
            by_tag.entry(tag).or_default().push(TaggedNote {
                rel: rel.clone(),
                title: title.clone(),
            });
        }
    }
    Ok(())
}

fn extract_tags(content: &str) -> Vec<String> {
    let mut tags = Vec::new();
    for line in content.lines() {
        if is_heading(line.trim_start()) {
            continue;
        }
        let mut chars = line.char_indices();
        while let Some((i, ch)) = chars.next() {
            if ch != '#' {
                continue;
            }
            let preceded_ok =
                i == 0 || line[..i].chars().last().is_some_and(|p| p.is_whitespace());
            if !preceded_ok {
                continue;
            }
            let rest = &line[i + 1..];
            let tag: String = rest
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
                .collect();
            if tag.is_empty() || tag.chars().next().is_some_and(|c| c.is_numeric()) {
                continue;
            }
            let lower = tag.to_lowercase();
            if !tags.contains(&lower) {
                tags.push(lower);
            }
        }
    }
    tags
}

fn is_heading(trimmed: &str) -> bool {
    let hashes = trimmed.chars().take_while(|c| *c == '#').count();
    (1..=6).contains(&hashes) && trimmed.as_bytes().get(hashes) == Some(&b' ')
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notes::{create_note, write_note};
    use crate::vault::ensure_layout;
    use tempfile::tempdir;

    #[test]
    fn extracts_inline_tags_and_ignores_headings() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let rel = create_note(dir.path(), "", "Trip").unwrap();
        write_note(
            dir.path(),
            &rel,
            "# Trip planning\n\nPack for #hiking and #camping.\n## Day 1\nMore #hiking notes.",
        )
        .unwrap();

        let tags = list_tags(dir.path()).unwrap();
        let names: Vec<&str> = tags.iter().map(|t| t.tag.as_str()).collect();
        assert!(names.contains(&"hiking"));
        assert!(names.contains(&"camping"));
        assert!(!names.contains(&"trip"));
        assert!(!names.contains(&"planning"));

        let hiking = tags.iter().find(|t| t.tag == "hiking").unwrap();
        assert_eq!(hiking.notes.len(), 1); // same note, deduped
    }

    #[test]
    fn locked_notes_are_excluded_from_tags() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let rel = create_note(dir.path(), "", "Diary").unwrap();
        write_note(dir.path(), &rel, "feeling #grateful today").unwrap();
        locks::set_pin(dir.path(), &rel, "1234").unwrap();

        assert!(list_tags(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn numeric_only_hashes_are_not_tags() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let rel = create_note(dir.path(), "", "Issue").unwrap();
        write_note(dir.path(), &rel, "see #123 for details").unwrap();

        assert!(list_tags(dir.path()).unwrap().is_empty());
    }
}
