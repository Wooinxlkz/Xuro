import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/lib/utils";

/** A manga/manhwa page is a fixed canvas size, not Excalidraw's usual
 * infinite whiteboard — 850×1200 approximates a common portrait comic
 * page ratio (roughly 5:7). The page-bounds rectangle inserted for a
 * fresh page is just a visual guide, not a hard clip; Panel mode is about
 * giving a strong starting structure, not locking anyone in. */
export const PAGE_WIDTH = 850;
export const PAGE_HEIGHT = 1200;

export type PageTheme = "manga" | "manhwa" | "vanilla";

const THEME_META: Record<PageTheme, { label: string; pageColor: string; stroke: string }> = {
  manga: { label: "B&W Manga", pageColor: "#ffffff", stroke: "#1a1a1a" },
  manhwa: { label: "Colored Manhwa", pageColor: "#fffaf3", stroke: "#2b2b2b" },
  vanilla: { label: "Vanilla", pageColor: "#ffffff", stroke: "#9aa0a6" },
};

/** Builds a complete, valid Excalidraw rectangle element by hand rather
 * than relying on a conversion helper from the library — this exact
 * object shape is the stable `.excalidraw` file schema (the format
 * Excalidraw has read/written for years), so it's a much safer bet than
 * depending on a specific utility function's exact export name/signature
 * in whatever Excalidraw version happens to be installed. */
function rectElement(opts: {
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  backgroundColor?: string;
  locked?: boolean;
}): OrderedExcalidrawElement {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    type: "rectangle",
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    angle: 0,
    strokeColor: opts.strokeColor,
    backgroundColor: opts.backgroundColor ?? "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: Math.floor(Math.random() * 2 ** 31),
    version: 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    isDeleted: false,
    boundElements: null,
    updated: now,
    link: null,
    locked: opts.locked ?? false,
  } as unknown as OrderedExcalidrawElement;
}

function panel(x: number, y: number, w: number, h: number, stroke: string): OrderedExcalidrawElement {
  return rectElement({ x, y, width: w, height: h, strokeColor: stroke });
}

const MARGIN = 24;
const GAP = 16;

const TEMPLATES: Array<{ id: string; label: string; build: (stroke: string) => OrderedExcalidrawElement[] }> = [
  {
    id: "splash",
    label: "Full-page splash",
    build: (stroke) => [panel(MARGIN, MARGIN, PAGE_WIDTH - MARGIN * 2, PAGE_HEIGHT - MARGIN * 2, stroke)],
  },
  {
    id: "two-stack",
    label: "2 panels, stacked",
    build: (stroke) => {
      const h = (PAGE_HEIGHT - MARGIN * 2 - GAP) / 2;
      return [
        panel(MARGIN, MARGIN, PAGE_WIDTH - MARGIN * 2, h, stroke),
        panel(MARGIN, MARGIN + h + GAP, PAGE_WIDTH - MARGIN * 2, h, stroke),
      ];
    },
  },
  {
    id: "three-stack",
    label: "3 panels, stacked",
    build: (stroke) => {
      const h = (PAGE_HEIGHT - MARGIN * 2 - GAP * 2) / 3;
      return [0, 1, 2].map((i) => panel(MARGIN, MARGIN + i * (h + GAP), PAGE_WIDTH - MARGIN * 2, h, stroke));
    },
  },
  {
    id: "yonkoma",
    label: "4-koma",
    build: (stroke) => {
      const h = (PAGE_HEIGHT - MARGIN * 2 - GAP * 3) / 4;
      return [0, 1, 2, 3].map((i) => panel(MARGIN, MARGIN + i * (h + GAP), PAGE_WIDTH - MARGIN * 2, h, stroke));
    },
  },
  {
    id: "grid-2x2",
    label: "2×2 grid",
    build: (stroke) => {
      const w = (PAGE_WIDTH - MARGIN * 2 - GAP) / 2;
      const h = (PAGE_HEIGHT - MARGIN * 2 - GAP) / 2;
      const out: OrderedExcalidrawElement[] = [];
      for (let row = 0; row < 2; row++) {
        for (let col = 0; col < 2; col++) {
          out.push(panel(MARGIN + col * (w + GAP), MARGIN + row * (h + GAP), w, h, stroke));
        }
      }
      return out;
    },
  },
  {
    id: "top-wide-bottom-two",
    label: "Wide top + 2 below",
    build: (stroke) => {
      const topH = (PAGE_HEIGHT - MARGIN * 2 - GAP) * 0.55;
      const bottomH = PAGE_HEIGHT - MARGIN * 2 - GAP - topH;
      const halfW = (PAGE_WIDTH - MARGIN * 2 - GAP) / 2;
      return [
        panel(MARGIN, MARGIN, PAGE_WIDTH - MARGIN * 2, topH, stroke),
        panel(MARGIN, MARGIN + topH + GAP, halfW, bottomH, stroke),
        panel(MARGIN + halfW + GAP, MARGIN + topH + GAP, halfW, bottomH, stroke),
      ];
    },
  },
];

interface SavedPage {
  pageTheme: PageTheme;
  elements: readonly OrderedExcalidrawElement[];
  appState: Partial<AppState>;
  files: BinaryFiles;
}

function parseSaved(raw: string): SavedPage | null {
  if (!raw.trim()) return null;
  try {
    const data = JSON.parse(raw) as Partial<SavedPage>;
    if (!Array.isArray(data.elements)) return null;
    return {
      pageTheme: data.pageTheme ?? "manga",
      elements: data.elements,
      appState: data.appState ?? {},
      files: data.files ?? {},
    };
  } catch {
    return null;
  }
}

function pageBoundsElement(theme: PageTheme): OrderedExcalidrawElement {
  return rectElement({
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    strokeColor: THEME_META[theme].stroke,
    backgroundColor: THEME_META[theme].pageColor,
    locked: true,
  });
}

export function PanelPageEditor({
  content,
  onChange,
}: {
  content: string;
  onChange: (content: string) => void;
}) {
  const saved = useMemo(() => parseSaved(content), [content]);
  const [pageTheme, setPageTheme] = useState<PageTheme>(saved?.pageTheme ?? "manga");
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const initialData: ExcalidrawInitialDataState = useMemo(() => {
    if (saved) {
      return { elements: saved.elements, appState: saved.appState, files: saved.files };
    }
    return { elements: [pageBoundsElement(pageTheme)], appState: { viewBackgroundColor: "transparent" } };
    // Only computed once on mount (fresh page) — after that, Excalidraw
    // owns the live scene and `content` updates come from our own saves,
    // not the other way around.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const persist = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
    theme: PageTheme,
  ) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload: SavedPage = {
        pageTheme: theme,
        elements,
        appState: { viewBackgroundColor: appState.viewBackgroundColor },
        files,
      };
      onChange(JSON.stringify(payload));
    }, 700);
  };

  const handleChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    persist(elements, appState, files, pageTheme);
  };

  const applyTemplate = (build: (stroke: string) => OrderedExcalidrawElement[]) => {
    const api = apiRef.current;
    if (!api) return;
    const current = api.getSceneElements();
    const added = build(THEME_META[pageTheme].stroke);
    const next = [...current, ...added];
    api.updateScene({ elements: next });
    persist(next, api.getAppState(), api.getFiles(), pageTheme);
  };

  const changeTheme = (theme: PageTheme) => {
    setPageTheme(theme);
    const api = apiRef.current;
    if (!api) return;
    persist(api.getSceneElements(), api.getAppState(), api.getFiles(), theme);
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="min-w-0 flex-1">
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api;
          }}
          initialData={initialData}
          onChange={handleChange}
        />
      </div>

      <div className="flex w-[220px] shrink-0 flex-col gap-4 overflow-auto border-l border-line-soft bg-panel p-3">
        <div>
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-faint">Theme</p>
          <div className="flex flex-col gap-1">
            {(Object.keys(THEME_META) as PageTheme[]).map((theme) => (
              <button
                key={theme}
                type="button"
                onClick={() => changeTheme(theme)}
                className={cx(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] transition-colors duration-100",
                  pageTheme === theme ? "bg-active text-ink font-medium" : "text-faint hover:bg-hover hover:text-ink",
                )}
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-full border"
                  style={{
                    backgroundColor: THEME_META[theme].pageColor,
                    borderColor: THEME_META[theme].stroke,
                  }}
                />
                {THEME_META[theme].label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-faint">
            Panel layouts
          </p>
          <div className="flex flex-col gap-1">
            {TEMPLATES.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => applyTemplate(tpl.build)}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
              >
                <TemplatePreview id={tpl.id} />
                {tpl.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-faint">
            Adds panels to the page — drag to reposition or resize afterwards, same as any shape.
          </p>
        </div>
      </div>
    </div>
  );
}

/** A tiny inline SVG sketch of each layout so the sidebar reads at a
 * glance instead of as a wall of text labels. */
function TemplatePreview({ id }: { id: string }) {
  const cells: Record<string, string[]> = {
    splash: ["0,0,24,16"],
    "two-stack": ["0,0,24,7", "0,9,24,7"],
    "three-stack": ["0,0,24,4.5", "0,5.5,24,4.5", "0,11,24,4.5"],
    yonkoma: ["0,0,24,3.5", "0,4,24,3.5", "0,8,24,3.5", "0,12,24,3.5"],
    "grid-2x2": ["0,0,11,7", "13,0,11,7", "0,9,11,7", "13,9,11,7"],
    "top-wide-bottom-two": ["0,0,24,8", "0,9,11,7", "13,9,11,7"],
  };
  const rects = cells[id] ?? [];
  return (
    <svg viewBox="0 0 24 16" width="20" height="14" className="shrink-0">
      {rects.map((r, i) => {
        const [x, y, w, h] = r.split(",").map(Number);
        return (
          <rect
            key={i}
            x={x}
            y={y}
            width={w}
            height={h}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
          />
        );
      })}
    </svg>
  );
}
