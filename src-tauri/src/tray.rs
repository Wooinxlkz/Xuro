//! System tray icon: sits in the Windows taskbar's hidden-icons area, with a
//! right-click menu — pinned notes for quick access (when a vault is open),
//! then Open Xuro and Exit — and left-click-to-open, matching how most
//! Windows tray apps behave. The menu is rebuilt whenever the vault changes
//! or a note is pinned/unpinned, via `refresh`.

use std::path::Path;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};

use crate::pins;

const TRAY_ID: &str = "main-tray";
/// Keep the tray menu short — this is a quick-access shortcut, not a second
/// sidebar.
const MAX_PINS_SHOWN: usize = 8;

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let icon = app
        .default_window_icon()
        .cloned()
        .expect("app icon is configured in tauri.conf.json");

    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("Xuro")
        .menu(&build_menu(app, None)?)
        .show_menu_on_left_click(false)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Rebuild the tray menu — call after the vault changes or pins change.
/// `root` is the currently open vault, if any; failures are non-fatal (the
/// tray just falls back to no pinned items).
pub fn refresh(app: &AppHandle, root: Option<&Path>) {
    let Ok(menu) = build_menu(app, root) else {
        return;
    };
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_menu(app: &AppHandle, root: Option<&Path>) -> tauri::Result<Menu<Wry>> {
    let pinned = root
        .and_then(|root| pins::list(root).ok())
        .unwrap_or_default();

    let mut items: Vec<Box<dyn tauri::menu::IsMenuItem<Wry>>> = Vec::new();
    for rel in pinned.iter().take(MAX_PINS_SHOWN) {
        let label = display_name(rel);
        let item = MenuItem::with_id(app, format!("pin:{rel}"), label, true, None::<&str>)?;
        items.push(Box::new(item));
    }
    if !items.is_empty() {
        items.push(Box::new(PredefinedMenuItem::separator(app)?));
    }

    let open_item = MenuItem::with_id(app, "open", "Open Xuro", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit_item = MenuItem::with_id(app, "quit", "Exit", true, None::<&str>)?;
    items.push(Box::new(open_item));
    items.push(Box::new(separator));
    items.push(Box::new(quit_item));

    let refs: Vec<&dyn tauri::menu::IsMenuItem<Wry>> =
        items.iter().map(|item| item.as_ref()).collect();
    Menu::with_items(app, &refs)
}

/// "Notes/hello world.md" -> "hello world"
fn display_name(rel: &str) -> String {
    let file_name = rel.rsplit('/').next().unwrap_or(rel);
    file_name.strip_suffix(".md").unwrap_or(file_name).to_string()
}

fn handle_menu_event(app: &AppHandle, event: tauri::menu::MenuEvent) {
    let id = event.id.as_ref();
    match id {
        "open" => show_main_window(app),
        "quit" => app.exit(0),
        _ => {
            if let Some(rel) = id.strip_prefix("pin:") {
                show_main_window(app);
                let _ = app.emit("xuro:tray-open-note", rel);
            }
        }
    }
}

fn show_main_window(app: &AppHandle) {
    crate::focus_main_window(app);
}
