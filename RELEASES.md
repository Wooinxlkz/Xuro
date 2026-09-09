# Releases

All notable changes to Xuro are documented here. See also the [in-app changelog page](https://usexuro.app/changelog).

## [0.1.2] — September 9, 2026

Graph polish, a real PDF reader, and snippet previews

### Fixes

- Graph: right-clicking a note or folder no longer shows the OS's native context menu underneath Xuro's own.
- Library search: added a retry with backoff for Open Library/Jikan requests, since both are free public APIs that occasionally bounce a request with a 502/503/504 under load — most of what looked like a hang or an error before now quietly retries and succeeds.

### Changed

- Graph: folders are outlined only now — no filled background, just a colored, dashed border (and the label is tinted the same color), per feedback that the fill read as too loud.
- Graph: added a filter box that dims everything not matching what you type, a Rename action on notes and folders, and a "New note" action on right-clicking empty canvas.
- Library upload: pick the file first, then its title is pre-filled from the filename (still fully editable) instead of asking for a title before you've even chosen a file.
- Settings → Background: added three more presets — Mossy Hollow, Chocolate Truffle, and Ink Wash — alongside Default, Cream, and Soft.

### Features

- Library: uploaded PDFs now open in a real in-app reader (page navigation, zoom, page counter) instead of only handing off to your system's default viewer. EPUB/CBZ/CBR still open externally for now.
- Snippets: HTML, CSS, and JavaScript snippets get a live Preview — a sandboxed, one-click render of the snippet's actual output, right in its card. JavaScript previews include p5.js bundled in, so a sketch just runs.

## [0.1.1] — September 8, 2026

Real vault encryption, and a Library

### Security

- PIN locks are now a real encryption boundary, not just a UI hide: locking a note or folder encrypts its file content on disk with AES-256-GCM. The key is a random 256-bit value generated once per vault and held in your OS keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux) — never written to disk in plain text, and never derived from the PIN itself, so resetting a forgotten PIN from Settings can never turn into permanently lost data. Unlocking decrypts a note back to an ordinary, fully portable `.md` file.
- Fixed 9 dependency vulnerabilities (2 high, 7 moderate) flagged by `npm audit`, all transitive through the Graph canvas's Mermaid-diagram support.
- Hardened the Xuro Cloud OTP verification to compare codes in constant time, removing a (largely theoretical, given the existing rate limiting) timing side-channel.
- Removed unused, half-wired signed-update-manifest tooling that nothing in the app actually consumed, to avoid implying a stronger update-verification guarantee than the app makes today.

### Features

- Added **Library** — a personal books/manga shelf with list, grid, and bento views. Search and add from free public catalogs (Open Library for books, Jikan for manga), both filtered against explicit content. Upload your own PDF, EPUB, CBZ, or CBR — it's copied into a `Library/` folder inside your vault, so it's backed up and synced with everything else; opens in your system's default viewer for now.

### Changed

- Normalized the GitHub repo reference casing (`Wooinxlkz/Xuro`) across the update checker, website, and release scripts.

## [0.1.0] — September 7, 2026

Xuro, from the ground up

Xuro's version numbering restarted here — a fresh baseline folding in everything built up to this point (previously spread across versions 0.1.0 through 0.2.5), consolidated into one release, plus a smarter Graph view and multiple Kanban boards.

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
