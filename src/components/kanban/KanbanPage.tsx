import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cx } from "@/lib/utils";
import type { Todo, TodoStatus } from "@/lib/types";
import { useBoards } from "@/stores/boards";
import { useTodos } from "@/stores/todos";

const COLUMNS: Array<{ status: TodoStatus; label: string }> = [
  { status: "todo", label: "Todo" },
  { status: "in_progress", label: "In Progress" },
  { status: "done", label: "Done" },
];

function statusOf(todo: Todo): TodoStatus {
  if (todo.done) return "done";
  if (todo.inProgress) return "in_progress";
  return "todo";
}

export function KanbanPage() {
  const { todos, loaded, load } = useTodos();
  const setStatus = useTodos((s) => s.setStatus);
  const addTodo = useTodos((s) => s.add);
  const [dragging, setDragging] = useState<string | null>(null);

  const { boards, activeBoardId, loaded: boardsLoaded } = useBoards();
  const loadBoards = useBoards((s) => s.load);
  const setActiveBoard = useBoards((s) => s.setActiveBoard);
  const createBoard = useBoards((s) => s.create);
  const renameBoard = useBoards((s) => s.rename);
  const removeBoard = useBoards((s) => s.remove);

  useEffect(() => {
    load();
    loadBoards();
  }, [load, loadBoards]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  const finishDrag = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    if (!over) return;
    const targetStatus = over.data.current?.status as TodoStatus | undefined;
    if (!targetStatus) return;
    const todo = todos.find((t) => t.id === active.id);
    if (!todo || statusOf(todo) === targetStatus) return;
    void setStatus(todo.id, targetStatus);
  };

  const draggedTodo = dragging ? todos.find((t) => t.id === dragging) : null;
  const boardTodos = activeBoardId
    ? todos.filter((t) => t.boardId === activeBoardId)
    : [];

  if (!loaded || !boardsLoaded) return null;

  return (
    <div className="page-scroll">
      <div className="mx-auto w-full max-w-[900px] px-8 pb-24 pt-6">
        <h1 className="mb-4 text-[20px] font-semibold tracking-[-0.01em] text-ink">
          Kanban
        </h1>

        <BoardTabs
          boards={boards}
          activeBoardId={activeBoardId}
          onSelect={setActiveBoard}
          onCreate={createBoard}
          onRename={renameBoard}
          onDelete={removeBoard}
        />

        {activeBoardId && (
          <AddCard onAdd={(text) => void addTodo(text, undefined, activeBoardId)} />
        )}

        <DndContext
          sensors={sensors}
          onDragStart={({ active }) => setDragging(String(active.id))}
          onDragCancel={() => setDragging(null)}
          onDragEnd={finishDrag}
        >
          <div className="grid grid-cols-3 gap-4">
            {COLUMNS.map(({ status, label }) => (
              <Column
                key={status}
                status={status}
                label={label}
                todos={boardTodos.filter((t) => statusOf(t) === status)}
              />
            ))}
          </div>
          <DragOverlay dropAnimation={null}>
            {draggedTodo ? <Card todo={draggedTodo} overlay /> : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}

function BoardTabs({
  boards,
  activeBoardId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  boards: { id: string; title: string }[];
  activeBoardId: string | null;
  onSelect: (id: string) => void;
  onCreate: (title: string) => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");

  const submitNew = () => {
    const title = draft.trim();
    if (title) onCreate(title);
    setDraft("");
    setCreating(false);
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5">
      {boards.map((board) => (
        <BoardTab
          key={board.id}
          board={board}
          active={board.id === activeBoardId}
          canDelete={boards.length > 1}
          onSelect={() => onSelect(board.id)}
          onRename={(title) => onRename(board.id, title)}
          onDelete={() => onDelete(board.id)}
        />
      ))}
      {creating ? (
        <Input
          autoFocus
          value={draft}
          placeholder="Board name"
          className="h-7 w-[140px] text-[12.5px]"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={submitNew}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitNew();
            if (e.key === "Escape") {
              setDraft("");
              setCreating(false);
            }
          }}
        />
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
          <Plus size={13} strokeWidth={2} />
          New board
        </Button>
      )}
    </div>
  );
}

function BoardTab({
  board,
  active,
  canDelete,
  onSelect,
  onRename,
  onDelete,
}: {
  board: { id: string; title: string };
  active: boolean;
  canDelete: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(board.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const title = draft.trim();
    if (title && title !== board.title) onRename(title);
    else setDraft(board.title);
    setEditing(false);
  };

  if (editing) {
    return (
      <Input
        ref={inputRef}
        value={draft}
        className="h-7 w-[140px] text-[12.5px]"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(board.title);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div
      className={cx(
        "group flex items-center gap-1 rounded-md px-2.5 py-1 text-[12.5px] transition-colors duration-100",
        active
          ? "bg-active text-ink font-medium"
          : "text-faint hover:bg-hover hover:text-ink",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={() => setEditing(true)}
        className="max-w-[160px] truncate"
        title="Double-click to rename"
      >
        {board.title}
      </button>
      {canDelete && active && (
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-0.5 text-faint opacity-0 transition-opacity duration-100 hover:text-danger group-hover:opacity-100"
          aria-label={`Delete ${board.title}`}
        >
          <X size={11} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

function AddCard({ onAdd }: { onAdd: (text: string) => void }) {
  const [value, setValue] = useState("");

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onAdd(text);
    setValue("");
  };

  return (
    <div className="mb-4 flex items-center gap-2">
      <Input
        value={value}
        placeholder="Add a card to this board…"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
      />
      <Button size="md" variant="secondary" onClick={submit}>
        <Plus size={14} strokeWidth={2} />
        Add
      </Button>
    </div>
  );
}

function Column({
  status,
  label,
  todos,
}: {
  status: TodoStatus;
  label: string;
  todos: Todo[];
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `column:${status}`,
    data: { status },
  });

  return (
    <div
      ref={setNodeRef}
      className={cx(
        "flex min-h-[200px] flex-col gap-2 rounded-xl p-2.5 transition-colors duration-100",
        isOver ? "bg-active" : "bg-panel",
      )}
    >
      <div className="flex items-center gap-2 px-1 pb-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-faint">
          {label}
        </p>
        <span className="text-[10.5px] text-faint">{todos.length}</span>
      </div>
      {todos.map((todo) => (
        <Card key={todo.id} todo={todo} />
      ))}
    </div>
  );
}

function Card({ todo, overlay }: { todo: Todo; overlay?: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: todo.id,
  });

  return (
    <div
      ref={overlay ? undefined : setNodeRef}
      {...(overlay ? {} : attributes)}
      {...(overlay ? {} : listeners)}
      style={
        !overlay && transform
          ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
          : undefined
      }
      className={cx(
        "cursor-grab touch-none rounded-lg bg-bg px-3 py-2.5 text-[12.5px] leading-5 text-ink shadow-sm",
        "border border-line-soft active:cursor-grabbing",
        overlay && "shadow-md",
      )}
    >
      {todo.text}
      {todo.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {todo.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-panel px-1.5 py-0.5 text-[10px] text-faint"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
