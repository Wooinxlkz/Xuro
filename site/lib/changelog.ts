export type ChangelogEntry = {
  version: string;
  date: string;
  displayDate: string;
  title: string;
  summary: string;
  changes: string[];
  releaseUrl?: string;
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: "0.1.1",
    date: "2026-09-08",
    displayDate: "September 8, 2026",
    title: "Real vault encryption, and a Library",
    summary:
      "Locking a note or folder now actually encrypts it on disk with AES-256-GCM, keyed from your OS keychain — plus a new Library for books and manga.",
    changes: [
      "PIN locks are now a real encryption boundary, not just a UI hide: locking a note or folder encrypts its file content on disk with AES-256-GCM, using a per-vault key held in your OS keychain (Keychain on macOS, Credential Manager on Windows, Secret Service on Linux) — never written to disk in plain text, and never derived from the PIN itself, so a forgotten PIN can be reset from Settings without losing the note.",
      "Fixed 9 dependency vulnerabilities (2 high, 7 moderate) flagged by npm audit, all transitive through the Graph canvas's Mermaid-diagram support.",
      "Hardened the Xuro Cloud OTP verification to compare codes in constant time.",
      "Removed unused, half-wired signed-update-manifest tooling that nothing in the app actually consumed.",
      "Added Library — a personal books/manga shelf with list, grid, and bento views. Search and add from free public catalogs (Open Library for books, Jikan for manga), both filtered against explicit content, or upload your own PDF/EPUB/CBZ/CBR into a Library folder inside your vault.",
      "Normalized the GitHub repo reference casing across the update checker, website, and release scripts.",
    ],
    releaseUrl: "https://github.com/Wooinxlkz/Xuro/releases/tag/v0.1.1",
  },
  {
    version: "0.1.0",
    date: "2026-09-07",
    displayDate: "September 7, 2026",
    title: "Xuro, from the ground up",
    summary:
      "Xuro's versioning restarts here — a fresh baseline folding in everything built so far, plus a folder-aware Graph view and multiple Kanban boards.",
    changes: [
      "Keep every note as a plain Markdown file in a folder you choose, in a focused rich-text editor that preserves portable Markdown.",
      "Organize notes with real folders, search, tabs, and a Markdown source view via CodeMirror.",
      "Capture a thought from anywhere with the global Quick Capture window, and jump straight to today's Daily Note.",
      "See backlinks and linked mentions with context in a dedicated sidebar; pin important notes and folders above the regular tree.",
      "Add and edit typed note properties inline, including clickable URL properties, without hand-writing YAML.",
      "Apply text and highlight colors — five presets plus a sixth, fully custom color backed by the OS color picker.",
      "Find and replace text inside a note without leaving the editor; customize keyboard shortcuts throughout.",
      "Add Note Templates — reusable starting content with {{title}}, {{date}}, and {{time}} placeholders, insertable into a brand-new note or the one you already have open.",
      "Render LaTeX/math live in the editor via KaTeX — inline $math$ and block $$math$$, stored as plain text.",
      "Export a note to PDF exactly as shown in the editor, including math, tables, and images.",
      "Import an entire Obsidian vault — notes, image attachments, converted embeds, and working [[wikilinks]] — without ever overwriting an existing import.",
      "Add PIN locks for notes and folders — protected content is hidden everywhere, including search, until unlocked, with a recovery path from Settings.",
      "Add a Tags page for browsing notes by inline #tag with no frontmatter required.",
      "Add Snippets for quick reusable text and code, with search/filter, language autocomplete, and real syntax highlighting.",
      "Add a real Excalidraw canvas, saved as a normal .excalidraw file right in your vault.",
      "Add a Graph view, now folder-aware: notes are grouped inside their containing folder like a workflow diagram, each folder gets a slight, deterministic color tint, folders can be collapsed or expanded with a click, and right-clicking a note or folder opens an info panel with path, dates, size, and note count.",
      "Add multiple Kanban boards — create as many as you need, switch between them with tabs, and rename any board's title inline.",
      "Add Zen mode for distraction-free writing (⌘/Ctrl+Shift+Z, or Esc to exit).",
      "Add an optional accent color (five presets plus a custom picker) and a background tint (Default, Cream, Soft), with a one-click light/dark toggle in the sidebar.",
      "Publish a note together with its linked pages and images as one connected site, and read published notes with matching typography and automatic light/dark mode.",
      "Subscribe to Xuro Cloud from the website or desktop app and manage billing in Settings, with a proper segmented six-digit sign-in code.",
      "Add a system tray icon that lists pinned notes for one-click opening.",
      "Add an About tab in Settings with version, feature overview, credits, and sharing shortcuts.",
      "Ship a custom-branded NSIS installer for Windows, and a Developer ID signed, Apple-notarized release for macOS.",
    ],
    releaseUrl: "https://github.com/Wooinxlkz/Xuro/releases/tag/v0.1.0",
  },
];
