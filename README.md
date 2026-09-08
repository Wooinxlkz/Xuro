<div align="center">

# Xuro

**A fast, local-first Markdown notes app for Windows, macOS, and Linux.**

Your notes are plain `.md` files, on your disk, forever. No accounts required, no lock-in, no proprietary format — just a fast editor and a folder you control.

[![Latest release](https://img.shields.io/github/v/release/Wooinxlkz/Xuro?label=release)](https://github.com/Wooinxlkz/Xuro/releases/latest)
[![License: Source-available](https://img.shields.io/badge/license-source--available-informational.svg)](./LICENSE)

[Download](https://github.com/Wooinxlkz/Xuro/releases/latest) · [usexuro.app](https://usexuro.app) · [Changelog](https://usexuro.app/changelog) · [Report a bug](https://github.com/Wooinxlkz/Xuro/issues/new)

<!--
  Add a real screenshot or a short GIF of the app here before shipping — this
  is what sells the app on GitHub and in the README. Suggested path:
  docs/preview.png (or .gif), then:
  ![Xuro screenshot](docs/preview.png)
-->

</div>

---

## Why Xuro

Most note apps want to own your writing — a database you can't read, an account you can't export, a subscription you can't cancel without losing your notes. Xuro is the opposite bet: your vault is a folder of plain Markdown files that you choose, that any editor can open, and that will still be readable in ten years whether or not Xuro exists.

On top of that, it's fast. Every action — opening a note, searching, switching folders — is built to feel instant, not "loading spinner" instant.

## Features

- **WYSIWYG Markdown editor** — write in a rich editor, saved as clean Markdown on disk. No mode-switching between "write" and "preview."
- **Real folders** — organize notes in actual, file-manager-visible folders and subfolders. Nothing lives in a hidden database.
- **Instant search & command palette** — `Ctrl/Cmd+K` jumps to any note, folder, or page in milliseconds, ranked by title and content.
- **Tasks** — a standalone task list with tags and filtering, separate from your notes but just as fast.
- **Bookmarks** — save links with an auto-fetched title, preview image, and favicon.
- **Text & highlight colors** — 5 curated presets plus a 6th custom swatch backed by your OS color picker.
- **Personalized appearance** — light, dark, or system theme (with a one-click toggle right in the sidebar), an optional accent color that touches the caret, selection, tabs, and active navigation, and a choice of background tint (default, cream, or soft) — all opt-in, all reversible to the default monochrome look in one click.
- **System tray icon** — right-click for your pinned notes plus Open/Exit, left-click to bring Xuro to the front.
- **PIN locks** — protect any note or folder with a PIN from the right-click menu. Locked content is hidden everywhere in the app, including search, until unlocked; a forgotten PIN can be reset from Settings.
- **Daily Notes, Tags, Kanban, Snippets** — a calendar for daily notes, a browser for inline `#tags`, multiple drag-and-drop Kanban boards (create as many as you need, rename each one inline), and a searchable, syntax-highlighted page for reusable text/code snippets.
- **Note Templates** — reusable starting content for new notes, with `{{title}}`, `{{date}}`, and `{{time}}` placeholders filled in automatically.
- **LaTeX/math rendering** — inline `$math$` and block `$$math$$` render live via KaTeX, stored as plain text in your Markdown, no proprietary format.
- **Export to PDF** — exports the note exactly as shown in the editor, math and tables and images included.
- **Import from Obsidian** — bring an existing Obsidian vault's notes and images in, with `[[wikilinks]]` and embeds converted automatically. Never overwrites an existing import.
- **Graph view** — a visual map of how your notes connect through links, grouped by folder like a workflow diagram: each folder gets a slight color tint, can be collapsed or expanded with a click, and right-clicking a note or folder shows its path, dates, size, and note count.
- **Library** — a personal books/manga shelf with list, grid, and bento views. Search and add from free public catalogs (Open Library for books, Jikan for manga, both filtered for explicit content), or upload your own PDF/EPUB/CBZ/CBR file — uploads are copied into a `Library/` folder inside your vault, so they're backed up and synced with everything else. Uploaded files currently open in your system's default viewer; a fully in-app reader is planned.
- **Zen mode** — hide all chrome for distraction-free writing.
- **Canvas** — draw and diagram with a built-in Excalidraw canvas, saved as a real `.excalidraw` file in your vault.
- **Publish with Xuro Cloud** *(optional, paid)* — publish a note together with its linked pages and images as one connected, readable site at your own shareable link. Nothing is uploaded unless you explicitly publish it.
- **Portable, always** — plain files, no note IDs, no required metadata, no lock-in. Point Xuro at any folder and you have a vault.

## Install

Download the latest build for your platform from the [GitHub releases page](https://github.com/Wooinxlkz/Xuro/releases/latest) or from [usexuro.app](https://usexuro.app):

```
Xuro_<version>_x64-setup.exe    # Windows
Xuro_<version>_x64.dmg          # macOS
Xuro_<version>_amd64.deb        # Linux (Debian/Ubuntu)
Xuro_<version>_amd64.AppImage   # Linux (portable)
```

On Windows, Xuro ships as a custom-branded NSIS installer built with Tauri. By default it installs system-wide to `C:\Program Files\Xuro\` and will prompt for administrator permission (`installMode: "perMachine"`). New builds for all three platforms are published automatically by the **Release Xuro** GitHub Actions workflow whenever a `vX.Y.Z` tag is pushed — see [`.github/workflows`](./.github/workflows).

The app checks GitHub for new releases and, when one's available, offers a one-click download of the installer — you run it to update.

## The vault model

Pick any folder on disk as your vault:

```
<vault>/
├── Notes/          default landing folder for new notes
├── Note.md         plain .md files anywhere in the vault, filename is the title
├── projects/       real folders containing more notes
└── .xuro/          app data: todos, boards, bookmarks, tags, pasted images
```

`Notes/` is created automatically and is just a normal folder — it's where a new note lands when nothing else is selected, purely to keep the vault root tidy. You're free to file notes anywhere; nothing enforces it.

Notes are addressed by path, never by an internal ID. Deletes go to the OS trash, not a void. Edit notes externally with any editor — Xuro picks up changes the moment the window regains focus.

## Building from source

Requirements: [Bun](https://bun.sh), [Rust](https://rustup.rs), and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (on Windows: Microsoft C++ Build Tools and the WebView2 runtime; on Linux: the WebKitGTK/build packages the prerequisites page lists for your distro; macOS needs Xcode Command Line Tools).

```bash
bun install
bun tauri dev        # run the app locally
```

Build a release installer for your platform:

```bash
bun run build:windows   # NSIS .exe, under src-tauri/target/release/bundle/nsis/
bun run build:mac       # .app / .dmg, under src-tauri/target/release/bundle/
bun run build:linux     # .deb / .AppImage, under src-tauri/target/release/bundle/
```

See [AGENTS.md](./AGENTS.md) for the architecture guide, [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR, and [brand.md](./brand.md) for the design system.

## Data & privacy

- Notes are stored locally as files you own, in a folder you chose.
- No analytics, tracking, or note-content uploads — nothing leaves your machine unless you explicitly use Xuro Cloud publishing.
- Saving a bookmark fetches that page's title, preview image, and favicon from the source URL.
- PIN locks are a real encryption boundary, not just a UI hide: locking a note or folder encrypts its file content on disk with AES-256-GCM, using a per-vault key held in your OS keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux) — never written to disk in plain text. The PIN itself stays a separate, in-app access gate (a salted hash, never the encryption key), so a forgotten PIN can be reset from Settings without losing the note. Locked content is still hidden throughout Xuro's UI, including search, on top of now actually being unreadable at the file level too.
- Publishing a note with Xuro Cloud uploads only that note (and anything it links to that you also choose to publish) to a shareable page; unpublishing removes it. Locked notes can't be published while locked.
- The app checks GitHub Releases for available updates — no separate update server to trust. See [SECURITY.md](./SECURITY.md) for how to report a vulnerability.
- Your notes are already just files — export is just copying a folder.

## Status

Xuro is under active development. See the [changelog](https://usexuro.app/changelog) for what shipped recently, and [open an issue](https://github.com/Wooinxlkz/Xuro/issues) for bugs or feature requests.

## License

[Source-available, no redistribution](./LICENSE) — you're free to download and use the official builds, and to read, fork, and contribute back to the source. Redistributing the source or a compiled build, or any commercial use, needs prior written permission. "Xuro," its wordmark, and its logo are not covered by any permission granted in the license — see [LICENSE](./LICENSE) for the full terms.

---

<div align="center">

**Xuro** — write at the speed of thought.

</div>
