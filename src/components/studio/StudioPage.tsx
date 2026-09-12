import { BookOpen, Feather, Loader2, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { useStudio } from "@/stores/studio";
import { StudioEditor } from "./StudioEditor";

/** Inkwell's home: a grid of writing projects, same "empty state → create
 * → grid" shape as Library. Phase 1 is prose-only (chaptered long-form
 * writing) — Panel mode (manga/manhwa page layout) is a separate, later
 * addition to this same tab, not something this page needs to anticipate
 * structurally yet. */
export function StudioPage() {
  const projects = useStudio((s) => s.projects);
  const loaded = useStudio((s) => s.loaded);
  const activeProject = useStudio((s) => s.activeProject);
  const load = useStudio((s) => s.load);
  const openProject = useStudio((s) => s.openProject);
  const closeProject = useStudio((s) => s.closeProject);
  const deleteProject = useStudio((s) => s.deleteProject);
  const createProject = useStudio((s) => s.createProject);

  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  if (activeProject) {
    return (
      <div className="fixed inset-0 z-30 bg-bg">
        <StudioEditor onClose={closeProject} />
      </div>
    );
  }

  const submitCreate = async () => {
    setBusy(true);
    const project = await createProject(newTitle);
    setBusy(false);
    if (project) {
      setCreating(false);
      setNewTitle("");
      void openProject(project.id);
    }
  };

  return (
    <div className="page-scroll">
      <div className="mx-auto w-full max-w-[1000px] px-8 pb-24 pt-6">
        <div className="mb-1 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Feather size={18} strokeWidth={1.75} className="text-ink" />
            <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Inkwell</h1>
          </div>
          <Button size="md" variant="primary" onClick={() => setCreating(true)}>
            <Plus size={14} strokeWidth={2} />
            New project
          </Button>
        </div>
        <p className="mb-6 text-[12px] text-faint">
          Write chaptered stories, scripts, or novels — save, export, and pick up right where you
          left off.
        </p>

        {!loaded ? (
          <div className="flex items-center justify-center gap-2 py-16 text-[12.5px] text-faint">
            <Loader2 size={14} className="animate-spin" />
            Loading…
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <BookOpen size={24} strokeWidth={1.5} className="text-faint" />
            <p className="text-[13px] text-muted">No projects yet</p>
            <p className="max-w-[280px] text-[11.5px] text-faint">
              Start a new project to begin writing your first chapter.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {projects.map((project) => (
              <div
                key={project.id}
                className="group relative flex flex-col gap-2 rounded-xl border border-line-soft bg-panel p-4 text-left transition-colors duration-100 hover:border-line"
              >
                <button
                  type="button"
                  onClick={() => void openProject(project.id)}
                  className="flex flex-1 flex-col items-start gap-2 text-left"
                >
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-sunken text-faint">
                    <Feather size={15} strokeWidth={1.75} />
                  </div>
                  <p className="line-clamp-2 text-[13px] font-medium leading-tight text-ink">
                    {project.title}
                  </p>
                  <p className="text-[10.5px] text-faint">
                    {project.chapterCount} chapter{project.chapterCount === 1 ? "" : "s"} ·{" "}
                    {project.wordCount.toLocaleString()} words
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(`Delete "${project.title}"? This can't be undone.`)) {
                      void deleteProject(project.id);
                    }
                  }}
                  className="absolute right-2.5 top-2.5 hidden h-6 w-6 place-items-center rounded-md text-faint hover:bg-hover hover:text-danger group-hover:grid"
                  aria-label="Delete project"
                >
                  <Trash2 size={12} strokeWidth={1.8} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {creating && (
        <Modal open onClose={() => setCreating(false)} ariaLabel="New Inkwell project">
          <div className="w-[320px] rounded-xl border border-line bg-bg p-4">
            <p className="mb-3 text-[13.5px] font-semibold text-ink">New Inkwell project</p>
            <div className="flex flex-col gap-2.5">
              <Input
                autoFocus
                value={newTitle}
                placeholder="Project title"
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTitle.trim()) void submitCreate();
                }}
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setCreating(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  disabled={!newTitle.trim()}
                  onClick={() => void submitCreate()}
                >
                  Create
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
