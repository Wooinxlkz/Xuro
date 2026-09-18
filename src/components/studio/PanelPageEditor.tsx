import { convertToExcalidrawElements, Excalidraw, Footer, MainMenu } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { ExternalLink, Moon, Sun } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cx } from "@/lib/utils";

/** A manga/manhwa page is a fixed canvas size, not Excalidraw's usual
 * infinite whiteboard — 850×1200 approximates a common portrait comic
 * page ratio (roughly 5:7). The page-bounds rectangle inserted for a
 * fresh page is just a visual guide, not a hard clip; Panel mode is about
 * giving a strong starting structure, not locking anyone in. */
export const PAGE_WIDTH = 850;
export const PAGE_HEIGHT = 1200;

/** Fixed, well-known id for the page-bounds guide rectangle so a later
 * theme switch can find and recolor it — every fresh page has exactly one
 * of these, so a constant id (rather than a random one) is safe. */
const PAGE_BOUNDS_ID = "xuro-page-bounds";

export type PageTheme = "manga" | "manhwa" | "vanilla";

const THEME_META: Record<PageTheme, { label: string; pageColor: string; stroke: string }> = {
  manga: { label: "B&W Manga", pageColor: "#ffffff", stroke: "#1a1a1a" },
  manhwa: { label: "Colored Manhwa", pageColor: "#fffaf3", stroke: "#2b2b2b" },
  vanilla: { label: "Vanilla", pageColor: "#ffffff", stroke: "#9aa0a6" },
};

/** Builds a complete, valid Excalidraw shape element by hand rather than
 * relying on a conversion helper from the library — this exact object
 * shape is the stable `.excalidraw` file schema (the format Excalidraw
 * has read/written for years), so it's a much safer bet than depending
 * on a specific utility function's exact export name/signature in
 * whatever Excalidraw version happens to be installed. Covers the three
 * basic shape types (rectangle/ellipse/diamond) — text and freehand
 * elements need extra fields this deliberately doesn't attempt to guess. */
function shapeElement(
  type: "rectangle" | "ellipse" | "diamond",
  opts: {
    id?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    angle?: number;
    strokeColor: string;
    backgroundColor?: string;
    strokeWidth?: number;
    groupIds?: string[];
    locked?: boolean;
  },
): OrderedExcalidrawElement {
  const now = Date.now();
  return {
    id: opts.id ?? crypto.randomUUID(),
    type,
    x: opts.x,
    y: opts.y,
    width: opts.width,
    height: opts.height,
    angle: opts.angle ?? 0,
    strokeColor: opts.strokeColor,
    backgroundColor: opts.backgroundColor ?? "transparent",
    fillStyle: "solid",
    strokeWidth: opts.strokeWidth ?? 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: opts.groupIds ?? [],
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

function rectElement(opts: {
  id?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  strokeColor: string;
  backgroundColor?: string;
  locked?: boolean;
}): OrderedExcalidrawElement {
  return shapeElement("rectangle", opts);
}

function panel(x: number, y: number, w: number, h: number, stroke: string): OrderedExcalidrawElement {
  return rectElement({ x, y, width: w, height: h, strokeColor: stroke });
}

/** Text stickers use Excalidraw's own official skeleton-to-element
 * converter rather than a hand-built object — text elements carry extra
 * font-metric fields (baseline, lineHeight, per-font vertical offsets)
 * that Excalidraw itself is the authority on getting right; shapes don't
 * have that problem, which is why they're still hand-built above. */
function textSticker(text: string, x: number, y: number, fontSize = 32): OrderedExcalidrawElement {
  const [element] = convertToExcalidrawElements([
    {
      type: "text",
      x,
      y,
      text,
      fontSize,
      strokeColor: "#1a1a1a",
    },
  ]);
  return element as OrderedExcalidrawElement;
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
    id: PAGE_BOUNDS_ID,
    x: 0,
    y: 0,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    strokeColor: THEME_META[theme].stroke,
    backgroundColor: THEME_META[theme].pageColor,
    locked: true,
  });
}

/** A small library of ready-made comic/manga elements — speech and
 * thought bubbles, an impact burst, speed lines, a caption box, and a
 * panel-divider bar — so Panel mode isn't just an empty canvas with
 * layout templates. Built entirely from rectangle/ellipse/diamond shapes
 * (types this file already builds by hand with full confidence in the
 * schema) rather than text or freehand/line elements, which have extra
 * fields that are harder to get exactly right without live testing.
 * Grouped multi-shape items share one `groupIds` value so dragging one
 * from the library moves the whole thing as a unit. */
function buildLibraryItems(): Array<{
  status: "published";
  id: string;
  created: number;
  name: string;
  elements: OrderedExcalidrawElement[];
}> {
  const ink = "#1a1a1a";
  const now = Date.now();
  const g = (name: string) => `xuro-lib-${name}`;

  const item = (id: string, name: string, elements: OrderedExcalidrawElement[]) => ({
    status: "published" as const,
    id,
    created: now,
    name,
    elements,
  });

  // Round speech bubble: an ellipse body + a small diamond "tail".
  const speechRound = (() => {
    const gid = [g("speech-round")];
    return [
      shapeElement("ellipse", {
        x: 0,
        y: 0,
        width: 220,
        height: 130,
        strokeColor: ink,
        backgroundColor: "#ffffff",
        groupIds: gid,
      }),
      shapeElement("diamond", {
        x: 40,
        y: 110,
        width: 36,
        height: 36,
        strokeColor: ink,
        backgroundColor: "#ffffff",
        groupIds: gid,
      }),
    ];
  })();

  // Manga-style hard-edged speech bubble: rectangle body + diamond tail.
  const speechRect = (() => {
    const gid = [g("speech-rect")];
    return [
      shapeElement("rectangle", {
        x: 0,
        y: 0,
        width: 220,
        height: 110,
        strokeColor: ink,
        backgroundColor: "#ffffff",
        groupIds: gid,
      }),
      shapeElement("diamond", {
        x: 40,
        y: 95,
        width: 32,
        height: 32,
        strokeColor: ink,
        backgroundColor: "#ffffff",
        groupIds: gid,
      }),
    ];
  })();

  // Thought bubble: a main ellipse trailed by two shrinking circles.
  const thought = (() => {
    const gid = [g("thought")];
    return [
      shapeElement("ellipse", {
        x: 0,
        y: 0,
        width: 220,
        height: 130,
        strokeColor: ink,
        backgroundColor: "#ffffff",
        groupIds: gid,
      }),
      shapeElement("ellipse", {
        x: 30,
        y: 132,
        width: 28,
        height: 28,
        strokeColor: ink,
        backgroundColor: "#ffffff",
        groupIds: gid,
      }),
      shapeElement("ellipse", {
        x: 10,
        y: 164,
        width: 16,
        height: 16,
        strokeColor: ink,
        backgroundColor: "#ffffff",
        groupIds: gid,
      }),
    ];
  })();

  // Plain caption/narration box — no tail, tinted background.
  const caption = [
    shapeElement("rectangle", {
      x: 0,
      y: 0,
      width: 220,
      height: 60,
      strokeColor: ink,
      backgroundColor: "#fff6d8",
    }),
  ];

  // Impact/shout burst: two diamonds, one rotated 45° over the other,
  // giving an 8-point star silhouette.
  const burst = (() => {
    const gid = [g("burst")];
    return [
      shapeElement("diamond", {
        x: 0,
        y: 0,
        width: 160,
        height: 160,
        strokeColor: ink,
        backgroundColor: "#ffffff",
        groupIds: gid,
      }),
      shapeElement("diamond", {
        x: 0,
        y: 0,
        width: 160,
        height: 160,
        angle: Math.PI / 4,
        strokeColor: ink,
        backgroundColor: "transparent",
        groupIds: gid,
      }),
    ];
  })();

  // Speed lines: six thin rectangles radiating from a common center.
  const speedLines = (() => {
    const gid = [g("speed-lines")];
    const count = 6;
    const length = 140;
    const thickness = 4;
    const elements: OrderedExcalidrawElement[] = [];
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      elements.push(
        shapeElement("rectangle", {
          x: 70 - length / 2,
          y: 70 - thickness / 2,
          width: length,
          height: thickness,
          angle,
          strokeColor: ink,
          backgroundColor: ink,
          strokeWidth: 1,
          groupIds: gid,
        }),
      );
    }
    return elements;
  })();

  // Focus rings: three concentric circles, like a target/emphasis mark.
  const focusRings = (() => {
    const gid = [g("focus-rings")];
    return [140, 95, 50].map((size) =>
      shapeElement("ellipse", {
        x: (140 - size) / 2,
        y: (140 - size) / 2,
        width: size,
        height: size,
        strokeColor: ink,
        backgroundColor: "transparent",
        groupIds: gid,
      }),
    );
  })();

  // Panel divider — a bold solid bar to separate panels or sections.
  const divider = [
    shapeElement("rectangle", {
      x: 0,
      y: 0,
      width: 260,
      height: 14,
      strokeColor: ink,
      backgroundColor: ink,
    }),
  ];

  // Sound-effect text stickers — the classic comic onomatopoeia set.
  const sfxBoom = [textSticker("BOOM!", 0, 0, 48)];
  const sfxPow = [textSticker("POW!", 0, 0, 48)];
  const sfxCrash = [textSticker("CRASH!", 0, 0, 40)];
  const sfxWham = [textSticker("WHAM!", 0, 0, 44)];
  const sfxHuh = [textSticker("...!?", 0, 0, 36)];

  // Vertical rectangle speech bubble tail pointing left, and an
  // oval "shout" bubble with a heavier stroke for emphasis.
  const shoutBubble = (() => {
    const gid = [g("shout")];
    return [
      shapeElement("ellipse", {
        x: 0,
        y: 0,
        width: 240,
        height: 140,
        strokeColor: ink,
        backgroundColor: "#ffffff",
        strokeWidth: 4,
        groupIds: gid,
      }),
      shapeElement("diamond", {
        x: 190,
        y: 100,
        width: 40,
        height: 40,
        strokeColor: ink,
        backgroundColor: "#ffffff",
        strokeWidth: 4,
        groupIds: gid,
      }),
    ];
  })();

  // Sound-effect burst: a filled diamond behind bold text, grouped.
  const sfxBurst = (() => {
    const gid = [g("sfx-burst")];
    return [
      shapeElement("diamond", {
        x: 0,
        y: 0,
        width: 170,
        height: 170,
        strokeColor: ink,
        backgroundColor: "#fff2b8",
        groupIds: gid,
      }),
      shapeElement("diamond", {
        x: 0,
        y: 0,
        width: 170,
        height: 170,
        angle: Math.PI / 4,
        strokeColor: ink,
        backgroundColor: "transparent",
        groupIds: gid,
      }),
      { ...textSticker("BANG!", 30, 65, 30), groupIds: gid } as OrderedExcalidrawElement,
    ];
  })();

  return [
    item("speech-round", "Speech bubble (round)", speechRound),
    item("speech-rect", "Speech bubble (manga)", speechRect),
    item("shout-bubble", "Shout bubble", shoutBubble),
    item("thought", "Thought bubble", thought),
    item("caption", "Caption box", caption),
    item("burst", "Impact burst", burst),
    item("sfx-burst", "Sound effect burst", sfxBurst),
    item("speed-lines", "Speed lines", speedLines),
    item("focus-rings", "Focus rings", focusRings),
    item("divider", "Panel divider", divider),
    item("sfx-boom", "\"BOOM!\" sticker", sfxBoom),
    item("sfx-pow", "\"POW!\" sticker", sfxPow),
    item("sfx-crash", "\"CRASH!\" sticker", sfxCrash),
    item("sfx-wham", "\"WHAM!\" sticker", sfxWham),
    item("sfx-huh", "\"...!?\" sticker", sfxHuh),
  ];
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

  // Excalidraw's own toolbar/menu chrome follows Xuro's theme by default
  // (same check CanvasEditor.tsx uses), but can be flipped independently
  // via the footer toggle below — some people want a different shade for
  // the canvas chrome than the rest of the app.
  const appIsDark =
    typeof document !== "undefined" && document.documentElement.classList.contains("dark");
  const [uiThemeOverride, setUiThemeOverride] = useState<"light" | "dark" | null>(null);
  const uiTheme = uiThemeOverride ?? (appIsDark ? "dark" : "light");

  const initialData: ExcalidrawInitialDataState = useMemo(() => {
    // Bundled comic/manga elements (speech bubbles, bursts, etc.) load
    // into Excalidraw's own Library panel every time, regardless of
    // whether this page already has content.
    const libraryItems = buildLibraryItems();
    if (saved) {
      return {
        elements: saved.elements,
        appState: saved.appState,
        files: saved.files,
        libraryItems,
      } as ExcalidrawInitialDataState;
    }
    return {
      elements: [pageBoundsElement(pageTheme)],
      appState: { viewBackgroundColor: "transparent" },
      libraryItems,
    } as ExcalidrawInitialDataState;
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
    const meta = THEME_META[theme];
    const now = Date.now();
    // Recolor the page-bounds guide rectangle in place — without this,
    // switching themes only affected *future* inserted panels, leaving
    // the page looking completely unchanged (the reported "themes do
    // nothing" bug).
    const updated = api.getSceneElements().map((el) =>
      el.id === PAGE_BOUNDS_ID
        ? ({
            ...el,
            strokeColor: meta.stroke,
            backgroundColor: meta.pageColor,
            version: el.version + 1,
            versionNonce: Math.floor(Math.random() * 2 ** 31),
            updated: now,
          } as OrderedExcalidrawElement)
        : el,
    );
    api.updateScene({ elements: updated });
    persist(updated, api.getAppState(), api.getFiles(), theme);
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Excalidraw's own Help ("?") dialog links to Excalidraw's own
          docs/blog/issue-tracker/YouTube — there's no supported way to
          override its contents, so it's hidden outright rather than left
          showing the wrong project's branding. The MainMenu below (which
          *is* fully overridable) carries Xuro's own links instead.
          The --color-primary override matches Excalidraw's active-tool
          highlight to Xuro's own monochrome "primary button" look
          (bg-invert/text-invert-ink) instead of Excalidraw's default
          purple, which clashed with the rest of the app. */}
      <style>{`
        .xuro-panel-editor .excalidraw button[aria-label="Help"] { display: none !important; }
        .xuro-panel-editor .excalidraw {
          --color-primary: var(--invert);
          --color-primary-darker: var(--invert);
          --color-primary-darkest: var(--invert);
          --color-primary-light: var(--active);
        }
        .xuro-panel-editor .excalidraw.theme--dark {
          --color-primary: var(--invert);
          --color-primary-darker: var(--invert);
          --color-primary-darkest: var(--invert);
          --color-primary-light: var(--active);
        }
      `}</style>
      <div className="xuro-panel-editor min-w-0 flex-1">
        <Excalidraw
          excalidrawAPI={(api) => {
            apiRef.current = api;
          }}
          initialData={initialData}
          onChange={handleChange}
          theme={uiTheme}
        >
          <MainMenu>
            <MainMenu.DefaultItems.SaveAsImage />
            <MainMenu.DefaultItems.Export />
            <MainMenu.DefaultItems.ClearCanvas />
            <MainMenu.DefaultItems.ChangeCanvasBackground />
            <MainMenu.Separator />
            <MainMenu.ItemLink
              href="https://github.com/Wooinxlkz/Xuro"
              icon={<ExternalLink size={14} strokeWidth={1.8} />}
            >
              Xuro on GitHub
            </MainMenu.ItemLink>
            <MainMenu.ItemLink href="https://github.com/Wooinxlkz/Xuro#readme">
              Documentation
            </MainMenu.ItemLink>
          </MainMenu>
          <Footer>
            <button
              type="button"
              onClick={() => setUiThemeOverride(uiTheme === "dark" ? "light" : "dark")}
              title={uiTheme === "dark" ? "Switch canvas to light" : "Switch canvas to dark"}
              className="mx-2 grid h-9 w-9 place-items-center rounded-lg border border-line-soft bg-panel text-faint hover:bg-hover hover:text-ink"
            >
              {uiTheme === "dark" ? (
                <Sun size={15} strokeWidth={1.8} />
              ) : (
                <Moon size={15} strokeWidth={1.8} />
              )}
            </button>
          </Footer>
        </Excalidraw>
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
