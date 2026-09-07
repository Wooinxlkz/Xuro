//! Excalidraw canvases, stored as real `.excalidraw` (JSON) files under a
//! dedicated `Canvases/` folder. This is a deliberately self-contained MVP:
//! canvases are not yet threaded through the main file tree, search, tags,
//! or backlinks — those all specifically scan `.md` files today, so adding
//! `.excalidraw` alongside them means touching several already-working,
//! well-tested subsystems. That's real, separate follow-up work, not
//! something to rush into the same pass as everything else in this
//! version. One consequence: a canvas can't yet be PIN-locked from the
//! right-click menu, since that menu only appears in the main tree.

use std::fs;
use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::util::sanitize_name;
use crate::vault::{notes_root, rel_of, resolve_rel};

pub const CANVAS_FOLDER: &str = "Canvases";

/// A brand-new, empty Excalidraw scene — the same shape Excalidraw itself
/// writes, so a freshly created file opens with zero surprises.
const EMPTY_SCENE: &str = r##"{"type":"excalidraw","version":2,"source":"xuro","elements":[],"appState":{"gridSize":null,"viewBackgroundColor":"#ffffff"},"files":{}}"##;

fn canvas_folder(root: &Path) -> std::path::PathBuf {
    notes_root(root).join(CANVAS_FOLDER)
}

/// Every `.excalidraw` file directly under Canvases/, newest first.
pub fn list(root: &Path) -> AppResult<Vec<String>> {
    let folder = canvas_folder(root);
    let Ok(entries) = fs::read_dir(&folder) else {
        return Ok(Vec::new());
    };
    let mut items: Vec<(String, std::time::SystemTime)> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().is_none_or(|e| e != "excalidraw") {
            continue;
        }
        let rel = rel_of(root, &path)?;
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        items.push((rel, modified));
    }
    items.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(items.into_iter().map(|(rel, _)| rel).collect())
}

pub fn read(root: &Path, rel: &str) -> AppResult<String> {
    let path = resolve_rel(root, rel)?;
    if path.extension().is_none_or(|e| e != "excalidraw") {
        return Err(AppError::InvalidPath(rel.to_string()));
    }
    Ok(fs::read_to_string(path)?)
}

pub fn write(root: &Path, rel: &str, content: &str) -> AppResult<()> {
    let path = resolve_rel(root, rel)?;
    if path.extension().is_none_or(|e| e != "excalidraw") {
        return Err(AppError::InvalidPath(rel.to_string()));
    }
    fs::write(path, content)?;
    Ok(())
}

/// Creates `Canvases/<Title>.excalidraw` (de-duplicating the filename if it
/// already exists) and returns its rel.
pub fn create(root: &Path, title: &str) -> AppResult<String> {
    let folder = canvas_folder(root);
    fs::create_dir_all(&folder)?;

    let safe_title = sanitize_name(title);
    let base = if safe_title.is_empty() {
        "Untitled".to_string()
    } else {
        safe_title
    };

    let mut candidate = format!("{base}.excalidraw");
    let mut n = 2;
    while folder.join(&candidate).exists() {
        candidate = format!("{base} {n}.excalidraw");
        n += 1;
    }

    let rel = format!("{CANVAS_FOLDER}/{candidate}");
    let path = resolve_rel(root, &rel)?;
    fs::write(&path, EMPTY_SCENE)?;
    Ok(rel)
}

pub fn delete(root: &Path, rel: &str) -> AppResult<()> {
    let path = resolve_rel(root, rel)?;
    if path.extension().is_none_or(|e| e != "excalidraw") {
        return Err(AppError::InvalidPath(rel.to_string()));
    }
    if !path.exists() {
        return Err(AppError::NotFound(rel.to_string()));
    }
    fs::remove_file(path)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::ensure_layout;
    use tempfile::tempdir;

    #[test]
    fn create_read_write_delete_roundtrip() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();

        let rel = create(dir.path(), "My Diagram").unwrap();
        assert_eq!(rel, "Canvases/My Diagram.excalidraw");
        assert_eq!(list(dir.path()).unwrap(), vec![rel.clone()]);

        let content = read(dir.path(), &rel).unwrap();
        assert!(content.contains("\"type\":\"excalidraw\""));

        write(dir.path(), &rel, r#"{"type":"excalidraw","elements":[1]}"#).unwrap();
        assert!(read(dir.path(), &rel).unwrap().contains("elements"));

        delete(dir.path(), &rel).unwrap();
        assert!(list(dir.path()).unwrap().is_empty());
    }

    #[test]
    fn duplicate_titles_get_suffixed() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let first = create(dir.path(), "Plan").unwrap();
        let second = create(dir.path(), "Plan").unwrap();
        assert_ne!(first, second);
        assert_eq!(second, "Canvases/Plan 2.excalidraw");
    }

    #[test]
    fn rejects_path_traversal() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        assert!(read(dir.path(), "../secrets.excalidraw").is_err());
        assert!(write(dir.path(), "../../etc/passwd", "x").is_err());
    }

    #[test]
    fn rejects_non_excalidraw_extensions() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        fs::create_dir_all(canvas_folder(dir.path())).unwrap();
        fs::write(canvas_folder(dir.path()).join("Note.md"), "hi").unwrap();
        assert!(read(dir.path(), "Canvases/Note.md").is_err());
    }
}
