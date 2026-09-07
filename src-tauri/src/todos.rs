use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::boards::DEFAULT_BOARD_ID;
use crate::error::{AppError, AppResult};
use crate::util::now_ms;
use crate::vault::DATA_DIR;

fn default_board_id() -> String {
    DEFAULT_BOARD_ID.to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Todo {
    pub id: String,
    pub text: String,
    pub done: bool,
    pub created_at: i64,
    #[serde(default)]
    pub completed_at: Option<i64>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Kanban-only: which non-Done column a not-yet-done todo sits in. Never
    /// touched by `toggle` (the flat list's checkbox) — only `set_status`
    /// (the Kanban board's drag action) sets it, so the flat Tasks list's
    /// existing behavior is completely unaffected by this field's existence.
    #[serde(default)]
    pub in_progress: bool,
    /// Which Kanban board this card lives on. Todos saved before boards
    /// existed have no value for this in their JSON, so `serde(default)`
    /// resolves them onto the same default board id that `boards::list`
    /// bootstraps for a vault with no `boards.json` yet — nothing is
    /// orphaned by the upgrade.
    #[serde(default = "default_board_id")]
    pub board_id: String,
}

/// The three Kanban columns. `done` and `in_progress` together determine
/// which one a todo is in — see `Todo::in_progress`'s doc comment.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TodoStatus {
    Todo,
    InProgress,
    Done,
}

fn store_path(root: &Path) -> std::path::PathBuf {
    root.join(DATA_DIR).join("todos.json")
}

fn tags_path(root: &Path) -> std::path::PathBuf {
    root.join(DATA_DIR).join("todo_tags.json")
}

/// The tag registry — tags created by the user, in creation order.
pub fn list_tags(root: &Path) -> AppResult<Vec<String>> {
    let path = tags_path(root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn save_tags(root: &Path, tags: &[String]) -> AppResult<()> {
    fs::write(tags_path(root), serde_json::to_string_pretty(tags)?)?;
    Ok(())
}

fn register(root: &Path, incoming: &[String]) -> AppResult<Vec<String>> {
    let mut tags = list_tags(root)?;
    let mut changed = false;
    for tag in incoming {
        if !tags.contains(tag) {
            tags.push(tag.clone());
            changed = true;
        }
    }
    if changed {
        save_tags(root, &tags)?;
    }
    Ok(tags)
}

pub fn create_tag(root: &Path, name: &str) -> AppResult<Vec<String>> {
    let tag = crate::util::normalize_tags(vec![name.to_string()])
        .into_iter()
        .next()
        .ok_or_else(|| AppError::InvalidInput("tag is empty".to_string()))?;
    register(root, &[tag])
}

/// Delete a tag from the registry and strip it from every todo.
pub fn delete_tag(root: &Path, name: &str) -> AppResult<Vec<String>> {
    let mut tags = list_tags(root)?;
    tags.retain(|t| t != name);
    save_tags(root, &tags)?;

    let mut todos = list(root)?;
    let mut changed = false;
    for todo in &mut todos {
        if todo.tags.iter().any(|t| t == name) {
            todo.tags.retain(|t| t != name);
            changed = true;
        }
    }
    if changed {
        save(root, &todos)?;
    }
    Ok(tags)
}

pub fn list(root: &Path) -> AppResult<Vec<Todo>> {
    let path = store_path(root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    Ok(serde_json::from_str(&fs::read_to_string(path)?)?)
}

fn save(root: &Path, todos: &[Todo]) -> AppResult<()> {
    fs::write(store_path(root), serde_json::to_string_pretty(todos)?)?;
    Ok(())
}

pub fn add(root: &Path, text: &str, board_id: &str) -> AppResult<Todo> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::InvalidInput("todo text is empty".to_string()));
    }
    let board_id = if board_id.trim().is_empty() {
        DEFAULT_BOARD_ID.to_string()
    } else {
        board_id.trim().to_string()
    };
    let todo = Todo {
        id: Uuid::new_v4().to_string(),
        text: text.to_string(),
        done: false,
        created_at: now_ms(),
        completed_at: None,
        tags: Vec::new(),
        in_progress: false,
        board_id,
    };
    let mut todos = list(root)?;
    todos.insert(0, todo.clone());
    save(root, &todos)?;
    Ok(todo)
}

/// Moves every todo on `from_board` onto `to_board` — used when a board is
/// deleted so its cards don't just vanish.
pub fn reassign_board(root: &Path, from_board: &str, to_board: &str) -> AppResult<()> {
    let mut todos = list(root)?;
    let mut changed = false;
    for todo in &mut todos {
        if todo.board_id == from_board {
            todo.board_id = to_board.to_string();
            changed = true;
        }
    }
    if changed {
        save(root, &todos)?;
    }
    Ok(())
}

pub fn toggle(root: &Path, id: &str) -> AppResult<Todo> {
    let mut todos = list(root)?;
    let todo = todos
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    todo.done = !todo.done;
    todo.completed_at = todo.done.then(now_ms);
    let updated = todo.clone();
    save(root, &todos)?;
    Ok(updated)
}

/// The Kanban board's drag action — moves a todo directly to a target
/// column. Distinct from `toggle`, which the flat list's checkbox alone
/// uses and which never touches `in_progress`.
pub fn set_status(root: &Path, id: &str, status: TodoStatus) -> AppResult<Todo> {
    let mut todos = list(root)?;
    let todo = todos
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    match status {
        TodoStatus::Todo => {
            todo.done = false;
            todo.in_progress = false;
            todo.completed_at = None;
        }
        TodoStatus::InProgress => {
            todo.done = false;
            todo.in_progress = true;
            todo.completed_at = None;
        }
        TodoStatus::Done => {
            todo.done = true;
            todo.in_progress = false;
            todo.completed_at = Some(now_ms());
        }
    }
    let updated = todo.clone();
    save(root, &todos)?;
    Ok(updated)
}

pub fn update_text(root: &Path, id: &str, text: &str) -> AppResult<Todo> {
    let text = text.trim();
    if text.is_empty() {
        return Err(AppError::InvalidInput("todo text is empty".to_string()));
    }
    let mut todos = list(root)?;
    let todo = todos
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    todo.text = text.to_string();
    let updated = todo.clone();
    save(root, &todos)?;
    Ok(updated)
}

pub fn set_tags(root: &Path, id: &str, tags: Vec<String>) -> AppResult<Todo> {
    let mut todos = list(root)?;
    let todo = todos
        .iter_mut()
        .find(|t| t.id == id)
        .ok_or_else(|| AppError::NotFound(id.to_string()))?;
    todo.tags = crate::util::normalize_tags(tags);
    let updated = todo.clone();
    save(root, &todos)?;
    register(root, &updated.tags)?;
    Ok(updated)
}

pub fn delete(root: &Path, id: &str) -> AppResult<()> {
    let mut todos = list(root)?;
    let before = todos.len();
    todos.retain(|t| t.id != id);
    if todos.len() == before {
        return Err(AppError::NotFound(id.to_string()));
    }
    save(root, &todos)
}

pub fn clear_completed(root: &Path) -> AppResult<Vec<Todo>> {
    let mut todos = list(root)?;
    todos.retain(|t| !t.done);
    save(root, &todos)?;
    Ok(todos)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::ensure_layout;
    use tempfile::tempdir;

    #[test]
    fn add_toggle_clear_roundtrip() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();

        let a = add(dir.path(), "buy milk", DEFAULT_BOARD_ID).unwrap();
        let _b = add(dir.path(), "write code", DEFAULT_BOARD_ID).unwrap();
        assert_eq!(list(dir.path()).unwrap().len(), 2);

        let toggled = toggle(dir.path(), &a.id).unwrap();
        assert!(toggled.done);
        assert!(toggled.completed_at.is_some());

        let remaining = clear_completed(dir.path()).unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].text, "write code");
    }

    #[test]
    fn empty_text_rejected() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        assert!(add(dir.path(), "   ", DEFAULT_BOARD_ID).is_err());
    }

    #[test]
    fn newest_first() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        add(dir.path(), "first", DEFAULT_BOARD_ID).unwrap();
        add(dir.path(), "second", DEFAULT_BOARD_ID).unwrap();
        assert_eq!(list(dir.path()).unwrap()[0].text, "second");
    }

    #[test]
    fn set_status_moves_between_kanban_columns() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let todo = add(dir.path(), "ship it", DEFAULT_BOARD_ID).unwrap();
        assert!(!todo.done && !todo.in_progress);

        let moved = set_status(dir.path(), &todo.id, TodoStatus::InProgress).unwrap();
        assert!(!moved.done && moved.in_progress);

        let done = set_status(dir.path(), &todo.id, TodoStatus::Done).unwrap();
        assert!(done.done && !done.in_progress && done.completed_at.is_some());

        let back = set_status(dir.path(), &todo.id, TodoStatus::Todo).unwrap();
        assert!(!back.done && !back.in_progress && back.completed_at.is_none());
    }

    #[test]
    fn toggle_never_touches_in_progress() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let todo = add(dir.path(), "flat list item", DEFAULT_BOARD_ID).unwrap();
        set_status(dir.path(), &todo.id, TodoStatus::InProgress).unwrap();

        let toggled = toggle(dir.path(), &todo.id).unwrap();
        assert!(toggled.done);
        assert!(toggled.in_progress, "toggle must not clear in_progress");
    }

    #[test]
    fn legacy_todo_json_with_no_board_id_defaults_onto_the_default_board() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let legacy_json = r#"[{
            "id": "abc",
            "text": "pre-boards todo",
            "done": false,
            "createdAt": 0,
            "completedAt": null,
            "tags": [],
            "inProgress": false
        }]"#;
        fs::write(store_path(dir.path()), legacy_json).unwrap();

        let todos = list(dir.path()).unwrap();
        assert_eq!(todos[0].board_id, DEFAULT_BOARD_ID);
    }

    #[test]
    fn new_todos_land_on_the_requested_board() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        let todo = add(dir.path(), "on board 2", "board-2").unwrap();
        assert_eq!(todo.board_id, "board-2");
    }
}
