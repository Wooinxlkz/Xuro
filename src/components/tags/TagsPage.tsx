import { listen } from "@tauri-apps/api/event";
import { FileText, Hash } from "lucide-react";
import { useEffect, useState } from "react";
import { ipc } from "@/lib/ipc";
import type { TagEntry } from "@/lib/types";
import { cx } from "@/lib/utils";
import { useVault } from "@/stores/vault";

export function TagsPage() {
  const [tags, setTags] = useState<TagEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const setView = useVault((s) => s.setView);

  const load = async () => {
    try {
      const next = await ipc.listTags();
      setTags(next);
      setSelected((current) =>
        current && next.some((t) => t.tag === current) ? current : (next[0]?.tag ?? null),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void listen("xuro:notes-changed", () => void load()).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const activeEntry = tags.find((t) => t.tag === selected) ?? null;

  if (!loading && tags.length === 0) {
    return (
      <div className="page-scroll">
        <div className="mx-auto flex w-full max-w-[640px] flex-col items-center gap-2 px-8 pb-24 pt-24 text-center">
          <Hash size={22} strokeWidth={1.5} className="text-faint" />
          <p className="text-[13px] text-muted">No tags yet</p>
          <p className="max-w-[320px] text-[11.5px] text-faint">
            Write <span className="font-mono">#a-tag</span> anywhere in a note
            and it'll show up here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <div className="w-[220px] shrink-0 overflow-y-auto border-r border-line-soft px-2 py-3">
        <h1 className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
          Tags
        </h1>
        <div className="flex flex-col gap-0.5">
          {tags.map((entry) => (
            <button
              key={entry.tag}
              type="button"
              onClick={() => setSelected(entry.tag)}
              className={cx(
                "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[12.5px] transition-colors duration-100",
                entry.tag === selected
                  ? "bg-active text-ink"
                  : "text-muted hover:bg-hover hover:text-ink",
              )}
            >
              <Hash size={12} strokeWidth={2} className="shrink-0 text-faint" />
              <span className="min-w-0 flex-1 truncate">{entry.tag}</span>
              <span className="shrink-0 text-[10.5px] text-faint">
                {entry.notes.length}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="page-scroll flex-1">
        <div className="mx-auto flex w-full max-w-[640px] flex-col gap-4 px-8 pb-24 pt-6">
          <h2 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">
            {activeEntry ? `#${activeEntry.tag}` : ""}
          </h2>
          <div className="flex flex-col gap-1">
            {activeEntry?.notes.map((note) => (
              <button
                key={note.rel}
                type="button"
                onClick={() => setView({ type: "note", rel: note.rel })}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] text-ink transition-colors duration-100 hover:bg-hover"
              >
                <FileText size={14} strokeWidth={1.75} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1 truncate">{note.title}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
