//! Kanban boards. A vault can have any number of boards, each with its own
//! editable title; every `Todo` (see `todos.rs`) belongs to exactly one via
//! `board_id`. Existing vaults from before boards existed implicitly get a
//! single "Board 1" — `list` creates and persists it the first time it's
//! called against a vault that has no `boards.json` yet, and `todos::Todo`
//! defaults any todo with no `board_id` in its saved JSON onto that same id.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::{AppError, AppResult};
use crate::util::now_ms;
use crate::vault::DATA_DIR;

/// The board legacy (pre-boards) todos, and the first board of a fresh
/// vault, land on. Stable so old `todos.json` data always resolves.
pub const DEFAULT_BOARD_ID: &str = "default";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Board {
    pub id: String,
    pub title: String,
    pub created_at: i64,
}

fn store_path(root: &Path) -> std::path::PathBuf {
    root.join(DATA_DIR).join("boards.json")
}

fn save(root: &Path, boards: &[Board]) -> AppResult<()> {
    fs::write(store_path(root), serde_json::to_string_pretty(boards)?)?;
    Ok(())
}

/// All boards, oldest first. Bootstraps a single default board the first
/// time it's called against a vault with none yet, so the Kanban page
/// always has somewhere for cards to live.
pub fn list(root: &Path) -> AppResult<Vec<Board>> {
    let path = store_path(root);
    if !path.exists() {
        let boards = vec![Board {
            id: DEFAULT_BOARD_ID.to_string(),
            title: "Board 1".to_string(),
            created_at: now_ms(),
        }];
        save(root, &boards)?;
        return Ok(boards);
    }
    let boards: Vec<Board> = serde_json::from_str(&fs::read_to_string(path)?)?;
    if boards.is_empty() {
        return list_after_reset(root);
    }
    Ok(boards)
}

fn list_after_reset(root: &Path) -> AppResult<Vec<Board>> {
    let boards = vec![Board {
        id: DEFAULT_BOARD_ID.to_string(),
        title: "Board 1".to_string(),
        created_at: now_ms(),
    }];
    save(root, &boards)?;
    Ok(boards)
}

pub fn create(root: &Path, title: &str) -> AppResult<Board> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("board title is empty".to_string()));
    }
    let board = Board {
        id: Uuid::new_v4().to_string(),
        title: title.to_string(),
        created_at: now_ms(),
    };
    let mut boards = list(root)?;
    boards.push(board.clone());
    save(root, &boards)?;
    Ok(board)
}

pub fn rename(root: &Path, id: &str, title: &str) -> AppResult<Board> {
    let title = title.trim();
    if title.is_empty() {
        return Err(AppError::InvalidInput("board title is empty".to_string()));
    }
    let mut boards = list(root)?;
    let board = boards
        .iter_mut()
        .find(|b| b.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    board.title = title.to_string();
    let updated = board.clone();
    save(root, &boards)?;
    Ok(updated)
}

/// Deletes a board. Refuses to delete the last remaining board — the
/// Kanban page always needs somewhere for cards to live. Any todos on the
/// deleted board are moved onto the oldest remaining board rather than
/// being silently lost.
pub fn delete(root: &Path, id: &str) -> AppResult<Vec<Board>> {
    let mut boards = list(root)?;
    if boards.len() <= 1 {
        return Err(AppError::InvalidInput(
            "can't delete the only board".to_string(),
        ));
    }
    let before = boards.len();
    boards.retain(|b| b.id != id);
    if boards.len() == before {
        return Err(AppError::NotFound(id.to_string()));
    }
    save(root, &boards)?;

    let fallback = boards[0].id.clone();
    crate::todos::reassign_board(root, id, &fallback)?;

    Ok(boards)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::ensure_layout;
    use tempfile::tempdir;

    #[test]
    fn bootstraps_a_default_board() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let boards = list(dir.path()).unwrap();
        assert_eq!(boards.len(), 1);
        assert_eq!(boards[0].id, DEFAULT_BOARD_ID);
    }

    #[test]
    fn create_rename_roundtrip() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let board = create(dir.path(), "Launch plan").unwrap();
        let renamed = rename(dir.path(), &board.id, "Q3 launch plan").unwrap();
        assert_eq!(renamed.title, "Q3 launch plan");
        assert_eq!(list(dir.path()).unwrap().len(), 2);
    }

    #[test]
    fn empty_title_rejected() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        assert!(create(dir.path(), "   ").is_err());
    }

    #[test]
    fn cannot_delete_last_board() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let boards = list(dir.path()).unwrap();
        assert!(delete(dir.path(), &boards[0].id).is_err());
    }

    #[test]
    fn deleting_a_board_reassigns_its_todos() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let second = create(dir.path(), "Second board").unwrap();
        let todo = crate::todos::add(dir.path(), "ship it", &second.id).unwrap();
        assert_eq!(todo.board_id, second.id);

        delete(dir.path(), &second.id).unwrap();

        let remaining = crate::todos::list(dir.path()).unwrap();
        assert_eq!(remaining[0].board_id, DEFAULT_BOARD_ID);
    }
}
