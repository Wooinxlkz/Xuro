import { Code2, Pencil, Play, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { CopyButton } from "@/components/ui/CopyButton";
import { useSnippets } from "@/stores/snippets";
import type { Snippet } from "@/lib/types";
import { COMMON_LANGUAGES, highlightCode } from "./highlight";
import { isPreviewable, SnippetPreview } from "./SnippetPreview";

export function SnippetsPage() {
  const { snippets, loaded, load, add, update, remove } = useSnippets();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return snippets;
    return snippets.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.language.toLowerCase().includes(q) ||
        s.content.toLowerCase().includes(q),
    );
  }, [snippets, query]);

  if (!loaded) return null;

  return (
    <div className="page-scroll">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-8 pb-24 pt-6">
        <div className="flex items-center justify-between">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">
            Snippets
          </h1>
          {!creating && (
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
              <Plus size={13} strokeWidth={2} />
              New
            </Button>
          )}
        </div>

        {snippets.length > 0 && (
          <div className="relative">
            <Search
              size={13}
              strokeWidth={2}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search snippets…"
              className="h-8 w-full rounded-md border border-line bg-panel pl-8 pr-2.5 text-[12.5px] text-ink outline-none focus:border-ink"
            />
          </div>
        )}

        {creating && (
          <SnippetForm
            onCancel={() => setCreating(false)}
            onSubmit={async (title, language, content) => {
              await add(title, language, content);
              setCreating(false);
            }}
          />
        )}

        {snippets.length === 0 && !creating && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <Code2 size={22} strokeWidth={1.5} className="text-faint" />
            <p className="text-[13px] text-muted">No snippets yet</p>
            <p className="max-w-[300px] text-[11.5px] text-faint">
              Save a bit of code or text you reuse often.
            </p>
          </div>
        )}

        {snippets.length > 0 && filtered.length === 0 && (
          <p className="py-8 text-center text-[12px] text-faint">
            No snippets match "{query}".
          </p>
        )}

        <div className="flex flex-col gap-2">
          {filtered.map((snippet) =>
            editingId === snippet.id ? (
              <SnippetForm
                key={snippet.id}
                initial={snippet}
                onCancel={() => setEditingId(null)}
                onSubmit={async (title, language, content) => {
                  await update(snippet.id, title, language, content);
                  setEditingId(null);
                }}
              />
            ) : (
              <SnippetCard
                key={snippet.id}
                snippet={snippet}
                onEdit={() => setEditingId(snippet.id)}
                onDelete={() => void remove(snippet.id)}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function SnippetCard({
  snippet,
  onEdit,
  onDelete,
}: {
  snippet: Snippet;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    highlightCode(snippet.content, snippet.language).then((result) => {
      if (!cancelled) setHtml(result);
    });
    return () => {
      cancelled = true;
    };
  }, [snippet.content, snippet.language]);

  return (
    <div className="rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">{snippet.title}</p>
          {snippet.language && (
            <p className="mt-0.5 text-[10.5px] text-faint">{snippet.language}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {isPreviewable(snippet.language) && (
            <button
              type="button"
              onClick={() => setPreviewing((p) => !p)}
              className={`flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors duration-100 ${
                previewing ? "bg-active text-ink" : "text-faint hover:bg-active hover:text-ink"
              }`}
            >
              <Play size={11.5} strokeWidth={2} />
              Preview
            </button>
          )}
          <CopyButton value={snippet.content} label="Copy snippet" />
          <button
            type="button"
            aria-label="Edit snippet"
            onClick={onEdit}
            className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-active hover:text-ink"
          >
            <Pencil size={13} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            aria-label="Delete snippet"
            onClick={onDelete}
            className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 size={13} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <pre className="mt-2.5 max-h-40 overflow-auto rounded-lg bg-sunken px-3 py-2.5 font-mono text-[11.5px] leading-5 text-muted">
        {html !== null ? (
          <code dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <code>{snippet.content}</code>
        )}
      </pre>
      {previewing && <SnippetPreview snippet={snippet} onClose={() => setPreviewing(false)} />}
    </div>
  );
}

function SnippetForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial?: Snippet;
  onCancel: () => void;
  onSubmit: (title: string, language: string, content: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [language, setLanguage] = useState(initial?.language ?? "");
  const [content, setContent] = useState(initial?.content ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    try {
      await onSubmit(title, language, content);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2.5 rounded-xl border border-line-soft bg-panel p-3.5"
    >
      <div className="flex gap-2">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="h-8 flex-1 rounded-md border border-line bg-bg px-2.5 text-[12.5px] text-ink outline-none focus:border-ink"
        />
        <input
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          placeholder="Language (optional)"
          list="snippet-languages"
          className="h-8 w-40 rounded-md border border-line bg-bg px-2.5 text-[12.5px] text-ink outline-none focus:border-ink"
        />
        <datalist id="snippet-languages">
          {COMMON_LANGUAGES.map((lang) => (
            <option key={lang} value={lang} />
          ))}
        </datalist>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Paste or write your snippet…"
        rows={6}
        className="resize-y rounded-md border border-line bg-bg px-2.5 py-2 font-mono text-[12px] leading-5 text-ink outline-none focus:border-ink"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
