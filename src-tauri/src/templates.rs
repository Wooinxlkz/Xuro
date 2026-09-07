//! Note templates — reusable starting content for new notes (meeting notes,
//! project briefs, etc.), the same idea as Notion's page templates. Stored
//! the same way Snippets are: a flat JSON file in the vault's data dir, no
//! folder structure of their own.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::notes;
use crate::util::now_ms;
use crate::vault::DATA_DIR;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Template {
    pub id: String,
    pub title: String,
    /// The template body. May contain `{{date}}`, `{{time}}`, and `{{title}}`
    /// placeholders, resolved when a note is created from the template.
    pub content: String,
    pub created_at: i64,
}

fn store_path(root: &Path) -> PathBuf {
    root.join(DATA_DIR).join("templates.json")
}

pub fn list(root: &Path) -> AppResult<Vec<Template>> {
    let path = store_path(root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn save(root: &Path, templates: &[Template]) -> AppResult<()> {
    fs::write(store_path(root), serde_json::to_string_pretty(templates)?)?;
    Ok(())
}

pub fn add(root: &Path, title: &str, content: &str) -> AppResult<Template> {
    let trimmed_title = title.trim();
    if trimmed_title.is_empty() {
        return Err(AppError::InvalidInput("title is empty".to_string()));
    }
    let mut templates = list(root)?;
    let template = Template {
        id: Uuid::new_v4().to_string(),
        title: trimmed_title.to_string(),
        content: content.to_string(),
        created_at: now_ms(),
    };
    templates.insert(0, template.clone());
    save(root, &templates)?;
    Ok(template)
}

pub fn update(root: &Path, id: &str, title: &str, content: &str) -> AppResult<Template> {
    let trimmed_title = title.trim();
    if trimmed_title.is_empty() {
        return Err(AppError::InvalidInput("title is empty".to_string()));
    }
    let mut templates = list(root)?;
    let template = templates
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    template.title = trimmed_title.to_string();
    template.content = content.to_string();
    let updated = template.clone();
    save(root, &templates)?;
    Ok(updated)
}

pub fn delete(root: &Path, id: &str) -> AppResult<()> {
    let mut templates = list(root)?;
    let before = templates.len();
    templates.retain(|t| t.id != id);
    if templates.len() == before {
        return Err(AppError::NotFound(id.to_string()));
    }
    save(root, &templates)
}

/// Create a new note in `dir` from template `id`, with `{{date}}`,
/// `{{time}}`, and `{{title}}` resolved in the template body. `title` is
/// both the new note's file name and the value substituted for
/// `{{title}}` — matching how the "New note" flow already names files.
pub fn create_note_from(
    root: &Path,
    id: &str,
    dir: &str,
    title: &str,
) -> AppResult<String> {
    let templates = list(root)?;
    let template = templates
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    let content = resolve_placeholders(&template.content, title);
    notes::create_note_with_content(root, dir, title, &content)
}

/// Resolve a template's placeholders against `title` without creating a
/// note — used for inserting a template's content into the note that's
/// already open, where there's no new file to name.
pub fn resolve(root: &Path, id: &str, title: &str) -> AppResult<String> {
    let templates = list(root)?;
    let template = templates
        .iter()
        .find(|t| t.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    Ok(resolve_placeholders(&template.content, title))
}

fn resolve_placeholders(content: &str, title: &str) -> String {
    let now = chrono_like_now();
    content
        .replace("{{date}}", &now.0)
        .replace("{{time}}", &now.1)
        .replace("{{title}}", title)
}

/// Local date/time as `(YYYY-MM-DD, HH:MM)`, without pulling in a chrono
/// dependency just for this — matches the plain-digit format the rest of
/// the codebase already uses for daily notes.
fn chrono_like_now() -> (String, String) {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let time_of_day = secs % 86_400;
    let (y, m, d) = civil_from_days(days as i64);
    let date = format!("{y:04}-{m:02}-{d:02}");
    let time = format!("{:02}:{:02}", time_of_day / 3600, (time_of_day % 3600) / 60);
    (date, time)
}

/// Days-since-epoch to (year, month, day), civil calendar, UTC. Standard
/// Howard Hinnant algorithm — avoids pulling in a chrono dependency for
/// this one conversion.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
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

        let created = add(dir.path(), "Meeting notes", "# {{title}}\n\nDate: {{date}}").unwrap();
        assert_eq!(list(dir.path()).unwrap().len(), 1);

        let updated = update(dir.path(), &created.id, "Meeting notes v2", "body").unwrap();
        assert_eq!(updated.title, "Meeting notes v2");

        delete(dir.path(), &created.id).unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn rejects_empty_title() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        assert!(add(dir.path(), "  ", "content").is_err());
    }

    #[test]
    fn resolves_placeholders_into_a_real_note() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let template = add(dir.path(), "Daily standup", "# {{title}}\nWritten {{date}} at {{time}}").unwrap();
        let rel = create_note_from(dir.path(), &template.id, "", "Standup").unwrap();
        let content = notes::read_note(dir.path(), &rel).unwrap();
        assert!(content.contains("# Standup"));
        assert!(!content.contains("{{date}}"));
        assert!(!content.contains("{{time}}"));
    }

    #[test]
    fn resolve_does_not_create_a_note() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let template = add(dir.path(), "Meeting", "## {{title}}\n\n- ").unwrap();
        let content = resolve(dir.path(), &template.id, "Standup").unwrap();
        assert!(content.contains("## Standup"));
        // No note was written to disk for this — resolve() is read-only.
        assert!(!dir.path().join("Standup.md").exists());
    }

    #[test]
    fn civil_from_days_matches_known_date() {
        // 2026-01-01 is 20454 days after 1970-01-01.
        assert_eq!(civil_from_days(20454), (2026, 1, 1));
    }
}
