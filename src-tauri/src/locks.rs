//! PIN locks on notes and folders — an in-app access gate, not file
//! encryption. A locked note/folder's content is hidden from the UI until
//! the correct PIN is entered; the underlying file on disk is untouched and
//! readable by anything with filesystem access (a text editor, another app).
//! That's a deliberate, disclosed limitation, not an oversight — see
//! `README.md`'s "Data & privacy" section.
//!
//! PINs are never stored in plain text: each lock keeps a random salt and
//! `sha256(salt + pin)`, so reading `locks.json` directly doesn't hand over
//! the PIN. This is a deterrent against casual/offline viewing, not
//! cryptographic-grade protection — a 4-digit PIN is only ever brute-force
//! resistant to another *app* rate-limiting attempts, not to someone with
//! the hash and unlimited local guesses.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::vault::{resolve_rel, DATA_DIR};

fn store_path(root: &Path) -> PathBuf {
    root.join(DATA_DIR).join("locks.json")
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct LockEntry {
    salt: String,
    hash: String,
}

type LockMap = HashMap<String, LockEntry>;

fn read(root: &Path) -> AppResult<LockMap> {
    let path = store_path(root);
    if !path.exists() {
        return Ok(LockMap::new());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?).unwrap_or_default())
}

fn save(root: &Path, map: &LockMap) -> AppResult<()> {
    fs::write(store_path(root), serde_json::to_string_pretty(map)?)?;
    Ok(())
}

fn hash_pin(salt: &str, pin: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(salt.as_bytes());
    hasher.update(pin.as_bytes());
    STANDARD.encode(hasher.finalize())
}

fn validate_pin(pin: &str) -> AppResult<()> {
    let ok = pin.len() == 4 && pin.chars().all(|c| c.is_ascii_digit());
    if ok {
        Ok(())
    } else {
        Err(AppError::InvalidInput("PIN must be 4 digits".to_string()))
    }
}

fn is_entry(root: &Path, rel: &str) -> bool {
    resolve_rel(root, rel).is_ok_and(|path| path.exists())
}

/// Every locked rel, in no particular order — for the Settings list.
pub fn list(root: &Path) -> AppResult<Vec<String>> {
    Ok(read(root)?.into_keys().collect())
}

pub fn is_locked(root: &Path, rel: &str) -> bool {
    read(root).map(|map| map.contains_key(rel)).unwrap_or(false)
}

/// Locked itself, or inside a locked ancestor folder — the check any
/// full-vault scan (search, tags, backlinks) must pass a note/folder
/// through before exposing its content or existence.
pub fn is_protected(root: &Path, rel: &str) -> bool {
    let Ok(map) = read(root) else {
        return false;
    };
    if map.contains_key(rel) {
        return true;
    }
    let mut parts: Vec<&str> = rel.split('/').collect();
    parts.pop();
    let mut ancestor = String::new();
    for part in parts {
        ancestor = if ancestor.is_empty() {
            part.to_string()
        } else {
            format!("{ancestor}/{part}")
        };
        if map.contains_key(&ancestor) {
            return true;
        }
    }
    false
}

/// Set or replace the PIN on a note/folder. The caller (a Tauri command) is
/// responsible for requiring the *old* PIN first when one already exists —
/// this function itself does not re-verify, so it doubles as the "forgot my
/// PIN" reset path from Settings.
pub fn set_pin(root: &Path, rel: &str, pin: &str) -> AppResult<()> {
    if !is_entry(root, rel) {
        return Err(AppError::NotFound(rel.to_string()));
    }
    validate_pin(pin)?;
    let mut map = read(root)?;
    let salt = Uuid::new_v4().to_string();
    let hash = hash_pin(&salt, pin);
    map.insert(rel.to_string(), LockEntry { salt, hash });
    save(root, &map)
}

/// `true` if `pin` matches, or if `rel` isn't locked at all.
pub fn verify_pin(root: &Path, rel: &str, pin: &str) -> AppResult<bool> {
    let map = read(root)?;
    let Some(entry) = map.get(rel) else {
        return Ok(true);
    };
    Ok(hash_pin(&entry.salt, pin) == entry.hash)
}

/// Remove a lock outright — used for the explicit "Remove PIN" menu action
/// and as the second half of the Settings "forgot my PIN" reset.
pub fn remove_lock(root: &Path, rel: &str) -> AppResult<()> {
    let mut map = read(root)?;
    map.remove(rel);
    save(root, &map)
}

/// Rewrite a locked note or every locked descendant after a note/folder move.
pub fn remap(root: &Path, from: &str, to: &str) -> AppResult<()> {
    let mut map = read(root)?;
    let mut changed = false;
    let prefix = format!("{from}/");
    let keys: Vec<String> = map.keys().cloned().collect();
    for key in keys {
        if key == from {
            if let Some(entry) = map.remove(&key) {
                map.insert(to.to_string(), entry);
                changed = true;
            }
        } else if let Some(rest) = key.strip_prefix(&prefix) {
            if let Some(entry) = map.remove(&key) {
                map.insert(format!("{to}/{rest}"), entry);
                changed = true;
            }
        }
    }
    if changed {
        save(root, &map)?;
    }
    Ok(())
}

/// Remove a lock and every locked descendant after deletion.
pub fn remove_under(root: &Path, rel: &str) -> AppResult<()> {
    let mut map = read(root)?;
    let prefix = format!("{rel}/");
    let before = map.len();
    map.retain(|key, _| key != rel && !key.starts_with(&prefix));
    if map.len() != before {
        save(root, &map)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::{ensure_layout, notes_root};
    use tempfile::tempdir;

    fn setup() -> tempfile::TempDir {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        fs::create_dir_all(notes_root(dir.path()).join("projects")).unwrap();
        fs::write(notes_root(dir.path()).join("Secret.md"), "").unwrap();
        fs::write(notes_root(dir.path()).join("projects/Plan.md"), "").unwrap();
        dir
    }

    #[test]
    fn sets_and_verifies_a_pin() {
        let dir = setup();
        set_pin(dir.path(), "Secret.md", "1234").unwrap();
        assert!(is_locked(dir.path(), "Secret.md"));
        assert!(verify_pin(dir.path(), "Secret.md", "1234").unwrap());
        assert!(!verify_pin(dir.path(), "Secret.md", "0000").unwrap());
    }

    #[test]
    fn unlocked_entries_always_verify() {
        let dir = setup();
        assert!(!is_locked(dir.path(), "projects/Plan.md"));
        assert!(verify_pin(dir.path(), "projects/Plan.md", "anything").unwrap());
    }

    #[test]
    fn rejects_non_numeric_or_wrong_length_pins() {
        let dir = setup();
        assert!(set_pin(dir.path(), "Secret.md", "12a4").is_err());
        assert!(set_pin(dir.path(), "Secret.md", "123").is_err());
        assert!(set_pin(dir.path(), "Secret.md", "12345").is_err());
    }

    #[test]
    fn rejects_locking_a_missing_entry() {
        let dir = setup();
        assert!(set_pin(dir.path(), "Missing.md", "1234").is_err());
    }

    #[test]
    fn never_stores_the_pin_in_plain_text() {
        let dir = setup();
        set_pin(dir.path(), "Secret.md", "1234").unwrap();
        let raw = fs::read_to_string(store_path(dir.path())).unwrap();
        assert!(!raw.contains("1234"));
    }

    #[test]
    fn removes_a_lock() {
        let dir = setup();
        set_pin(dir.path(), "Secret.md", "1234").unwrap();
        remove_lock(dir.path(), "Secret.md").unwrap();
        assert!(!is_locked(dir.path(), "Secret.md"));
    }

    #[test]
    fn remaps_on_rename_and_move() {
        let dir = setup();
        set_pin(dir.path(), "Secret.md", "1234").unwrap();
        set_pin(dir.path(), "projects/Plan.md", "5678").unwrap();
        remap(dir.path(), "Secret.md", "Renamed.md").unwrap();
        remap(dir.path(), "projects", "work").unwrap();
        assert!(is_locked(dir.path(), "Renamed.md"));
        assert!(is_locked(dir.path(), "work/Plan.md"));
        assert!(!is_locked(dir.path(), "Secret.md"));
        assert!(verify_pin(dir.path(), "Renamed.md", "1234").unwrap());
        assert!(verify_pin(dir.path(), "work/Plan.md", "5678").unwrap());
    }

    #[test]
    fn removes_lock_and_descendants_on_delete() {
        let dir = setup();
        set_pin(dir.path(), "Secret.md", "1234").unwrap();
        set_pin(dir.path(), "projects/Plan.md", "5678").unwrap();
        remove_under(dir.path(), "projects").unwrap();
        assert!(is_locked(dir.path(), "Secret.md"));
        assert!(!is_locked(dir.path(), "projects/Plan.md"));
    }

    #[test]
    fn is_protected_covers_locked_ancestors_not_just_direct_locks() {
        let dir = setup();
        fs::create_dir_all(notes_root(dir.path()).join("projects/deep")).unwrap();
        fs::write(notes_root(dir.path()).join("projects/deep/Nested.md"), "").unwrap();
        set_pin(dir.path(), "projects", "1234").unwrap();

        assert!(is_protected(dir.path(), "projects"));
        assert!(is_protected(dir.path(), "projects/Plan.md"));
        assert!(is_protected(dir.path(), "projects/deep/Nested.md"));
        assert!(!is_protected(dir.path(), "Secret.md"));
    }
}
