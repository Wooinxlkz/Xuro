# Releases

All notable changes to Xuro are documented here. See also the [in-app changelog page](https://usexuro.app/changelog).

Xuro's version numbering restarts at **v0.1.0** with this release. Everything built before this point — previously spread across versions 0.1.0 through 0.2.5 — is folded into this single entry below as a full retrospective, alongside what's new in this reset itself.

## [0.1.0] — September 7, 2026

Xuro, from the ground up

A fresh baseline: every feature and fix built so far, consolidated into one release, plus a smarter Graph view and multiple Kanban boards.

### Features

- Keep every note as a plain Markdown file in a folder you choose, in a focused rich-text editor that preserves portable Markdown.
- Organize notes with real folders, search, tabs, and a Markdown source view via CodeMirror.
- Capture a thought from anywhere with the global Quick Capture window, and jump straight to today's Daily Note.
- See backlinks and linked mentions with context in a dedicated sidebar; pin important notes and folders above the regular tree.
- Add and edit typed note properties inline, including clickable URL properties, without hand-writing YAML.
- Apply text and highlight colors — five presets plus a sixth, fully custom color backed by the OS color picker.
- Find and replace text inside a note without leaving the editor; customize keyboard shortcuts throughout.
- Add Note Templates — reusable starting content with `{{title}}`, `{{date}}`, and `{{time}}` placeholders, insertable into a brand-new note or the one you already have open.
- Render LaTeX/math live in the editor via KaTeX — inline `$math$` and block `$$math$$`, stored as plain text.
- Export a note to PDF exactly as shown in the editor, including math, tables, and images.
- Import an entire Obsidian vault — notes, image attachments, converted embeds, and working `[[wikilinks]]` — without ever overwriting an existing import.
- Add PIN locks for notes and folders — protected content is hidden everywhere, including search, until unlocked, with a recovery path from Settings.
- Add a Tags page for browsing notes by inline `#tag` with no frontmatter required.
- Add Snippets for quick reusable text and code, with search/filter, language autocomplete, and real syntax highlighting.
- Add a real Excalidraw canvas, saved as a normal `.excalidraw` file right in your vault.
- Add a **Graph view**, now folder-aware: notes are grouped inside their containing folder like a workflow diagram, each folder gets a slight, deterministic color tint, folders can be collapsed or expanded with a click, and right-clicking a note or folder opens an info panel with path, dates, size, and note count. Also includes a right-click menu (Open note, Pin/Unpin, Reveal in sidebar, Open file location) and a Fit to view button.
- Add **multiple Kanban boards** — create as many as you need, switch between them with tabs, and rename any board's title inline. Drag cards between Todo, In Progress, and Done as before, now scoped per board.
- Add Zen mode for distraction-free writing (⌘/Ctrl+Shift+Z, or Esc to exit).
- Add an optional accent color (five presets plus a custom picker) and a background tint (Default, Cream, Soft), with a one-click light/dark toggle in the sidebar.
- Publish a note together with its linked pages and images as one connected site, and read published notes with matching typography and automatic light/dark mode.
- Subscribe to Xuro Cloud from the website or desktop app and manage billing in Settings, with a proper segmented six-digit sign-in code.
- Add a system tray icon (Open Xuro, Exit; left-click to focus) that lists pinned notes for one-click opening.
- Add an About tab in Settings with version, feature overview, credits, and sharing shortcuts.
- Ship a custom-branded NSIS installer for Windows, installing to Program Files by default; new notes land in a Notes folder by default to keep the vault root tidy.
- Install a Developer ID signed and Apple-notarized release on macOS.

### Fixes

- Graph view no longer collapses into a single vertical line — it now waits for a real, measured container size before laying out, and re-lays out automatically once it has one.
- Closing the window (the titlebar X) hides Xuro to the background instead of leaving it unresponsive; the tray icon or relaunching brings the window back.
- Launching Xuro again while it's already running now focuses the existing window instead of failing silently.
- The in-app update checker reads directly from GitHub Releases instead of a separately-hosted manifest, and correctly covers Windows.
- The accent color now visibly applies across the app (caret, text selection, active tab, active nav item) instead of being limited to a couple of subtle spots.
- Renaming or moving a non-Markdown file (like a canvas) no longer silently changes its extension to `.md`.
- An empty table is now removable in one Backspace/Delete press, matching every other empty block.
- Notifications stay readable across both light and dark themes.

### Changed

- Renamed "Todos" to "Tasks" throughout the app; renamed the right-click "Reveal in File Manager" to "Open file location" / "Open folder location".
- Changed the project license from MIT to a source-available, no-redistribution license — see LICENSE for details.
