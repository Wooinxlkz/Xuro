use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::error::AppResult;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default)]
    pub vault_path: Option<String>,
    #[serde(default)]
    pub theme: Theme,
    #[serde(default)]
    pub accent_color: AccentColor,
    #[serde(default)]
    pub accent_custom_hex: Option<String>,
    #[serde(default)]
    pub background_style: BackgroundStyle,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

/// A tasteful accent used for a small set of touchpoints (selection, links,
/// checked items) — never a full re-theme. "Default" keeps the app fully
/// monochrome, matching prior versions exactly.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccentColor {
    #[default]
    Default,
    Blue,
    Green,
    Purple,
    Red,
    Orange,
    Custom,
}

/// A background/paper tint applied to the canvas, panels, and sunken
/// surfaces in both light and dark mode. "Default" is the existing palette,
/// unchanged.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundStyle {
    #[default]
    Default,
    Cream,
    Soft,
}

fn config_file(app: &tauri::AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| crate::error::AppError::Other(e.to_string()))?;
    fs::create_dir_all(&dir)?;
    Ok(dir.join("config.json"))
}

pub fn load(app: &tauri::AppHandle) -> AppConfig {
    let Ok(path) = config_file(app) else {
        return AppConfig::default();
    };
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

pub fn save(app: &tauri::AppHandle, config: &AppConfig) -> AppResult<()> {
    let path = config_file(app)?;
    fs::write(path, serde_json::to_string_pretty(config)?)?;
    Ok(())
}
