# Xuro — agent guide

Local-first markdown notes app for Windows, macOS, and Linux. Tauri 2 (Rust) + React 19 + Vite + Tailwind v4 + Tiptap 3 + Zustand.

## Commands

- `bun tauri dev` — run the app (vite on port 1420 + cargo)
- `bun run build` — typecheck (tsc) + vite production build
- `bunx tsc --noEmit` — typecheck only
- `cd src-tauri && cargo test` — Rust unit tests
- `bun run build:windows`: local NSIS `.exe` build (`tauri build --bundles nsis`)
- `.github/workflows/release-windows.yml`: signed x86_64 NSIS installer release, triggered on `v*` tags

## Architecture

Rust owns the filesystem; the frontend is UI + state only. All IO goes through typed Tauri commands (`src/lib/ipc.ts` is the only file that touches `invoke`).

### Vault model

User picks any folder as a vault:

- `<vault>/` — plain `.md` files live directly in the selected vault root, filename = title, no IDs. Folders are real folders. `.excalidraw` files are also recognized tree entries (`NodeKind::Canvas`) — everything else non-`.md`/`.excalidraw` is invisible to the tree. `.xuro/` remains reserved app data. Portable plain-markdown. Frontmatter is optional: Xuro preserves external YAML and only authors flat properties after an explicit user action in the Properties UI.
- `<vault>/.xuro/` — app data: `todos.json`, `bookmarks.json`, `snippets.json`, `locks.json` (salted+hashed PINs, never plaintext), `assets/` (pasted images).
- Vault path + theme persist in the app config dir (`config.json`).

Notes are addressed by path relative to the vault root (e.g. `projects/app.md`), never by ID. Deletes go to OS trash. External edits are picked up on window focus (dirty editor wins).

### Rust (`src-tauri/src/`)

One module per concern, each with unit tests; keep files under ~300 lines:

- `error.rs` — `AppError`/`AppResult`, serialized as `{kind, message}` to the frontend
- `vault.rs` — layout, tree scan, rel-path resolution (rejects traversal)
- `notes.rs` — CRUD, rename/move with collision suffixing ("name 2"). Preserves the file's real extension on rename/move (`.md`, `.excalidraw`, …) — don't hardcode `"md"` here again, that was a real bug that silently corrupted canvas file extensions.
- `search.rs` — case-insensitive title+content search, title hits ranked first. Excludes locked/protected notes entirely via `locks::is_protected` — a search snippet would defeat a PIN lock.
- `tags.rs` — extracts inline `#tag` mentions (not Markdown headings) across the vault for the Tags page; same lock-exclusion as search.rs.
- `locks.rs` — PIN locks on notes/folders. The PIN is a salted SHA-256 verifier, never plaintext, gating what the UI shows; `vault_crypto.rs` is what actually encrypts a locked note's file content on disk (AES-256-GCM, per-vault key in the OS keychain) — `set_pin`/`remove_lock` transition a note's file between plaintext and ciphertext, and only do that transition on the very first lock/final unlock, never on a bare PIN change. `is_protected()` is ancestor-aware (locking a folder protects everything inside it, and its files are all individually encrypted too) — every full-vault scan (search, tags, backlinks) must pass entries through it. `notes::read_note`/`write_note` call into `vault_crypto` transparently, so every other caller (the editor, exports) never has to know or care whether a note happens to be locked.
- `vault_crypto.rs` — AES-256-GCM at-rest encryption backing `locks.rs`. The vault's master key is random, generated once, held in the OS keychain via the `keyring` crate — never derived from the PIN, never written to any vault file. Tests exercise the encrypt/decrypt logic against a fixed in-memory key (`#[cfg(test)]` short-circuits `vault_key`) rather than the real keychain, so `cargo test` never depends on a secret-service daemon or risks a macOS permission prompt.
- `canvas.rs` — Excalidraw canvases as real `.excalidraw` files under a `Canvases/` folder; uses `vault::resolve_rel` for the same path-traversal protection as notes. Deliberately not yet threaded through search/tags/backlinks — those specifically scan `.md` files today.
- `library.rs` — books/manga. Searched-and-added items are metadata-only (`cover_url` links to the remote catalog image, never downloaded); uploaded items copy the file into a `Library/` folder in the vault (same pattern as `Canvases/`) and set `file_rel` instead. `attach_file` gives an existing metadata-only item a file (via the shared `copy_into_library` helper `upload` also uses) without creating a duplicate entry — the fix for "added from search but can't read it". Book search hits Open Library, manga search hits Jikan with `sfw=true` plus a local genre/rating denylist as defense in depth — both keyless public APIs, called via `fetch_json_with_retry` (a short 12s-timeout client, one retry on a 5xx — both catalogs are known to occasionally bounce a request under load). `read_file_base64` hands an uploaded file's raw bytes to the frontend's in-app PDF reader over the normal command channel — deliberately not the Tauri asset protocol, to avoid any CSP/asset-scope changes. Like `canvas.rs`, not threaded through search/tags/backlinks. This is the *local* Manga/Books library only — the Manga tab's Online Manga system (below) is entirely separate.
- `manga_source.rs` — Online Manga's network client: MangaDex's free, keyless public API (browse/search, manga details, chapter feed, `/at-home` page URLs, genre tags). Content safety is enforced at the request level (`contentRating[]` never includes `erotica`/`pornographic`) *and* client-side (a tag denylist mirroring `library.rs`'s, in case a rating is ever wrong upstream). Stateless — no vault access, no persistence; `manga_online.rs` is the only caller.
- `manga_online.rs` — Online Manga's local state: follows (+ a rate-limited `check_updates` sweep, one request per followed manga with a small delay between each), reading progress, history, bookmarks, and offline chapter downloads — all in `.xuro/online_manga.json`. Downloaded chapter images live under the vault's existing `Library/OnlineManga/<manga>/<chapter>/` (reusing `library.rs`'s `LIBRARY_FOLDER` constant, nothing else), but are tracked in this module's own store and never merged into `library.json`/`LibraryItem` — Online Manga and the local Manga Library stay two clearly separate systems that happen to share a storage root.
- `debug_log.rs` — a local, timestamped log of unexpected errors (frontend JS errors/rejections via `debug_log_add`, Rust panics via a chained `std::panic::set_hook` installed in `lib.rs`'s `.setup()`). Stored in the OS app-config dir (outside any vault — errors can happen before one's open), capped at `MAX_ENTRIES`. Best-effort by design: a failed log write is swallowed, never surfaced as a second error on top of whatever actually happened.
- `graph.rs` — whole-vault link graph for the Graph view, reusing `backlink_links.rs`'s scanning. Every note ancestor folder becomes a `GraphFolder` (compound container node in the frontend, with a deterministic per-path `hue` and total descendant `noteCount`), and every `GraphNode` carries its immediate `folder`, `kind`, and filesystem `createdMs`/`modifiedMs`/`sizeBytes` so the frontend's right-click info panel needs no second round trip.
- `todos.rs` / `boards.rs` / `bookmarks.rs` / `snippets.rs` — JSON stores in `.xuro/`. `todos.rs`'s `in_progress` field (Kanban) is fully independent of `done` (the flat Tasks list's checkbox) — `toggle` never touches it, only `set_status` (the Kanban drag) does. Every `Todo` also carries a `board_id` (`boards.rs`'s `DEFAULT_BOARD_ID` for anything saved before boards existed); `boards.rs` owns board CRUD and reassigns a deleted board's todos onto the oldest remaining board rather than losing them.
- `link_meta.rs` — fetch page title / og:image / favicon (reqwest + scraper)
- `assets.rs` — save pasted images into `.xuro/assets/`
- `tray.rs` — system tray icon + right-click menu: pinned notes (via `pins::list`) for quick-open, then Open, then Exit. `refresh()` rebuilds the menu on vault switch and on pin/unpin; a pinned-note click emits `xuro:tray-open-note` (frontend listens in `App.tsx`) rather than calling back into the frontend directly.
- `commands.rs` — thin `#[tauri::command]` wrappers only; `lib.rs` — wiring only

Blocking dialogs (`blocking_pick_folder`) must run in async commands via `spawn_blocking` — on the main thread they deadlock the app.

### Frontend (`src/`)

- `stores/` — zustand: `vault` (tree, view, theme, recents; `setView`/`toggleExpanded`/`expandTo` all gate through `locks`), `tabs` (open note tabs; active = derived from `vault.view`), `todos`, `boards` (Kanban boards; `activeBoardId` selects which board `KanbanPage` filters todos by), `bookmarks`, `snippets`, `library` (saved items + search results/view mode for `LibraryPage`), `onlineManga` (Manga tab's Online Manga hub: browse filters/results, genres, follows, reading progress, history, bookmarks, downloads — entirely separate from `library`'s state), `locks` (also owns the shared PIN dialog's open/close state), `ui`
- `components/` — by feature: `layout/`, `tree/`, `editor/`, `todos/`, `bookmarks/`, `daily/`, `tags/`, `kanban/`, `snippets/`, `canvas/` (lazy-loaded — Excalidraw is heavy), `locks/`, `otp/` (third-party, used as pulled), `palette/`, `settings/`, `welcome/`, `ui/`. `library/online/` holds the Online Manga UI (`OnlineMangaHub`, `MangaDetailsPanel`, `MangaReader`) — `LibraryPage` only ever renders it behind the Manga tab's "Online Manga" sub-toggle, never for Books.
- `PdfReader` (`library/PdfReader.tsx`) has two reading modes: "page by page" (the original single-canvas view — arrow keys/click the toolbar to turn one page) and "all pages" (every page in one scrollable column, rendered lazily as they near the viewport via `IntersectionObserver`, tracked back to a page number for the toolbar indicator and last-read persistence). `MangaReader` (`library/online/MangaReader.tsx`) offers the same page/scroll toggle for manga chapters, independently implemented since chapters are page images over IPC rather than a single PDF.
- Editor: Tiptap with `contentType: "markdown"`; autosave debounced 500ms, flush on unmount; images stored as vault-relative paths, rendered via asset protocol
- Tabs: `NotesWorkspace` keeps one live editor per open tab, inactive panes hidden via `display:none` — tab switch is a CSS toggle, never a remount/re-parse. Keep it that way.
- Session: `lib/session.ts` persists per-vault UI layout (open tabs, active view, todo/bookmark tag filters) to localStorage keyed by vault root, restoring it on launch. Tag filters live in the `todos`/`bookmarks` stores (not component state) so they're subscribable.
- Page links: internal note links are plain markdown links whose href is a vault-relative note path (`[Title](projects/app.md)`). `lib/noteLinks.ts` converts href↔rel and rewrites `[[wiki]]`/`[[target|alias]]` syntax (on type + on load) into those markdown links; clicking one opens the note; `/link` slash command + `NoteLinkPicker` also insert them.
- Frontmatter: `lib/frontmatter.ts` splits a leading `---` YAML block off the body on load and re-attaches it on save. `NoteProperties` can add, edit, and remove flat text or list properties while preserving unrelated YAML. The editor body never contains the raw YAML.

## UI conventions

- Strict monochrome: only the semantic tokens in `styles.css` (`bg`, `panel`, `sunken`, `ink`, `muted`, `faint`, `line`, `hover`, `active`, `invert`…). `sunken` is the recessed surface (tab strip), darker than `panel`. Never hardcode colors; `danger` is the sole exception, for destructive actions.
- Dark mode = `.dark` class on `<html>`; themes: system/light/dark.
- Active/selected rows use inverted style (`bg-invert text-invert-ink`) — the signature look.
- Motion: 100–160ms ease-out only. Fonts: Inter Variable (UI), JetBrains Mono (code).
- No autocorrect anywhere: global `focusin` hook in `main.tsx` handles inputs; editor sets its own attrs.
- The native OS/webview context menu is blocked once, globally, in `main.tsx` (`document.addEventListener("contextmenu", ...)`) — don't re-add per-component `onContextMenu` prevention for new right-click menus, it's redundant; a component-scoped attempt on the Graph view previously wasn't reliably catching it.
- Global error capture (`lib/debugLog.ts`, installed in `main.tsx`) feeds `debug_log.rs` — `window.onerror`/`unhandledrejection` plus `ErrorBoundary.componentDidCatch` all route through it. `ipc.debugLogAdd` failures are swallowed on purpose (never let diagnostics logging itself surface as a second error).

## Adding shadcn-style components

The frontend has a compatibility layer so third-party shadcn-style components inherit our monochrome theme unchanged, without any manual re-theming:

- `src/lib/utils.ts` exports `cn()` (clsx + tailwind-merge) — what shadcn-style component files import. Our own components use `cx()`.
- `src/lib/ease.ts` — shared motion tokens (`SPRING_PANEL`, `EASE_OUT`, …). `styles.css` mirrors `--ease-out` and defines the `.press` utility.
- `styles.css` maps shadcn semantic tokens (`--color-background`, `--color-foreground`, `--color-card`, `--color-border`, `--color-muted-foreground`, `--color-destructive`, `--color-border-strong`, …) onto our palette, so `bg-background`, `border-border`, `text-muted-foreground` etc. resolve to our monochrome look in both themes.
- Add a component with the shadcn CLI (`bunx --bun shadcn add <registry-or-slug>`), then write it under `src/components/…`. Shared files (`lib/ease.ts`, `lib/utils.ts`) already exist — don't overwrite them.

Our `Modal` (`components/ui/Modal.tsx`) is built on the same tokens; keep new dialogs on it for one motion language.

Third-party feature components (not layout primitives) get their own folder under `src/components/`, e.g. `otp/OTPInput.tsx` for the six-digit cloud sign-in code — used as pulled, not hand-modified, so future updates from the source stay a clean drop-in.

## Rules

- Never add "Co-Authored-By" or any AI attribution to commits or PRs.
- Commit messages: conventional commits, subject ≤50 chars where possible.
- Don't reintroduce: sticky notes, note IDs, plugin-fs. Never add frontmatter automatically; only explicit actions in the Properties UI may author it. `[[wiki]]` is accepted as input but stored as standard markdown `[title](path.md)` links.
