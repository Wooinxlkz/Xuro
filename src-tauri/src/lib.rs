mod agent_docs;
mod assets;
mod backlink_links;
mod backlinks;
mod boards;
mod bookmarks;
mod canvas;
mod cloud;
mod cloud_metadata;
mod cloud_publish;
mod commands;
mod config;
mod daily_notes;
mod error;
mod graph;
mod link_meta;
mod linux_webkit;
mod library;
mod locks;
mod notes;
mod obsidian_import;
mod pins;
mod quick_capture;
mod search;
mod snippets;
mod tags;
mod templates;
mod todos;
mod tray;
mod util;
mod vault;
mod vault_crypto;

use commands::AppState;
use tauri::{Manager, WindowEvent};
use tauri_plugin_global_shortcut::ShortcutState;

/// Bring the main window to the front — used both by the tray's "Open Xuro"
/// and by a second launch attempt (single-instance), so re-clicking the
/// app icon while Xuro is already running (minimized to tray after the
/// window was closed) always works instead of silently doing nothing.
pub(crate) fn focus_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    linux_webkit::configure();

    let quick_capture = tauri_plugin_global_shortcut::Builder::new()
        .with_shortcut("Control+Shift+Space")
        .expect("valid Quick Capture shortcut")
        .with_handler(|app, _shortcut, event| {
            if event.state() != ShortcutState::Pressed {
                return;
            }
            let _ = quick_capture::show(app);
        })
        .build();

    let mut builder = tauri::Builder::default();

    // Must be registered first: if Xuro is already running and the user
    // launches it again (desktop icon, Start menu, taskbar pin), this stops
    // a second process from starting and instead focuses the existing
    // window — previously a second launch attempt did nothing.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(quick_capture)
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            tray::setup(app.handle())?;

            // Closing the main window (the titlebar X) hides it instead of
            // destroying it, matching the tray icon we already ship — Xuro
            // keeps running in the background so pinned notes / quick
            // capture stay available, and clicking the tray or relaunching
            // the app brings the same window back instantly. Quitting for
            // real is "Exit" in the tray menu, which calls app.exit(0).
            if let Some(window) = app.get_webview_window("main") {
                let hide_target = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = hide_target.hide();
                    }
                });
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::startup,
            commands::choose_vault,
            commands::import_obsidian_vault,
            commands::create_vault,
            commands::load_tree,
            commands::read_note,
            commands::write_note,
            commands::create_note,
            commands::create_note_with_content,
            commands::open_daily_note,
            commands::show_quick_capture,
            commands::close_quick_capture,
            commands::create_folder,
            commands::rename_entry,
            commands::move_entry,
            commands::delete_entry,
            commands::search_notes,
            commands::list_tags,
            commands::snippets_list,
            commands::snippet_add,
            commands::snippet_update,
            commands::snippet_delete,
            commands::templates_list,
            commands::template_add,
            commands::template_update,
            commands::template_delete,
            commands::template_create_note,
            commands::template_resolve,
            commands::canvases_list,
            commands::canvas_read,
            commands::canvas_write,
            commands::canvas_create,
            commands::backlinks_for,
            commands::graph_data,
            commands::cloud_account_status,
            commands::cloud_request_otp,
            commands::cloud_verify_otp,
            commands::cloud_sign_out,
            commands::cloud_plans_url,
            commands::cloud_billing_portal_url,
            commands::published_note_status,
            commands::is_note_published,
            commands::publish_note,
            commands::update_published_note,
            commands::revoke_published_note,
            commands::pins_list,
            commands::pin_note,
            commands::unpin_note,
            commands::locks_list,
            commands::lock_is_locked,
            commands::lock_set_pin,
            commands::lock_verify,
            commands::lock_remove,
            commands::todos_list,
            commands::todo_add,
            commands::todo_toggle,
            commands::todo_set_status,
            commands::todo_update,
            commands::todo_set_tags,
            commands::todo_tags_list,
            commands::todo_tag_create,
            commands::todo_tag_delete,
            commands::todo_delete,
            commands::todos_clear_completed,
            commands::boards_list,
            commands::board_create,
            commands::board_rename,
            commands::board_delete,
            commands::library_list,
            commands::library_search_books,
            commands::library_search_manga,
            commands::library_add_from_search,
            commands::library_upload,
            commands::library_remove,
            commands::library_set_last_page,
            commands::library_read_file,
            commands::library_pick_upload_file,
            commands::bookmarks_list,
            commands::bookmark_add,
            commands::bookmark_update_title,
            commands::bookmark_set_tags,
            commands::bookmark_tags_list,
            commands::bookmark_tag_create,
            commands::bookmark_tag_delete,
            commands::bookmark_delete,
            commands::bookmark_fetch_meta,
            commands::export_bookmarks,
            commands::export_note,
            commands::export_note_pdf,
            commands::save_image_asset,
            commands::set_theme,
            commands::get_theme,
            commands::set_accent_color,
            commands::get_accent_color,
            commands::set_background_style,
            commands::get_background_style,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
