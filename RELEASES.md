# Releases

All notable changes to Xuro are documented here. See also the [in-app changelog page](https://usexuro.app/changelog).

## [0.2.1] — September 16, 2026

A bigger built-in element library for Panel mode, and real fixes for Online Manga reliability

### Added

- **Panel mode's built-in Excalidraw Library, expanded to 15 items**: speech bubbles (round, manga-style, and a heavy-stroke shout bubble), a thought bubble, a caption/narration box, two impact/sound-effect bursts, speed lines, focus rings, a panel divider, and five onomatopoeia stickers (BOOM!, POW!, CRASH!, WHAM!, ...!?) — all available from Excalidraw's own Library panel on every page.
- **German** added to Online Manga's language filter, alongside English, Spanish, Arabic, and Japanese.
- **Novels** is now its own section in Library, next to Books and Manga — shares Books' Open Library catalog (no separate catalog to maintain), just kept as its own organized shelf. (Manhwa wasn't added as a separate section, since it's already searchable and readable through the Manga tab's existing MangaDex catalog.)

### Fixed

- **A manga's details panel could get stuck on an infinite loading spinner** with no error message and no way to retry if the fetch failed — this is very likely what "some manga just won't load" actually looked like from the outside. It now shows a clear error and a Retry button instead.
- **MangaDex requests now retry more resilently** — up from one quick retry to two, with backoff, since this app can burst several requests close together (browsing, opening details, loading a chapter list, and a background update-check can all land around the same time) and MangaDex's public rate limit is 5 requests/second per IP. Applied to Open Library/Jikan requests too, for the same reason.
- **Some manga were missing chapters** — Online Manga only ever fetched the first 100 chapters of a language for a given manga; anything past that was silently cut off. It now fetches every page until there's nothing left.
- **Chapters marked "External"** now link out to wherever MangaDex points them, instead of being a dead end — these are chapters MangaDex indexes but doesn't host the actual pages for, so there was never going to be an in-app reader for them, but they can least be one click away now.

## [0.2.0] — September 13, 2026

Snippets removed; Inkwell's Panel mode now matches Xuro's own look

### Removed

- **Snippets** has been removed entirely — the page, its store, its backend storage, and every menu/shortcut/command-palette entry that opened it.

### Changed

- **Panel mode's Excalidraw toolbar now matches Xuro's own colors** instead of Excalidraw's default purple — the active-tool highlight uses the same monochrome look as the rest of the app's active/pressed buttons.
- **Excalidraw's hamburger menu is rebuilt properly this time**: kept the genuinely useful native tools (Save as image, Export, Clear canvas, Change background) that got accidentally stripped out along with the branding last version, and replaced only the items that linked to Excalidraw's own docs/socials with Xuro's own GitHub link.
- **Added a canvas theme-toggle button** next to where Excalidraw's Help button was, via Excalidraw's `Footer` slot — lets the canvas chrome be flipped independently of Xuro's own app theme if you want it a different shade.

### Investigating

- A report of stray duplicate toolbar rows appearing in Inkwell when switching between chapters — still not confirmed reproducible from the description alone, but the pattern is consistent with a known class of WebView2 rendering glitch. Applied a defensive fix (the chapter toolbar and body now tear down and rebuild together as a single unit on every switch, instead of separately) that may resolve it, but this isn't confirmed as the actual root cause. If it happens again, the most useful thing to report is the exact sequence of chapters/pages clicked beforehand.

## [0.1.9] — September 12, 2026

Inkwell fixes: mixed projects, dark theme, image tool, and Excalidraw's default menu

### Changed

- **A project can now mix Prose chapters and Panel pages freely** — `kind` used to lock the whole project to one mode; it now lives on each chapter/page instead. The sidebar's "+ Chapter" / "+ Page" buttons add either kind at any time, each shown with its own small icon in the list. Pre-0.1.9 projects migrate automatically (an old Panel project's chapters all become Panel pages, an old Prose project's stay Prose).
- Export now follows the currently open item's kind: Markdown/text/PDF for Prose chapters, PNG/PDF for Panel pages — each PDF only pulls in chapters/pages of the matching kind, so a mixed project's prose doesn't end up inside the panel PDF or vice versa.

### Fixed

- **Panel mode's Excalidraw toolbar now matches Xuro's dark theme** — it was defaulting to Excalidraw's own light theme regardless of the app's theme, which is why its icons were hard to see. It now follows Xuro's theme the same way the existing Canvas feature already does.
- **Image tool (and drag-and-drop generally) inside Panel mode** — root cause was Tauri intercepting drag-and-drop at the OS level before the page ever saw it, a default Tauri v2 behavior. Disabled for Xuro's main window; confirmed nothing else in the app relied on it.
- **Switching page themes now actually changes the page** — it previously only affected panels added *after* the switch, leaving the current page looking unchanged. It now recolors the page immediately.
- Excalidraw's own hamburger menu (which linked to Excalidraw's own Discord/socials/docs) is replaced with a small Xuro-specific menu (GitHub link, background color control). Excalidraw's separate Help ("?") dialog isn't officially customizable, so it's hidden outright rather than left showing the wrong project's links.
- Made the Inkwell editor's project view remount cleanly on every project switch, as a defensive fix for an unconfirmed report of stray duplicate toolbar rows — we couldn't reproduce this from the description alone; if it recurs, please note exactly what you clicked beforehand so it can be tracked down properly.

## [0.1.8] — September 12, 2026

Inkwell Panel mode — manga/manhwa page layouts

### Added

- **Inkwell now has two project kinds, chosen at creation:**
  - **Prose** — exactly what shipped in 0.1.7 (chaptered rich-text writing).
  - **Panel** (new) — manga/manhwa-style page layouts on a real canvas: a fixed-size page, a right sidebar with six pre-built panel layouts (full-page splash, 2/3/4-panel stacks, 2×2 grid, wide-top-plus-two), and three page themes (B&W Manga, Colored Manhwa, Vanilla) that set the page's background and panel-border color. Panels are ordinary shapes once placed — drag, resize, or delete them like anything else on the canvas. Excalidraw's own toolbar (already part of the canvas) adds ellipse/arrow/text/freehand-draw on top of that.
  - Both kinds share one chapter/page list (reorder, rename, delete all work identically), one project grid, and one export button. Panel mode exports the current page as PNG, or the whole project as a multi-page PDF (it flips through every page automatically and assembles them).

### Note on the Panel-mode PDF export

- Building "export every page as one PDF" for a canvas-based editor is inherently trickier than Prose mode's text export — it works by briefly switching through every page in sequence and capturing each one, then assembling the results. This is the newest, least battle-tested part of this release; the single-page PNG export is the simpler, more proven fallback if the multi-page PDF ever produces an unexpected result on a particular project.

## [0.1.7] — September 11, 2026

Introducing Inkwell — a new writing studio, right in Xuro

### Added

- **Inkwell**, a brand-new tab for long-form writing: novels, fanfiction, scripts — anything told in chapters. This first version covers prose writing end to end:
  - Create a project, write chapters in a real rich-text editor (bold/italic/underline/strikethrough, headings, lists, blockquotes, undo/redo) with autosave.
  - Reorder, rename, and delete chapters from a sidebar; a running word count for each chapter and the whole project.
  - Export a project as Markdown, plain text, or a single PDF covering every chapter.
  - Entirely its own module, storage, and tab — doesn't touch Notes or Library in any way.
  - This is Phase 1 (prose mode) of a larger plan — a visual "panel mode" for manga/manhwa-style page layouts, templates, and themes is planned for a future release.

## [0.1.6] — September 11, 2026

Library restructure: local search stays local, Books gets an Online tab, downloads are easier to find

### Changed

- **Library search no longer reaches the internet.** The top search box in both Books and Manga now only ever filters what's already in "Your library" — it used to also fire a live catalog search in the background, so a local search and a catalog search were happening from the same box at once. Catalog browsing now lives entirely in its own tab.
- **Books now has the same "My Library" / "Online" split Manga has.** The Online tab is a dedicated Open Library search — same catalog as before, its own search box, clearly separate from your local shelf.
- **Downloaded manga now shows up in "My Library" too**, grouped by manga, not just inside Online Manga's own Downloads tab — no need to switch tabs to read something you already downloaded.
- Added a sort option ("Recently added" / "Title A–Z") to the local library view.
- Manga details: when a manga has no chapters in your chosen language, added a "Search other sources" link that opens a normal web search in your browser. (We looked into adding a second manga catalog API as an automatic fallback — there isn't a second MangaDex-quality official one; every alternative is unofficial reverse-engineered scraping, which we're not going to build on for something this fragile and ToS-risky. This is the safe version of that idea.)
- Settings → Diagnostics: "Run check" button label shortened so it no longer wraps awkwardly.

## [0.1.5] — September 11, 2026

Bug fixes for Online Manga, and a better Diagnostics panel

### Fixed

- Online Manga: favoriting a manga did nothing if you hadn't already followed it (favorite status lived on the follow record, so the star button silently no-op'd on an unfollowed manga). Favoriting now follows automatically first if needed — it always works with one click.
- Online Manga: the reader and manga details view could render tiny and cramped instead of full-screen, because they were positioned relative to a nested scrolling container instead of the window. They now always cover the full app window regardless of where they're opened from (Discover, Following, or Downloads).

### Changed

- Settings → Diagnostics: added a "Connection health" check (internet, Online Manga catalog, vault storage) with a one-tap re-check, so a connectivity problem reads as "your network" or "MangaDex is down" instead of looking like an app bug. Also fixed the Copy all/Clear buttons, which had a mismatched background making them look out of place.
- Online Manga → Following: added a "Mark all as seen" action on the New Chapters group.

## [0.1.4] — September 11, 2026

Online Manga, and a scroll-through-everything mode for the PDF reader

### Features

- **Online Manga** (Manga tab only — Books is untouched): a whole new mode alongside your existing local Manga Library, clearly separated from it. Automatically browse a large, constantly-updating catalog of old and new manga with latest-chapter updates, filterable by language (English, Spanish, Arabic, Japanese), genres/categories, status, and popularity, with search and sorting — explicit/adult content is excluded both by API request and by a local safety filter. Open and read chapters right in Xuro; follow manga to get a "new chapter" indicator without an account; keep reading history and favorites; resume exactly where you left off with per-manga progress and bookmarks; and download chapters for fully offline reading, stored inside your vault's existing Library folder (`Library/OnlineManga/…`) but never mixed into "Your library".
- PDF reader: a new toolbar toggle between "page by page" (the original single-page view, click or arrow-key through) and "all pages" — every page loads into one continuous, scrollable column, rendering lazily as you approach each page so even long PDFs stay smooth.

### Changed

- AGENTS.md: documented the two new backend modules (`manga_source.rs`, `manga_online.rs`) and the new frontend `onlineManga` store / `library/online/` components.

## [0.1.3] — September 10, 2026

A real fix for the native context menu, a richer reader, and a debug log

### Fixes

- Graph: the native OS/webview right-click menu showing up alongside Xuro's own is now blocked globally (once, at the app root) instead of per-component — the previous, narrower fix apparently wasn't catching every case.
- Library: items added from search (no file, just catalog metadata) can now have a file attached to them directly — "Attach file" replaces the missing Read button, and keeps the item's title/author/cover from the search result instead of creating a duplicate entry.
- Library: the saved-items grid ("Your library") no longer disappears behind the catalog search results — it stays visible, is clearly labeled separately from "Add from catalog", and filters alongside the same search box so you can tell at a glance what you already have.
- PDF reader: fixed a state-leak where reopening a different PDF right after closing one could carry over the previous file's page/zoom.

### Features

- Debug log: Xuro now keeps a local, timestamped record of unexpected errors — frontend JS errors, unhandled promise rejections, and Rust panics — viewable (and clearable) from Settings → Debug. Nothing in it is sent anywhere; it's purely local, for troubleshooting.
- PDF reader: a genuinely richer toolbar — fullscreen, fit-to-width, click-to-jump to a page, keyboard shortcuts (arrow keys, +/-, Esc), and an "open in default app" fallback both in the toolbar and on any load error.

### Changed

- Snippets: the Preview button now shows its label ("▶ Preview"), not just an icon, so it's not easy to miss on an HTML/CSS/JavaScript snippet's card.

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
