import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Bold,
  Download,
  FileDown,
  Heading1,
  Heading2,
  Italic,
  List,
  ListOrdered,
  Loader2,
  Plus,
  Quote,
  Redo2,
  Strikethrough,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
} from "lucide-react";
import { Markdown } from "@tiptap/markdown";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import Underline from "@tiptap/extension-underline";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import type { StudioChapter } from "@/lib/types";
import { cx } from "@/lib/utils";
import { useStudio } from "@/stores/studio";

/** Inkwell's prose mode: a chapter list on the left, a single Tiptap
 * editor for whichever chapter is selected, and a toolbar above it. Each
 * chapter's content is Markdown (same content model the Notes editor
 * already uses), so exporting it is just handing that string to a file —
 * nothing Inkwell-specific to serialize. */
export function StudioEditor({ onClose }: { onClose: () => void }) {
  const project = useStudio((s) => s.activeProject);
  const activeChapterId = useStudio((s) => s.activeChapterId);
  const selectChapter = useStudio((s) => s.selectChapter);
  const addChapter = useStudio((s) => s.addChapter);
  const deleteChapter = useStudio((s) => s.deleteChapter);
  const reorderChapters = useStudio((s) => s.reorderChapters);
  const renameProject = useStudio((s) => s.renameProject);

  const [exporting, setExporting] = useState(false);

  if (!project) return null;
  const chapter = project.chapters.find((c) => c.id === activeChapterId) ?? project.chapters[0];
  const totalWords = project.chapters.reduce((sum, c) => sum + c.wordCount, 0);

  const moveChapter = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= project.chapters.length) return;
    const ids = project.chapters.map((c) => c.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void reorderChapters(ids);
  };

  const exportAs = async (format: "md" | "txt" | "pdf") => {
    setExporting(true);
    try {
      if (format === "pdf") {
        toast.info("Exporting to PDF can take a moment for longer projects…");
        const html2pdf = (await import("html2pdf.js")).default;
        const wrapper = document.createElement("div");
        wrapper.style.cssText =
          "position:fixed;top:0;left:-10000px;width:780px;background:#fff;color:#1a1a1a;padding:56px;font-family:ui-sans-serif,system-ui,sans-serif;font-size:14px;line-height:1.7;";
        const title = document.createElement("h1");
        title.textContent = project.title;
        title.style.cssText = "font-size:28px;font-weight:700;margin:0 0 32px;";
        wrapper.appendChild(title);
        for (const c of project.chapters) {
          const heading = document.createElement("h2");
          heading.textContent = c.title;
          heading.style.cssText = "font-size:19px;font-weight:600;margin:32px 0 12px;";
          const body = document.createElement("div");
          body.innerHTML = c.content
            ? markdownToRoughHtml(c.content)
            : "<p style='color:#999'>(empty chapter)</p>";
          wrapper.appendChild(heading);
          wrapper.appendChild(body);
        }
        document.body.appendChild(wrapper);
        try {
          const arrayBuffer = (await html2pdf()
            .set({
              margin: 0,
              image: { type: "jpeg", quality: 0.95 },
              html2canvas: { scale: 2, backgroundColor: "#ffffff", useCORS: true },
              jsPDF: { unit: "pt", format: "a4", orientation: "portrait" },
            })
            .from(wrapper)
            .outputPdf("arraybuffer")) as ArrayBuffer;
          const base64 = arrayBufferToBase64(arrayBuffer);
          const { ipc } = await import("@/lib/ipc");
          const saved = await ipc.studioExportPdf(project.title, base64);
          if (saved) toast.success("Exported");
        } finally {
          wrapper.remove();
        }
      } else {
        const text =
          format === "md"
            ? project.chapters.map((c) => `# ${c.title}\n\n${c.content}`).join("\n\n---\n\n")
            : project.chapters.map((c) => `${c.title}\n\n${stripMarkdown(c.content)}`).join("\n\n\n");
        const { ipc } = await import("@/lib/ipc");
        const saved = await ipc.studioExportText(project.title, format, text);
        if (saved) toast.success("Exported");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex h-full">
      <div className="flex w-[240px] shrink-0 flex-col border-r border-line-soft bg-panel">
        <div className="flex items-center gap-1.5 border-b border-line-soft px-3 py-2.5">
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-faint hover:bg-hover hover:text-ink"
            aria-label="Back to projects"
          >
            <ArrowLeft size={14} strokeWidth={1.8} />
          </button>
          <input
            defaultValue={project.title}
            onBlur={(e) => {
              if (e.target.value.trim() && e.target.value.trim() !== project.title) {
                void renameProject(project.id, e.target.value);
              }
            }}
            className="min-w-0 flex-1 truncate bg-transparent text-[13px] font-medium text-ink outline-none"
          />
        </div>

        <div className="flex-1 overflow-auto p-1.5">
          {project.chapters.map((c, i) => (
            <div
              key={c.id}
              className={cx(
                "group flex items-center gap-1 rounded-md px-2 py-1.5",
                c.id === chapter?.id ? "bg-active" : "hover:bg-hover",
              )}
            >
              <button
                type="button"
                onClick={() => selectChapter(c.id)}
                className="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink"
              >
                {c.title || "Untitled chapter"}
              </button>
              <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                <button
                  type="button"
                  onClick={() => moveChapter(i, -1)}
                  disabled={i === 0}
                  className="grid h-5 w-5 place-items-center rounded text-faint hover:text-ink disabled:opacity-30"
                >
                  <ArrowUp size={11} strokeWidth={2} />
                </button>
                <button
                  type="button"
                  onClick={() => moveChapter(i, 1)}
                  disabled={i === project.chapters.length - 1}
                  className="grid h-5 w-5 place-items-center rounded text-faint hover:text-ink disabled:opacity-30"
                >
                  <ArrowDown size={11} strokeWidth={2} />
                </button>
                {project.chapters.length > 1 && (
                  <button
                    type="button"
                    onClick={() => void deleteChapter(c.id)}
                    className="grid h-5 w-5 place-items-center rounded text-faint hover:text-danger"
                  >
                    <Trash2 size={11} strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => void addChapter()}
            className="mt-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] text-faint hover:bg-hover hover:text-ink"
          >
            <Plus size={12} strokeWidth={2} />
            Add chapter
          </button>
        </div>

        <div className="border-t border-line-soft px-3 py-2 text-[10.5px] text-faint">
          {totalWords.toLocaleString()} words total
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {chapter && <ChapterToolbar chapter={chapter} exporting={exporting} onExport={exportAs} />}
        {chapter ? (
          <ChapterBody key={chapter.id} chapter={chapter} />
        ) : (
          <div className="flex flex-1 items-center justify-center text-[12.5px] text-faint">
            Add a chapter to start writing.
          </div>
        )}
      </div>
    </div>
  );
}

function ChapterToolbar({
  chapter,
  exporting,
  onExport,
}: {
  chapter: StudioChapter;
  exporting: boolean;
  onExport: (format: "md" | "txt" | "pdf") => void;
}) {
  const [exportOpen, setExportOpen] = useState(false);
  return (
    <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-2">
      <p className="text-[11px] text-faint">{chapter.wordCount.toLocaleString()} words</p>
      <div className="relative">
        <Button size="sm" variant="secondary" loading={exporting} onClick={() => setExportOpen((v) => !v)}>
          <Download size={12.5} strokeWidth={1.8} />
          Export
        </Button>
        {exportOpen && (
          <div className="absolute right-0 z-10 mt-1 min-w-[160px] rounded-lg border border-line-soft bg-panel p-1 shadow-md shadow-black/10">
            {[
              { key: "md" as const, label: "Markdown (.md)" },
              { key: "txt" as const, label: "Plain text (.txt)" },
              { key: "pdf" as const, label: "PDF (whole project)" },
            ].map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  setExportOpen(false);
                  onExport(opt.key);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[12px] text-ink hover:bg-hover"
              >
                <FileDown size={12} strokeWidth={1.8} />
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChapterBody({ chapter }: { chapter: StudioChapter }) {
  const updateChapter = useStudio((s) => s.updateChapter);
  const [title, setTitle] = useState(chapter.title);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor(
    {
      content: chapter.content,
      contentType: "markdown",
      extensions: [
        StarterKit,
        Underline,
        Typography,
        Markdown,
        Placeholder.configure({ placeholder: "Start writing…" }),
      ],
      editorProps: {
        attributes: {
          class: "prose-note studio-prose",
          spellCheck: "true",
        },
      },
      onUpdate: ({ editor: current }) => {
        scheduleSave(current.getMarkdown(), current.getText());
      },
    },
    [chapter.id],
  );

  const scheduleSave = (content: string, plainText: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      setSaving(true);
      const wordCount = plainText.trim() ? plainText.trim().split(/\s+/).length : 0;
      void updateChapter(chapter.id, title, content, wordCount).finally(() => setSaving(false));
    }, 700);
  };

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const commitTitle = () => {
    if (!editor) return;
    const wordCount = chapter.wordCount;
    void updateChapter(chapter.id, title, editor.getMarkdown(), wordCount);
  };

  return (
    <div className="flex flex-1 flex-col overflow-auto">
      <div className="mx-auto w-full max-w-[720px] px-8 pt-8">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commitTitle}
          placeholder="Chapter title"
          className="w-full bg-transparent text-[22px] font-semibold text-ink outline-none placeholder:text-faint"
        />
        {editor && (
          <div className="mt-3 flex items-center gap-0.5 border-b border-line-soft pb-2">
            <ToolbarButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")}>
              <Bold size={13} strokeWidth={2} />
            </ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")}>
              <Italic size={13} strokeWidth={2} />
            </ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")}>
              <UnderlineIcon size={13} strokeWidth={2} />
            </ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")}>
              <Strikethrough size={13} strokeWidth={2} />
            </ToolbarButton>
            <div className="mx-1 h-4 w-px bg-line-soft" />
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
              active={editor.isActive("heading", { level: 1 })}
            >
              <Heading1 size={13} strokeWidth={2} />
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
              active={editor.isActive("heading", { level: 2 })}
            >
              <Heading2 size={13} strokeWidth={2} />
            </ToolbarButton>
            <div className="mx-1 h-4 w-px bg-line-soft" />
            <ToolbarButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")}>
              <List size={13} strokeWidth={2} />
            </ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")}>
              <ListOrdered size={13} strokeWidth={2} />
            </ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive("blockquote")}>
              <Quote size={13} strokeWidth={2} />
            </ToolbarButton>
            <div className="mx-1 h-4 w-px bg-line-soft" />
            <ToolbarButton onClick={() => editor.chain().focus().undo().run()}>
              <Undo2 size={13} strokeWidth={2} />
            </ToolbarButton>
            <ToolbarButton onClick={() => editor.chain().focus().redo().run()}>
              <Redo2 size={13} strokeWidth={2} />
            </ToolbarButton>
            {saving && <Loader2 size={12} className="ml-auto animate-spin text-faint" />}
          </div>
        )}
      </div>
      <div className="mx-auto w-full max-w-[720px] flex-1 px-8 pb-24 pt-4">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

function ToolbarButton({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "grid h-7 w-7 place-items-center rounded-md transition-colors duration-100",
        active ? "bg-active text-ink" : "text-faint hover:bg-hover hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** Very rough Markdown → HTML for the PDF export path only — bold/italic/
 * headings/paragraphs, nothing fancier. Good enough for a printed page;
 * the Markdown/plain-text exports carry the real, exact content. */
function markdownToRoughHtml(markdown: string): string {
  const escaped = markdown
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const withInline = escaped
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
  return withInline
    .split(/\n{2,}/)
    .map((block) => `<p>${block.replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

function stripMarkdown(markdown: string): string {
  return markdown.replace(/[*_#>`]/g, "");
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
