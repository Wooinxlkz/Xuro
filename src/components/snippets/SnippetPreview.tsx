import { X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Snippet } from "@/lib/types";

/** Languages the preview understands. Anything else (Python, Rust, plain
 * text, ...) has no meaningful way to "run" in a browser sandbox, so
 * `SnippetsPage` only offers the Preview button for these. */
const PREVIEWABLE = new Set(["html", "htm", "css", "javascript", "js", "p5", "p5js"]);

export function isPreviewable(language: string): boolean {
  return PREVIEWABLE.has(language.trim().toLowerCase());
}

const CONSOLE_SHIM = `
<div id="__xuro_console" style="position:fixed;left:0;right:0;bottom:0;max-height:35%;overflow:auto;
  font:11px/1.5 ui-monospace,monospace;background:rgba(0,0,0,.82);color:#d7d7d7;padding:6px 10px;display:none;"></div>
<script>
  (function () {
    var box = document.getElementById('__xuro_console');
    var real = console.log.bind(console);
    console.log = function () {
      box.style.display = 'block';
      var line = document.createElement('div');
      line.textContent = Array.prototype.slice.call(arguments)
        .map(function (a) { try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (e) { return String(a); } })
        .join(' ');
      box.appendChild(line);
      box.scrollTop = box.scrollHeight;
      real.apply(null, arguments);
    };
    window.onerror = function (message) {
      box.style.display = 'block';
      var line = document.createElement('div');
      line.style.color = '#ff8080';
      line.textContent = 'Error: ' + message;
      box.appendChild(line);
    };
  })();
</script>`;

async function buildDoc(snippet: Snippet): Promise<string> {
  const language = snippet.language.trim().toLowerCase();
  const code = snippet.content;

  if (language === "html" || language === "htm") {
    // Already a full document? Use it as-is (still sandboxed either way).
    // Otherwise treat it as a body fragment.
    return /<html[\s>]/i.test(code) ? code : `<!doctype html><html><body>${code}</body></html>`;
  }

  if (language === "css") {
    return `<!doctype html><html><head><style>${code}</style></head><body>
      <div style="padding:24px;font-family:system-ui,sans-serif;">
        <h1>Heading</h1>
        <p>A paragraph of body text, so this snippet's selectors have something ordinary to style.</p>
        <button>Button</button>
        <a href="#">A link</a>
        <div class="box" style="width:120px;height:80px;margin-top:12px;background:#8884;border:1px solid #8888;"></div>
      </div>
    </body></html>`;
  }

  // javascript / js / p5 / p5js — p5.js is bundled in for every one of
  // these rather than only when the code obviously looks like a sketch,
  // since detecting that reliably isn't worth the false negatives; an
  // ordinary script that never calls a p5 function is unaffected by the
  // library just sitting there unused.
  const p5Source = (await import("p5/lib/p5.min.js?raw")).default;
  return `<!doctype html><html><head><style>
      html,body{margin:0;background:#fff;}
    </style></head><body>
      <script>${p5Source}</script>
      ${CONSOLE_SHIM}
      <script>
        try {
          ${code}
        } catch (e) {
          console.log('Error: ' + (e && e.message ? e.message : e));
        }
      </script>
    </body></html>`;
}

export function SnippetPreview({ snippet, onClose }: { snippet: Snippet; onClose: () => void }) {
  const [srcDoc, setSrcDoc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrcDoc(null);
    void buildDoc(snippet).then((doc) => {
      if (!cancelled) setSrcDoc(doc);
    });
    return () => {
      cancelled = true;
    };
  }, [snippet]);

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-line-soft">
      <div className="flex items-center justify-between border-b border-line-soft bg-panel px-2.5 py-1.5">
        <p className="text-[10.5px] uppercase tracking-wide text-faint">Preview</p>
        <button
          type="button"
          onClick={onClose}
          className="grid h-5 w-5 place-items-center rounded text-faint hover:text-ink"
          aria-label="Close preview"
        >
          <X size={11} strokeWidth={2} />
        </button>
      </div>
      {srcDoc !== null ? (
        <iframe
          title={`${snippet.title} preview`}
          srcDoc={srcDoc}
          sandbox="allow-scripts"
          className="h-64 w-full bg-white"
        />
      ) : (
        <div className="grid h-64 place-items-center text-[11.5px] text-faint">Loading…</div>
      )}
    </div>
  );
}
