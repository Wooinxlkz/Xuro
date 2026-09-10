//! A small local diagnostics log — captures unexpected errors (frontend JS
//! errors, unhandled promise rejections, and Rust panics) with a
//! timestamp, so troubleshooting a report doesn't depend on the person
//! having a terminal open when it happened. Stored outside any vault (in
//! the OS app-config dir, same place as the Xuro Cloud session file)
//! since an error can happen before a vault is even open — and because a
//! debug log genuinely doesn't belong inside a portable notes vault.
//!
//! This is intentionally best-effort: a lost log entry from a race
//! between two near-simultaneous errors is an acceptable trade-off for
//! not needing a database just to remember the last few hundred crashes.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::util::now_ms;

/// Keep the log from growing forever — oldest entries drop off first.
const MAX_ENTRIES: usize = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugEntry {
    pub id: String,
    pub at_ms: i64,
    /// "error" | "warn" | "panic"
    pub level: String,
    /// "frontend" | "backend"
    pub source: String,
    pub message: String,
    pub context: Option<String>,
}

fn log_path(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| AppError::Other(e.to_string()))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("debug-log.json"))
}

fn read(app: &tauri::AppHandle) -> Vec<DebugEntry> {
    let Ok(path) = log_path(app) else {
        return Vec::new();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return Vec::new();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

fn save(app: &tauri::AppHandle, entries: &[DebugEntry]) -> AppResult<()> {
    let path = log_path(app)?;
    fs::write(path, serde_json::to_string_pretty(entries)?)?;
    Ok(())
}

/// Appends one entry. Errors writing the log are swallowed on purpose —
/// a diagnostics feature that itself crashes the app (or masks the real
/// error with a logging error) defeats its own purpose.
pub fn add(app: &tauri::AppHandle, level: &str, source: &str, message: &str, context: Option<String>) {
    let mut entries = read(app);
    entries.push(DebugEntry {
        id: Uuid::new_v4().to_string(),
        at_ms: now_ms(),
        level: level.to_string(),
        source: source.to_string(),
        message: message.to_string(),
        context,
    });
    if entries.len() > MAX_ENTRIES {
        let excess = entries.len() - MAX_ENTRIES;
        entries.drain(0..excess);
    }
    let _ = save(app, &entries);
}

/// Newest first — that's what's actually useful when opening the panel to
/// see "what just happened".
pub fn list(app: &tauri::AppHandle) -> Vec<DebugEntry> {
    let mut entries = read(app);
    entries.reverse();
    entries
}

pub fn clear(app: &tauri::AppHandle) -> AppResult<()> {
    save(app, &[])
}

#[cfg(test)]
mod tests {
    use super::*;

    // `debug_log`'s functions all take a real `tauri::AppHandle`, which
    // needs a running app to construct — not something worth spinning up
    // a whole Tauri instance for in a unit test. `add`/`read`/`save`'s
    // actual logic (append, cap at MAX_ENTRIES, newest-first ordering) is
    // straightforward enough to review by hand; this module leans on
    // manual/desktop testing rather than a mocked AppHandle.
    #[test]
    fn max_entries_constant_is_sane() {
        assert!(MAX_ENTRIES > 0);
    }
}
