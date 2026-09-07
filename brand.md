# Brand: Xuro

Xuro is a fast, local-first Markdown notes app for Windows, macOS, and Linux.

_Established 2026-07-12. Renamed from `brand.md`, expanded, and reconciled with the opt-in appearance system on 2026-08-27._

## Identity

- **Product name:** Xuro (always capitalized like a proper noun — not XURO, not xuro, in running text).
- **Wordmark & icon:** `public/logo.svg` and `src-tauri/icons/`. A rounded dark square containing a white folded-page mark.
- **One-line description:** "A fast, local-first Markdown notes app for Windows, macOS, and Linux."
- **Do not** use "Xuro," the wordmark, or the icon to identify a fork, a competing product, or anything that implies endorsement by this project — see the trademark note in [LICENSE](./LICENSE).

## Palette: Xuro Monochrome

**Vibe:** calm, premium, focused
**Category:** consumer productivity
**Mood:** calm and premium

Xuro's *default* palette uses warm neutral surfaces and typographic contrast instead of a brand accent. Color appears by default only when it communicates destructive state (`danger`).

Since v0.1.9, an accent color and a background tint are available as **opt-in personalization** under Settings → Appearance — they do not change this default. See [Personalization](#personalization-accent--background) below.

### Core seeds

| Role | Light | Dark |
| --- | --- | --- |
| Background | `#fbfbfa` | `#1a1a1a` |
| Panel | `#f4f4f2` | `#151515` |
| Recessed | `#e9e9e6` | `#0f0f0f` |
| Primary text | `#191919` | `#ebebe8` |
| Secondary text | `#6e6e6a` | `#8f8f8a` |
| Faint text | `#a3a39e` | `#64645f` |
| Border | `#e3e3e0` | `#292927` |
| Inverted surface | `#1c1c1c` | `#ebebe8` |
| Inverted text | `#fbfbfa` | `#131313` |
| Destructive | `#b3261e` | `#e5484d` |

### Semantic tokens

Use the tokens defined in `src/styles.css`:

- `bg`, `panel`, and `sunken` for the surface hierarchy.
- `ink`, `muted`, and `faint` for the text hierarchy.
- `line` and `line-soft` for separation.
- `hover` and `active` for interaction feedback.
- `invert` and `invert-ink` for selected rows and primary actions.
- `danger` only for destructive actions and failures.
- `accent` / `accent-indicator` — see below.

Never hardcode colors in components. New shadcn-style or custom components must use the compatibility mappings already defined in `src/styles.css`.

## Personalization: accent & background

Settings → Appearance lets a user opt into:

- **Accent color** — Blue, Green, Purple, Red, Orange, or a custom hex, applied to a **small, fixed set of touchpoints**: the active top-level nav item (Tasks, Bookmarks), the active tab, the editor caret and text-selection highlight, the active-note indicator in the sidebar tree, checked checkboxes/tasks, and nothing else. It is exposed as `--color-brand` (falls back to the monochrome `invert` token), `--color-accent-ink` (falls back to `ink` exactly, for text/icon/caret/selection touchpoints), and `--color-accent-indicator` (transparent unless an accent is chosen).
- **Background** — Default, Cream, or Soft, retinting `bg`/`panel`/`sunken`/`line` together in both light and dark mode via `[data-bg="…"]` on `<html>`.

Rules for extending this system:

- **"Default" must always be visually identical to having no accent/background system at all.** Never change a default CSS variable's value to add a personalization option — only add new variables/attribute-scoped overrides.
- Do not spend an accent on more than a handful of touchpoints. This is a personalization detail, not a re-theme — most of the UI stays monochrome regardless of the chosen accent.
- New "opt-in color" features should follow the same pattern: a CSS custom property with a monochrome fallback, applied via a `data-*` attribute on `<html>`, persisted through `config.rs` → Tauri command → the `vault` store, exactly like theme/accent/background today.

## Typography: Inter and JetBrains Mono

- **Interface and reading:** Inter Variable
- **Code, paths, shortcuts, and raw Markdown:** JetBrains Mono Variable

### Type hierarchy

| Role | Guidance |
| --- | --- |
| Product display | 64 px, weight 680, welcome screen only |
| Note title | 30 px, weight 680 |
| Editor H1 | 1.6 em, weight 620 |
| Editor H2 | 1.3 em, weight 580 |
| Editor H3 | 1.1 em, weight 560 |
| Editor H4 | 1 em, weight 550 |
| Reading text | 16 px, line-height 1.65 |
| Interface text | 12.5 to 14 px |
| Caption | 11 to 12 px, only when contrast remains readable |

Use tight tracking only for display and larger headings. Body copy stays neutral and comfortable.

## Shape and depth

- Buttons use medium corners.
- Cards and dialogs use large corners.
- The tab strip uses the recessed `sunken` surface.
- Selected rows use the inverted treatment when strong selection is needed, or the accent indicator when personalization is on.
- Prefer borders for structure. Reserve shadows for floating overlays.
- Keep all motion between 100 and 160 ms unless a shared spring controls it.

## Tone and voice

### Use

Write with calm confidence. Keep sentences short and specific. Describe what happened, where content lives, and what the user can do next.

Examples:

- "Plain Markdown notes. Yours, on disk."
- "Moved to Trash."
- "Note exported."
- "Choose a folder for your vault."

### Avoid

- Urgency, hype, or exaggerated claims.
- Words such as revolutionary, seamless, powerful, unlock, and effortless.
- Exclamation marks except for genuine warnings.
- Jokes inside errors or destructive confirmations.
- Audience labels in core product copy.

Marketing surfaces (`README.md`, `usexuro.app`) can be more direct about value than in-product copy, but should still stay factual — describe what the product actually does, not what a category of product usually claims to do.

## Accessibility

- Every interactive control must be keyboard reachable.
- Composite controls use arrow-key navigation.
- Every focusable control has a visible focus indicator using `ink` or `invert`, not the low-contrast `faint` token.
- Modals trap focus, close with Escape, and restore focus to their trigger.
- Icon-only controls require an accessible label.
- Motion respects reduced-motion preferences.
- Accent colors are chosen to keep sufficient contrast against `invert-ink`/`ink` for the specific elements they're applied to (see the preset lightness values in `src/styles.css`); a custom accent is the user's own choice and isn't contrast-checked.

## Do

- Preserve the monochrome default.
- Use spacing in 4 px increments where practical.
- Keep interface density compact but readable.
- Test every change in light and dark modes, and — for anything touching `--accent`/`--accent-indicator`/`data-bg` — with personalization on and off.
- Reuse existing primitives and motion tokens.

## Do not

- Add a decorative accent color that isn't opt-in and reversible to monochrome.
- Add gradients, glass effects, or heavy shadows.
- Mix icon libraries or stroke styles.
- Use long promotional copy inside the application itself (marketing surfaces are the exception, see Tone and voice).
- Use em dashes in in-app product copy.

_Last updated: 2026-08-27. Palette: Xuro Monochrome + opt-in accent/background. Typography: Inter and JetBrains Mono. Gradients: none._
