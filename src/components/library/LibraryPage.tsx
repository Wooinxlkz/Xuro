import { openUrl } from "@tauri-apps/plugin-opener";
import {
  BookOpen,
  Grid2x2,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { cx } from "@/lib/utils";
import type { LibraryItem, LibraryKind, LibrarySearchResult } from "@/lib/types";
import { useLibrary, type LibraryViewMode } from "@/stores/library";
import { useVault } from "@/stores/vault";
import { PdfReader } from "./PdfReader";

const VIEW_MODES: Array<{ mode: LibraryViewMode; icon: typeof List; label: string }> = [
  { mode: "list", icon: List, label: "List" },
  { mode: "grid", icon: LayoutGrid, label: "Grid" },
  { mode: "bento", icon: Grid2x2, label: "Bento" },
];

export function LibraryPage() {
  const { items, loaded, viewMode, searchKind, searchResults, searching, pickedFile } =
    useLibrary();
  const load = useLibrary((s) => s.load);
  const setViewMode = useLibrary((s) => s.setViewMode);
  const setSearchKind = useLibrary((s) => s.setSearchKind);
  const search = useLibrary((s) => s.search);
  const addFromSearch = useLibrary((s) => s.addFromSearch);
  const pickFile = useLibrary((s) => s.pickFile);
  const remove = useLibrary((s) => s.remove);
  const root = useVault((s) => s.root);

  const [query, setQuery] = useState("");
  const [readingItem, setReadingItem] = useState<LibraryItem | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    load();
  }, [load]);

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void search(value), 350);
  };

  const openFile = (item: LibraryItem) => {
    if (!item.fileRel || !root) return;
    if (item.fileRel.toLowerCase().endsWith(".pdf")) {
      setReadingItem(item);
      return;
    }
    // EPUB/CBZ/CBR don't have an in-app reader yet — open with whatever
    // the system already handles that format with (its default app), same
    // as before.
    void openUrl(`${root}/${item.fileRel}`).catch((error) =>
      toast.error(error instanceof Error ? error.message : String(error)),
    );
  };

  const alreadySaved = (result: LibrarySearchResult) =>
    items.some(
      (item) => item.title === result.title && item.kind === result.kind && !item.fileRel,
    );

  if (!loaded) return null;

  return (
    <div className="page-scroll">
      <div className="mx-auto w-full max-w-[1000px] px-8 pb-24 pt-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-ink">Library</h1>
          <div className="flex items-center gap-1 rounded-lg border border-line-soft bg-panel p-0.5">
            {VIEW_MODES.map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                type="button"
                title={label}
                onClick={() => setViewMode(mode)}
                className={cx(
                  "grid h-7 w-7 place-items-center rounded-md transition-colors duration-100",
                  viewMode === mode ? "bg-active text-ink" : "text-faint hover:text-ink",
                )}
              >
                <Icon size={14} strokeWidth={1.8} />
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3 flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-line-soft bg-panel p-0.5">
            {(["book", "manga"] as LibraryKind[]).map((kind) => (
              <button
                key={kind}
                type="button"
                onClick={() => setSearchKind(kind)}
                className={cx(
                  "rounded-md px-2.5 py-1 text-[12px] capitalize transition-colors duration-100",
                  searchKind === kind ? "bg-active text-ink font-medium" : "text-faint hover:text-ink",
                )}
              >
                {kind === "book" ? "Books" : "Manga"}
              </button>
            ))}
          </div>
          <div className="relative flex-1">
            <Search
              size={13}
              strokeWidth={2}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
            />
            <Input
              value={query}
              placeholder={`Search ${searchKind === "book" ? "books" : "manga"}…`}
              className="pl-8"
              onChange={(e) => onQueryChange(e.target.value)}
            />
          </div>
          <Button size="md" variant="secondary" onClick={() => void pickFile()}>
            <Upload size={14} strokeWidth={2} />
            Upload
          </Button>
        </div>

        {query.trim().length > 0 && (
          <SearchResults
            results={searchResults}
            searching={searching}
            onAdd={addFromSearch}
            alreadySaved={alreadySaved}
          />
        )}

        <div className="mt-5">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <BookOpen size={22} strokeWidth={1.5} className="text-faint" />
              <p className="text-[13px] text-muted">Your library is empty</p>
              <p className="max-w-[280px] text-[11.5px] text-faint">
                Search above to add a book or manga, or upload a file of your own.
              </p>
            </div>
          ) : viewMode === "list" ? (
            <ListView items={items} onOpen={openFile} onRemove={remove} />
          ) : viewMode === "grid" ? (
            <GridView items={items} onOpen={openFile} onRemove={remove} />
          ) : (
            <BentoView items={items} onOpen={openFile} onRemove={remove} />
          )}
        </div>
      </div>

      {pickedFile && <UploadDialog defaultKind={searchKind} />}
      {readingItem && <PdfReader item={readingItem} onClose={() => setReadingItem(null)} />}
    </div>
  );
}

function SearchResults({
  results,
  searching,
  onAdd,
  alreadySaved,
}: {
  results: LibrarySearchResult[];
  searching: boolean;
  onAdd: (result: LibrarySearchResult) => void;
  alreadySaved: (result: LibrarySearchResult) => boolean;
}) {
  return (
    <div className="mb-5 rounded-xl border border-line-soft bg-panel p-3">
      {searching ? (
        <div className="flex items-center gap-2 py-4 text-[12px] text-faint">
          <Loader2 size={13} className="animate-spin" />
          Searching…
        </div>
      ) : results.length === 0 ? (
        <p className="py-4 text-center text-[12px] text-faint">No results</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
          {results.map((result) => (
            <div
              key={result.externalId}
              className="flex flex-col gap-1.5 rounded-lg border border-line-soft bg-bg p-2"
            >
              <div className="aspect-[2/3] w-full overflow-hidden rounded-md bg-panel">
                {result.coverUrl && (
                  <img
                    src={result.coverUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                )}
              </div>
              <p className="line-clamp-2 text-[11.5px] font-medium leading-tight text-ink">
                {result.title}
              </p>
              {result.author && (
                <p className="truncate text-[10.5px] text-faint">{result.author}</p>
              )}
              <Button
                size="sm"
                variant={alreadySaved(result) ? "ghost" : "secondary"}
                disabled={alreadySaved(result)}
                onClick={() => onAdd(result)}
              >
                <Plus size={12} strokeWidth={2} />
                {alreadySaved(result) ? "Added" : "Add"}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Cover({ item }: { item: LibraryItem }) {
  return (
    <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-md bg-panel">
      {item.coverUrl ? (
        <img src={item.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <BookOpen size={20} strokeWidth={1.5} className="text-faint" />
      )}
    </div>
  );
}

function ListView({
  items,
  onOpen,
  onRemove,
}: {
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col divide-y divide-line-soft rounded-xl border border-line-soft bg-panel">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 px-3 py-2">
          <div className="h-12 w-9 shrink-0">
            <Cover item={item} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-medium text-ink">{item.title}</p>
            <p className="truncate text-[11px] text-faint">
              {item.author ?? (item.kind === "book" ? "Book" : "Manga")}
            </p>
          </div>
          <RowActions item={item} onOpen={onOpen} onRemove={onRemove} />
        </div>
      ))}
    </div>
  );
}

function GridView({
  items,
  onOpen,
  onRemove,
}: {
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {items.map((item) => (
        <div key={item.id} className="group flex flex-col gap-1.5">
          <div className="relative aspect-[2/3] w-full">
            <Cover item={item} />
            <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 p-1 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
              <RowActions item={item} onOpen={onOpen} onRemove={onRemove} compact />
            </div>
          </div>
          <p className="line-clamp-2 text-[11.5px] font-medium leading-tight text-ink">
            {item.title}
          </p>
        </div>
      ))}
    </div>
  );
}

function BentoView({
  items,
  onOpen,
  onRemove,
}: {
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="grid grid-flow-dense grid-cols-4 gap-3 sm:grid-cols-6">
      {items.map((item, i) => {
        // Every 5th item gets a bigger tile — enough variety to read as a
        // bento layout without any item ever losing its cover's aspect ratio.
        const big = i % 5 === 0;
        return (
          <div
            key={item.id}
            className={cx("group flex flex-col gap-1.5", big && "col-span-2 row-span-2")}
          >
            <div className="relative aspect-[2/3] w-full flex-1">
              <Cover item={item} />
              <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1 p-1 opacity-0 transition-opacity duration-100 group-hover:opacity-100">
                <RowActions item={item} onOpen={onOpen} onRemove={onRemove} compact />
              </div>
            </div>
            <p
              className={cx(
                "line-clamp-2 font-medium leading-tight text-ink",
                big ? "text-[13px]" : "text-[11.5px]",
              )}
            >
              {item.title}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function RowActions({
  item,
  onOpen,
  onRemove,
  compact,
}: {
  item: LibraryItem;
  onOpen: (item: LibraryItem) => void;
  onRemove: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={cx("flex items-center gap-1", !compact && "shrink-0")}>
      {item.fileRel && (
        <Button size={compact ? "icon" : "sm"} variant="secondary" onClick={() => onOpen(item)}>
          <BookOpen size={13} strokeWidth={2} />
          {!compact && "Read"}
        </Button>
      )}
      <Button size="icon" variant="ghost" onClick={() => onRemove(item.id)} aria-label="Remove">
        <Trash2 size={13} strokeWidth={2} />
      </Button>
    </div>
  );
}

function UploadDialog({ defaultKind }: { defaultKind: LibraryKind }) {
  const pickedFile = useLibrary((s) => s.pickedFile);
  const clearPickedFile = useLibrary((s) => s.clearPickedFile);
  const confirmUpload = useLibrary((s) => s.confirmUpload);
  const uploading = useLibrary((s) => s.uploading);
  const [title, setTitle] = useState(pickedFile?.suggestedTitle ?? "");
  const [author, setAuthor] = useState("");
  const [kind, setKind] = useState<LibraryKind>(defaultKind);

  // The dialog only ever mounts once a file's already been picked (see the
  // `pickedFile &&` guard where this is rendered), so this fires exactly
  // once per pick to seed the title from the filename.
  useEffect(() => {
    if (pickedFile) setTitle(pickedFile.suggestedTitle);
  }, [pickedFile]);

  const submit = async () => {
    if (!title.trim()) return;
    await confirmUpload(title.trim(), author.trim() || undefined, kind);
  };

  return (
    <Modal open onClose={clearPickedFile} ariaLabel="Upload a book or manga">
      <div className="w-[320px] rounded-xl border border-line bg-bg p-4">
        <p className="mb-3 text-[13.5px] font-semibold text-ink">Add to your library</p>
        <div className="flex flex-col gap-2.5">
          <Input
            autoFocus
            value={title}
            placeholder="Title"
            onChange={(e) => setTitle(e.target.value)}
          />
          <Input
            value={author}
            placeholder="Author (optional)"
            onChange={(e) => setAuthor(e.target.value)}
          />
          <div className="flex items-center gap-1 rounded-lg border border-line-soft bg-panel p-0.5">
            {(["book", "manga"] as LibraryKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={cx(
                  "flex-1 rounded-md px-2.5 py-1 text-[12px] capitalize transition-colors duration-100",
                  kind === k ? "bg-active text-ink font-medium" : "text-faint hover:text-ink",
                )}
              >
                {k === "book" ? "Book" : "Manga"}
              </button>
            ))}
          </div>
          <p className="truncate text-[10.5px] text-faint" title={pickedFile?.path}>
            {pickedFile?.path.split(/[/\\]/).pop()}
          </p>
          <Button
            size="md"
            variant="primary"
            loading={uploading}
            disabled={!title.trim()}
            onClick={() => void submit()}
          >
            <Upload size={14} strokeWidth={2} />
            Add to library
          </Button>
        </div>
      </div>
    </Modal>
  );
}
