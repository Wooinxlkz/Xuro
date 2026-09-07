//! Import a folder tree from an Obsidian vault. Obsidian and Xuro are both
//! "plain markdown files on disk" apps with the same `[[wikilink]]` syntax,
//! so most of a vault imports as-is. The two things that need real
//! conversion:
//!
//! - Obsidian's `![[target]]` embed syntax. For images, we copy the
//!   attachment into Xuro's own asset store and rewrite it to a normal
//!   `![](.xuro/assets/…)` markdown image. For anything else (embedding
//!   another note, an unsupported attachment type) Xuro has no equivalent
//!   of live transclusion, so it becomes a plain `[[target]]` link instead
//!   of being silently dropped.
//! - Obsidian's `.obsidian` config folder, `.trash`, and other dot-prefixed
//!   directories are skipped — they're Obsidian-specific, not vault content.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::util::sanitize_name;
use crate::vault::ASSETS_DIR;

const IMAGE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg"];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    /// Rel path of the top-level folder the import was written into.
    pub folder: String,
    pub notes_imported: usize,
    pub attachments_imported: usize,
    /// Rel-to-source paths of `.md` files that couldn't be read (bad
    /// encoding, permissions, etc.) — reported rather than silently lost.
    pub skipped: Vec<String>,
}

/// Import every `.md` file (and any image attachments they reference) from
/// `source` into a new top-level folder in `root`.
pub fn import_vault(root: &Path, source: &Path) -> AppResult<ImportSummary> {
    if !source.is_dir() {
        return Err(AppError::NotFound(source.display().to_string()));
    }

    let dest_root = available_dir(root, "Imported from Obsidian");
    fs::create_dir_all(&dest_root)?;
    let dest_folder_rel = dest_root
        .strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| "Imported from Obsidian".to_string());

    let mut md_files = Vec::new();
    let mut attachment_index: HashMap<String, PathBuf> = HashMap::new();
    collect_files(source, &mut md_files, &mut attachment_index)?;

    let mut notes_imported = 0;
    let mut attachments_imported = 0;
    let mut skipped = Vec::new();
    // Attachments already copied this run, keyed by source path, so a file
    // embedded from multiple notes isn't duplicated in the asset store.
    let mut copied_assets: HashMap<PathBuf, String> = HashMap::new();

    for md_path in &md_files {
        let rel_from_source = md_path
            .strip_prefix(source)
            .unwrap_or(md_path)
            .to_string_lossy()
            .replace('\\', "/");

        let Ok(raw) = fs::read_to_string(md_path) else {
            skipped.push(rel_from_source);
            continue;
        };

        let converted = convert_embeds(
            &raw,
            &attachment_index,
            &mut copied_assets,
            root,
            &mut attachments_imported,
        )?;

        let target_path = dest_root.join(sanitize_relative_md_path(&rel_from_source));
        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent)?;
        }
        let target_path = unique_file_path(&target_path);
        fs::write(&target_path, converted)?;
        notes_imported += 1;
    }

    Ok(ImportSummary {
        folder: dest_folder_rel,
        notes_imported,
        attachments_imported,
        skipped,
    })
}

/// Recursively collect `.md` files and index every other file by lowercased
/// filename, skipping dot-prefixed directories (`.obsidian`, `.trash`, …).
fn collect_files(
    dir: &Path,
    md_files: &mut Vec<PathBuf>,
    attachment_index: &mut HashMap<String, PathBuf>,
) -> AppResult<()> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            collect_files(&path, md_files, attachment_index)?;
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            md_files.push(path);
        } else if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
            attachment_index.insert(fname.to_lowercase(), path);
        }
    }
    Ok(())
}

/// Replace `![[target]]` (Obsidian embeds) with either a copied-in image or
/// a plain wikilink, and leave ordinary `[[links]]` untouched — Xuro's
/// wikilink support already handles those natively.
fn convert_embeds(
    content: &str,
    attachment_index: &HashMap<String, PathBuf>,
    copied_assets: &mut HashMap<PathBuf, String>,
    root: &Path,
    attachments_imported: &mut usize,
) -> AppResult<String> {
    let mut out = String::with_capacity(content.len());
    let bytes = content.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if content[i..].starts_with("![[") {
            if let Some(end) = content[i + 3..].find("]]") {
                let inner = &content[i + 3..i + 3 + end];
                let bare = inner.split('|').next().unwrap_or(inner);
                let bare = bare.split('#').next().unwrap_or(bare).trim();
                let ext = Path::new(bare)
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| e.to_lowercase());

                let is_image = ext
                    .as_deref()
                    .map(|e| IMAGE_EXTENSIONS.contains(&e))
                    .unwrap_or(false);

                if is_image {
                    if let Some(source_path) = attachment_index.get(&bare.to_lowercase()) {
                        let vault_rel = if let Some(existing) = copied_assets.get(source_path) {
                            existing.clone()
                        } else {
                            let ext = ext.unwrap_or_else(|| "png".to_string());
                            let dest_name = format!("{}.{ext}", Uuid::new_v4());
                            let dest_dir = root.join(ASSETS_DIR);
                            fs::create_dir_all(&dest_dir)?;
                            fs::copy(source_path, dest_dir.join(&dest_name))?;
                            let vault_rel = format!("{ASSETS_DIR}/{dest_name}");
                            copied_assets.insert(source_path.clone(), vault_rel.clone());
                            *attachments_imported += 1;
                            vault_rel
                        };
                        out.push_str(&format!("![]({vault_rel})"));
                        i += 3 + end + 2;
                        continue;
                    }
                }

                // Not a resolvable image embed (missing file, embedded note,
                // or unsupported attachment type) — degrade to a plain link
                // rather than dropping the reference entirely.
                out.push_str(&format!("[[{inner}]]"));
                i += 3 + end + 2;
                continue;
            }
        }
        let ch = content[i..].chars().next().unwrap();
        out.push(ch);
        i += ch.len_utf8();
    }
    Ok(out)
}

/// Turn a source-relative path like "Projects/Idea.md" into a sanitized
/// relative path, cleaning each path segment independently so folder names
/// go through the same rules as note titles.
fn sanitize_relative_md_path(rel: &str) -> PathBuf {
    let mut out = PathBuf::new();
    for segment in rel.split('/') {
        if segment.is_empty() {
            continue;
        }
        out.push(sanitize_name(segment));
    }
    out
}

/// Pick a directory name under `root` that doesn't exist yet, suffixing
/// " 2", " 3", … so re-running an import never clobbers a previous one.
fn available_dir(root: &Path, base: &str) -> PathBuf {
    let mut candidate = root.join(base);
    let mut counter = 2;
    while candidate.exists() {
        candidate = root.join(format!("{base} {counter}"));
        counter += 1;
    }
    candidate
}

/// Like `available_dir` but for a single file path — used when two source
/// notes sanitize to the same filename within a folder.
fn unique_file_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let ext = path.extension().and_then(|e| e.to_str());
    let dir = path.parent().unwrap_or(Path::new(""));
    let mut counter = 2;
    loop {
        let candidate = match ext {
            Some(ext) => dir.join(format!("{stem} {counter}.{ext}")),
            None => dir.join(format!("{stem} {counter}")),
        };
        if !candidate.exists() {
            return candidate;
        }
        counter += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::ensure_layout;
    use tempfile::tempdir;

    fn write(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, content).unwrap();
    }

    #[test]
    fn imports_notes_preserving_folders_and_wikilinks() {
        let vault = tempdir().unwrap();
        ensure_layout(vault.path()).unwrap();

        let source = tempdir().unwrap();
        write(
            &source.path().join("Projects/Idea.md"),
            "# Idea\n\nSee [[Other Note]] for context.",
        );
        write(&source.path().join(".obsidian/config.json"), "{}");

        let summary = import_vault(vault.path(), source.path()).unwrap();
        assert_eq!(summary.notes_imported, 1);
        assert_eq!(summary.attachments_imported, 0);
        assert!(summary.skipped.is_empty());

        let imported = fs::read_to_string(
            vault
                .path()
                .join(&summary.folder)
                .join("Projects/Idea.md"),
        )
        .unwrap();
        assert!(imported.contains("[[Other Note]]"));
    }

    #[test]
    fn converts_image_embeds_and_copies_the_attachment() {
        let vault = tempdir().unwrap();
        ensure_layout(vault.path()).unwrap();

        let source = tempdir().unwrap();
        write(
            &source.path().join("Note.md"),
            "Here's a photo: ![[photo.png]]",
        );
        write(&source.path().join("attachments/photo.png"), "fake-bytes");

        let summary = import_vault(vault.path(), source.path()).unwrap();
        assert_eq!(summary.notes_imported, 1);
        assert_eq!(summary.attachments_imported, 1);

        let imported =
            fs::read_to_string(vault.path().join(&summary.folder).join("Note.md")).unwrap();
        assert!(imported.contains("![](.xuro/assets/"));
        assert!(!imported.contains("![[photo.png]]"));
    }

    #[test]
    fn downgrades_unresolvable_embed_to_plain_link() {
        let vault = tempdir().unwrap();
        ensure_layout(vault.path()).unwrap();

        let source = tempdir().unwrap();
        write(
            &source.path().join("Note.md"),
            "Transclusion: ![[Some Other Note]]",
        );

        let summary = import_vault(vault.path(), source.path()).unwrap();
        let imported =
            fs::read_to_string(vault.path().join(&summary.folder).join("Note.md")).unwrap();
        assert!(imported.contains("[[Some Other Note]]"));
        assert!(!imported.contains("!["));
    }

    #[test]
    fn reimport_does_not_clobber_previous_import() {
        let vault = tempdir().unwrap();
        ensure_layout(vault.path()).unwrap();
        let source = tempdir().unwrap();
        write(&source.path().join("Note.md"), "first");

        let first = import_vault(vault.path(), source.path()).unwrap();
        let second = import_vault(vault.path(), source.path()).unwrap();
        assert_ne!(first.folder, second.folder);
    }
}
