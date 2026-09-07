# Contributing to Xuro

Thanks for considering a contribution. Xuro stays deliberately small and opinionated — please open an issue before starting on anything beyond a bug fix or a small, obviously-correct improvement, so we can agree on the approach before you spend time on it.

## Setup

Requirements: [Bun](https://bun.sh), [Rust](https://rustup.rs) with the `x86_64-pc-windows-msvc` target, and the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/) (Microsoft C++ Build Tools and the WebView2 runtime). Xuro is a Windows-only app; there is no macOS or Linux build target.

```bash
bun install
bun tauri dev
```

## Before opening a PR

```bash
bunx tsc --noEmit           # typecheck
bun test                    # frontend unit tests
cd src-tauri && cargo test  # Rust unit tests
```

All three must pass clean. There's no separate lint step — `tsc`, `bun test`, and `cargo test` are the gate. **Note:** this repo currently has no CI workflow running these automatically on push/PR (only the release build workflow exists under `.github/workflows/`) — run them locally before opening a PR.

## Code conventions

See [AGENTS.md](./AGENTS.md) for the full architecture guide, kept up to date for both human and AI contributors. The short version:

- **Rust owns the filesystem.** The frontend is UI + state only — all IO goes through typed Tauri commands in `src/lib/ipc.ts`.
- **One Rust module per concern**, each under ~300 lines, with its own unit tests. Don't collapse everything into `lib.rs`.
- **Monochrome by default.** Only the semantic tokens in `src/styles.css` (`bg`, `panel`, `ink`, `muted`, `faint`, `line`, `hover`, `invert`…). Never hardcode a color — `danger` is one exception for destructive actions, and the opt-in accent color (`--accent`, see `brand.md`) is the other, applied only to the small set of touchpoints already using it. New UI should default to fully monochrome.
- Keep motion subtle: 100–160ms ease-out, nothing bouncier.

## Commit messages

[Conventional commits](https://www.conventionalcommits.org/), subject line ≤50 chars where possible (`feat: ...`, `fix: ...`, `chore: ...`). Don't add `Co-Authored-By` or any AI attribution to commits or PRs.

## What we won't merge

- Sticky notes, note IDs, or a plugin/extension system — deliberately cut, see `AGENTS.md`.
- A new full re-theme or a decorative accent applied everywhere by default — personalization stays opt-in and scoped, not a redesign.
- Anything that adds required telemetry, analytics, or an account requirement to core (offline) note-taking. Xuro Cloud publishing and sync stay strictly optional.
- Changes that break the vault's plain-`.md`-files-on-disk guarantee, or that require migrating existing vaults without an explicit, reversible opt-in.

## Reporting bugs

Open an [issue](https://github.com/Wooinxlkz/Xuro/issues/new) with your Windows version, Xuro version (`Help → About`), and reproduction steps. If it's a vault or data issue, mention whether it reproduces with a fresh, empty vault folder — that narrows down "app bug" vs. "something specific to your notes" fast.

For anything that looks like a security issue rather than a regular bug, see [SECURITY.md](./SECURITY.md) instead of opening a public issue.
