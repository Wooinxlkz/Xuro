//! Whole-vault link graph, for the Graph view. Reuses the same link
//! scanning `backlinks.rs` already does for individual notes — this just
//! runs it across every note instead of filtering for one target, and
//! keeps every resolved edge instead of only the ones pointing at a
//! particular note.
//!
//! As of the folder-aware graph (v0.1.0), this also emits a `folders`
//! list so the frontend can render notes nested inside their containing
//! folder (a cytoscape compound node), similar to how a workflow tool
//! like n8n groups nodes inside a container. Each note and folder also
//! carries enough filesystem metadata (created/modified time, size, note
//! count) to power a right-click "info" panel without a second round trip.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::UNIX_EPOCH;

use serde::Serialize;

use crate::backlink_links::{normalize_destination, resolve_wiki, scan_content};
use crate::backlinks::{collect_note_rels, walk_notes};
use crate::error::AppResult;
use crate::vault::{notes_root, rel_of};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNode {
    pub rel: String,
    pub title: String,
    /// Number of edges touching this node (in + out, deduplicated) — the
    /// frontend uses this to size/emphasize well-connected notes.
    pub degree: usize,
    /// Rel of the immediate parent folder, or `None` at the vault root.
    /// Maps directly onto cytoscape's compound-node `parent` field.
    pub folder: Option<String>,
    /// "note" or "canvas" — lets the frontend pick an icon/shape.
    pub kind: &'static str,
    pub created_ms: i64,
    pub modified_ms: i64,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphEdge {
    pub source: String,
    pub target: String,
}

/// A folder rendered as a compound (container) node in the graph — notes
/// and other folders nest inside it visually, the way a workflow tool
/// groups related nodes inside a labelled box.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphFolder {
    pub rel: String,
    pub name: String,
    /// Rel of the containing folder, or `None` if this sits at the vault root.
    pub parent: Option<String>,
    /// Every note anywhere under this folder, direct or nested.
    pub note_count: usize,
    pub modified_ms: i64,
    /// Deterministic hue (0-359) derived from the folder's path, so the
    /// same folder always renders with the same slight tint.
    pub hue: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Graph {
    pub nodes: Vec<GraphNode>,
    pub edges: Vec<GraphEdge>,
    pub folders: Vec<GraphFolder>,
}

/// Cheap, stable string hash (FNV-1a) used only to pick a deterministic
/// hue per folder path — not for anything security-sensitive.
fn hue_for(rel: &str) -> u16 {
    let mut hash: u32 = 2166136261;
    for byte in rel.bytes() {
        hash ^= byte as u32;
        hash = hash.wrapping_mul(16777619);
    }
    (hash % 360) as u16
}

fn parent_of(rel: &str) -> Option<String> {
    let idx = rel.rfind('/')?;
    Some(rel[..idx].to_string())
}

fn file_stat(path: &Path) -> (i64, i64, u64) {
    let Ok(meta) = std::fs::metadata(path) else {
        return (0, 0, 0);
    };
    let to_ms = |t: std::io::Result<std::time::SystemTime>| {
        t.ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0)
    };
    let modified = to_ms(meta.modified());
    // `created()` isn't available on every filesystem (older ext4 without
    // extended attrs, some network mounts) — fall back to modified time
    // rather than showing a bogus epoch date.
    let created = match to_ms(meta.created()) {
        0 => modified,
        ms => ms,
    };
    (created, modified, meta.len())
}

pub fn build_graph(root: &Path) -> AppResult<Graph> {
    let note_rels = collect_note_rels(root)?;
    let known: HashSet<&str> = note_rels.iter().map(String::as_str).collect();

    // Dedupe multiple links between the same pair of notes into one edge,
    // and treat A->B/B->A as the same undirected connection for display.
    let mut edge_set: HashSet<(String, String)> = HashSet::new();

    walk_notes(root, &notes_root(root), &mut |path, content| {
        let source_rel = rel_of(root, path)?;
        scan_content(content, |_line, _line_number, raw, wiki| {
            let target = if wiki {
                resolve_wiki(raw, &note_rels)
            } else {
                normalize_destination(raw)
            };
            let Some(target) = target else { return };
            if !known.contains(target.as_str()) || target == source_rel {
                return;
            }
            let pair = if source_rel <= target {
                (source_rel.clone(), target)
            } else {
                (target, source_rel.clone())
            };
            edge_set.insert(pair);
        });
        Ok(())
    })?;

    let mut degree: HashMap<String, usize> = note_rels.iter().map(|r| (r.clone(), 0)).collect();
    for (a, b) in &edge_set {
        *degree.entry(a.clone()).or_insert(0) += 1;
        *degree.entry(b.clone()).or_insert(0) += 1;
    }

    // Every ancestor folder of every note becomes a compound container
    // node, and each one's descendant note count grows as we walk up.
    let mut folder_counts: HashMap<String, usize> = HashMap::new();
    for rel in &note_rels {
        let mut current = parent_of(rel);
        while let Some(folder_rel) = current {
            *folder_counts.entry(folder_rel.clone()).or_insert(0) += 1;
            current = parent_of(&folder_rel);
        }
    }

    let mut folders: Vec<GraphFolder> = folder_counts
        .into_iter()
        .map(|(rel, note_count)| {
            let name = rel.rsplit('/').next().unwrap_or(&rel).to_string();
            let parent = parent_of(&rel);
            let (_, modified_ms, _) = file_stat(&notes_root(root).join(&rel));
            let hue = hue_for(&rel);
            GraphFolder { rel, name, parent, note_count, modified_ms, hue }
        })
        .collect();
    folders.sort_by(|a, b| a.rel.cmp(&b.rel));

    let nodes = note_rels
        .into_iter()
        .map(|rel| {
            let title = title_from_rel(&rel);
            let degree = degree.get(&rel).copied().unwrap_or(0);
            let folder = parent_of(&rel);
            let kind = if rel.ends_with(".excalidraw") { "canvas" } else { "note" };
            let (created_ms, modified_ms, size_bytes) =
                file_stat(&notes_root(root).join(&rel));
            GraphNode {
                rel,
                title,
                degree,
                folder,
                kind,
                created_ms,
                modified_ms,
                size_bytes,
            }
        })
        .collect();

    let edges = edge_set
        .into_iter()
        .map(|(source, target)| GraphEdge { source, target })
        .collect();

    Ok(Graph { nodes, edges, folders })
}

fn title_from_rel(rel: &str) -> String {
    Path::new(rel)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| rel.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notes::create_note_with_content;
    use crate::vault::ensure_layout;
    use tempfile::tempdir;

    #[test]
    fn links_between_two_notes_become_one_edge() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        create_note_with_content(dir.path(), "", "Alpha", "See [[Beta]].").unwrap();
        create_note_with_content(dir.path(), "", "Beta", "no links here").unwrap();

        let graph = build_graph(dir.path()).unwrap();
        assert_eq!(graph.nodes.len(), 2);
        assert_eq!(graph.edges.len(), 1);
        assert!(graph.nodes.iter().all(|n| n.degree == 1));
    }

    #[test]
    fn unresolvable_links_are_not_edges() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        create_note_with_content(dir.path(), "", "Alpha", "See [[Nonexistent]].").unwrap();

        let graph = build_graph(dir.path()).unwrap();
        assert_eq!(graph.nodes.len(), 1);
        assert_eq!(graph.edges.len(), 0);
        assert_eq!(graph.nodes[0].degree, 0);
    }

    #[test]
    fn self_links_are_ignored() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        create_note_with_content(dir.path(), "", "Alpha", "See [[Alpha]] again.").unwrap();

        let graph = build_graph(dir.path()).unwrap();
        assert_eq!(graph.edges.len(), 0);
    }

    #[test]
    fn duplicate_links_collapse_to_one_edge() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        create_note_with_content(dir.path(), "", "Alpha", "[[Beta]] and [[Beta]] again.")
            .unwrap();
        create_note_with_content(dir.path(), "", "Beta", "").unwrap();

        let graph = build_graph(dir.path()).unwrap();
        assert_eq!(graph.edges.len(), 1);
    }

    #[test]
    fn nested_notes_produce_ancestor_folder_nodes() {
        let dir = tempdir().unwrap();
        ensure_layout(dir.path()).unwrap();
        std::fs::create_dir_all(dir.path().join("projects/app")).unwrap();
        create_note_with_content(dir.path(), "projects/app", "Plan", "hello").unwrap();
        create_note_with_content(dir.path(), "projects", "Overview", "hi").unwrap();

        let graph = build_graph(dir.path()).unwrap();
        let plan = graph.nodes.iter().find(|n| n.title == "Plan").unwrap();
        assert_eq!(plan.folder.as_deref(), Some("projects/app"));

        let app_folder = graph.folders.iter().find(|f| f.rel == "projects/app").unwrap();
        assert_eq!(app_folder.parent.as_deref(), Some("projects"));
        assert_eq!(app_folder.note_count, 1);

        let projects_folder = graph.folders.iter().find(|f| f.rel == "projects").unwrap();
        assert_eq!(projects_folder.parent, None);
        // "Overview" lives directly in projects/, "Plan" lives in
        // projects/app/ — both count toward projects/'s total.
        assert_eq!(projects_folder.note_count, 2);
    }
}
