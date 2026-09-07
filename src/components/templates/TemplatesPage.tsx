import { FilePlus2, LayoutTemplate, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useTemplates } from "@/stores/templates";
import { activeDir, useVault } from "@/stores/vault";
import type { Template } from "@/lib/types";

export function TemplatesPage() {
  const { templates, loaded, load, add, update, remove } = useTemplates();
  const createNoteFromTemplate = useVault((s) => s.createNoteFromTemplate);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [load]);

  if (!loaded) return null;

  const useTemplate = (template: Template) => {
    const title = window.prompt(`New note title for "${template.title}"`, template.title);
    if (title === null) return;
    void createNoteFromTemplate(template.id, activeDir(useVault.getState()), title);
  };

  return (
    <div className="page-scroll">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-5 px-8 pb-24 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">
              Templates
            </h1>
            <p className="mt-1 text-[12px] text-faint">
              Reusable starting points for new notes. Use{" "}
              <code className="rounded bg-panel px-1 py-0.5 font-mono text-[10.5px]">
                {"{{title}}"}
              </code>
              ,{" "}
              <code className="rounded bg-panel px-1 py-0.5 font-mono text-[10.5px]">
                {"{{date}}"}
              </code>
              , and{" "}
              <code className="rounded bg-panel px-1 py-0.5 font-mono text-[10.5px]">
                {"{{time}}"}
              </code>{" "}
              — they're filled in when you create a note.
            </p>
          </div>
          {!creating && (
            <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
              <FilePlus2 size={13} strokeWidth={2} />
              New
            </Button>
          )}
        </div>

        {creating && (
          <TemplateForm
            onCancel={() => setCreating(false)}
            onSubmit={async (title, content) => {
              await add(title, content);
              setCreating(false);
            }}
          />
        )}

        {templates.length === 0 && !creating && (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <LayoutTemplate size={22} strokeWidth={1.5} className="text-faint" />
            <p className="text-[13px] text-muted">No templates yet</p>
            <p className="max-w-[300px] text-[11.5px] text-faint">
              Save a starting layout — meeting notes, a project brief — and reuse
              it for every new note of that kind.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          {templates.map((template) =>
            editingId === template.id ? (
              <TemplateForm
                key={template.id}
                initial={template}
                onCancel={() => setEditingId(null)}
                onSubmit={async (title, content) => {
                  await update(template.id, title, content);
                  setEditingId(null);
                }}
              />
            ) : (
              <TemplateCard
                key={template.id}
                template={template}
                onUse={() => useTemplate(template)}
                onEdit={() => setEditingId(template.id)}
                onDelete={() => void remove(template.id)}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onUse,
  onEdit,
  onDelete,
}: {
  template: Template;
  onUse: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-line-soft bg-panel p-3.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-ink">{template.title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button variant="outline" size="sm" onClick={onUse}>
            <FilePlus2 size={12.5} strokeWidth={1.8} />
            Use
          </Button>
          <button
            type="button"
            aria-label="Edit template"
            onClick={onEdit}
            className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-active hover:text-ink"
          >
            <Pencil size={13} strokeWidth={1.8} />
          </button>
          <button
            type="button"
            aria-label="Delete template"
            onClick={onDelete}
            className="grid h-7 w-7 place-items-center rounded-md text-faint transition-colors duration-100 hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 size={13} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <pre className="mt-2.5 max-h-40 overflow-auto rounded-lg bg-sunken px-3 py-2.5 font-mono text-[11.5px] leading-5 text-muted">
        {template.content}
      </pre>
    </div>
  );
}

function TemplateForm({
  initial,
  onCancel,
  onSubmit,
}: {
  initial?: Template;
  onCancel: () => void;
  onSubmit: (title: string, content: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(
    initial?.content ?? "# {{title}}\n\n",
  );
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      await onSubmit(title, content);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-2.5 rounded-xl border border-line-soft bg-panel p-3.5"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Template name (e.g. Meeting notes)"
        className="h-8 rounded-md border border-line bg-bg px-2.5 text-[12.5px] text-ink outline-none focus:border-ink"
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Write the template body…"
        rows={8}
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
