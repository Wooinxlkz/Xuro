/**
 * Thin, lazy-loading wrapper around highlight.js for snippet display.
 *
 * Uses `highlight.js/lib/core` plus a hand-picked set of common languages
 * instead of the full `highlight.js` package (which registers ~190
 * languages and is close to 1MB) — snippets realistically only need a
 * couple dozen. Loaded on demand (not imported at module scope anywhere
 * that's part of the always-loaded app shell) so it never costs anything
 * unless the Snippets page is actually opened.
 */

let corePromise: Promise<typeof import("highlight.js/lib/core").default> | null =
  null;

async function getCore() {
  if (!corePromise) {
    corePromise = (async () => {
      const { default: hljs } = await import("highlight.js/lib/core");
      const languages: Array<
        [string, () => Promise<{ default: unknown }>]
      > = [
        ["javascript", () => import("highlight.js/lib/languages/javascript")],
        ["typescript", () => import("highlight.js/lib/languages/typescript")],
        ["python", () => import("highlight.js/lib/languages/python")],
        ["rust", () => import("highlight.js/lib/languages/rust")],
        ["go", () => import("highlight.js/lib/languages/go")],
        ["java", () => import("highlight.js/lib/languages/java")],
        ["csharp", () => import("highlight.js/lib/languages/csharp")],
        ["c", () => import("highlight.js/lib/languages/c")],
        ["cpp", () => import("highlight.js/lib/languages/cpp")],
        ["ruby", () => import("highlight.js/lib/languages/ruby")],
        ["php", () => import("highlight.js/lib/languages/php")],
        ["swift", () => import("highlight.js/lib/languages/swift")],
        ["kotlin", () => import("highlight.js/lib/languages/kotlin")],
        ["bash", () => import("highlight.js/lib/languages/bash")],
        ["sql", () => import("highlight.js/lib/languages/sql")],
        ["json", () => import("highlight.js/lib/languages/json")],
        ["yaml", () => import("highlight.js/lib/languages/yaml")],
        ["xml", () => import("highlight.js/lib/languages/xml")],
        ["css", () => import("highlight.js/lib/languages/css")],
        ["markdown", () => import("highlight.js/lib/languages/markdown")],
        ["dockerfile", () => import("highlight.js/lib/languages/dockerfile")],
        ["graphql", () => import("highlight.js/lib/languages/graphql")],
      ];
      const modules = await Promise.all(languages.map(([, load]) => load()));
      languages.forEach(([name], i) => {
        hljs.registerLanguage(
          name,
          modules[i].default as Parameters<typeof hljs.registerLanguage>[1],
        );
      });
      return hljs;
    })();
  }
  return corePromise;
}

/** Common language names/aliases we register — used to build the <datalist>. */
export const COMMON_LANGUAGES = [
  "javascript",
  "typescript",
  "python",
  "rust",
  "go",
  "java",
  "csharp",
  "c",
  "cpp",
  "ruby",
  "php",
  "swift",
  "kotlin",
  "bash",
  "sql",
  "json",
  "yaml",
  "xml",
  "html",
  "css",
  "markdown",
  "dockerfile",
  "graphql",
];

/**
 * Highlight `code` for `language`, returning safe HTML (highlight.js
 * escapes the source itself). Falls back to auto-detection for an unknown
 * or empty language name, and to plain (unhighlighted, still-escaped) text
 * if even that fails.
 */
export async function highlightCode(
  code: string,
  language: string,
): Promise<string> {
  const hljs = await getCore();
  const lang = language.trim().toLowerCase();
  try {
    if (lang && hljs.getLanguage(lang)) {
      return hljs.highlight(code, { language: lang }).value;
    }
    return hljs.highlightAuto(code).value;
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
