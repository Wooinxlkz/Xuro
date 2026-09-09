import type { Core, NodeSingular } from "cytoscape";
import {
  FilePlus,
  FileText,
  FolderOpen,
  Info,
  Maximize2,
  Minimize2,
  Pencil,
  Pin,
  PinOff,
  Search,
  ScanSearch,
  Waypoints,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { ContextMenu, type MenuItem, type MenuPosition } from "@/components/ui/ContextMenu";
import { Tooltip } from "@/components/ui/Tooltip";
import { ipc } from "@/lib/ipc";
import type { Graph as GraphData, GraphFolder, GraphNode } from "@/lib/types";
import { isMac } from "@/lib/utils";
import { usePins } from "@/stores/pins";
import { useVault } from "@/stores/vault";

/** Read a CSS custom property's current value (theme-aware, no hardcoding). */
function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function isDarkMode(): boolean {
  return document.documentElement.classList.contains("dark");
}

/** No fill — folders are just a colored, dashed outline, not a solid box. */
function folderBorder(hue: number): string {
  return `hsl(${hue}, 65%, ${isDarkMode() ? "58%" : "45%"})`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(ms: number): string {
  if (!ms) return "Unknown";
  return DATE_FORMAT.format(new Date(ms));
}

const COSE_LAYOUT = {
  name: "cose",
  animate: false,
  randomize: true,
  nodeRepulsion: 8000,
  idealEdgeLength: 80,
  numIter: 1000,
  fit: true,
  padding: 40,
  // Folders are containers, not nodes to be squeezed flat — give them
  // room to actually hold what's inside them.
  nestingFactor: 1.2,
  componentSpacing: 60,
} as const;

type InfoTarget =
  | { type: "note"; node: GraphNode }
  | { type: "folder"; folder: GraphFolder };

export function GraphView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const setView = useVault((s) => s.setView);
  const root = useVault((s) => s.root);
  const expandTo = useVault((s) => s.expandTo);
  const pins = usePins((s) => s.pins);
  const togglePin = usePins((s) => s.toggle);
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [nodeMenu, setNodeMenu] = useState<{
    position: MenuPosition;
    rel: string;
    title: string;
  } | null>(null);
  const [folderMenu, setFolderMenu] = useState<{
    position: MenuPosition;
    rel: string;
    name: string;
  } | null>(null);
  const [info, setInfo] = useState<InfoTarget | null>(null);
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<{
    rel: string;
    kind: "note" | "folder";
    value: string;
  } | null>(null);
  const [bgMenu, setBgMenu] = useState<MenuPosition | null>(null);

  const reloadGraph = () => {
    void ipc.graphData().then(setGraph);
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ipc
      .graphData()
      .then((data) => {
        if (!cancelled) setGraph(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const folderByRel = useMemo(() => {
    const map = new Map<string, GraphFolder>();
    graph?.folders.forEach((f) => map.set(f.rel, f));
    return map;
  }, [graph]);

  const nodeByRel = useMemo(() => {
    const map = new Map<string, GraphNode>();
    graph?.nodes.forEach((n) => map.set(n.rel, n));
    return map;
  }, [graph]);

  // Every folder that is either collapsed itself or nested inside one that
  // is — anything under one of these should be hidden from the canvas.
  const hiddenAncestor = (folderRel: string | null): boolean => {
    let current = folderRel;
    while (current) {
      if (collapsed.has(current)) return true;
      current = folderByRel.get(current)?.parent ?? null;
    }
    return false;
  };

  useEffect(() => {
    if (!graph || !containerRef.current) return;
    let cancelled = false;
    let cy: Core | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let removeContextMenuBlock: (() => void) | null = null;

    void (async () => {
      // cytoscape is a real dependency here (not just type-only) but it's
      // ~450KB — loaded on demand so opening the app doesn't pay for it
      // unless Graph view is actually opened.
      const { default: cytoscape } = await import("cytoscape");
      const container = containerRef.current;
      if (cancelled || !container) return;

      const ink = cssVar("--ink") || "#e5e5e5";
      const muted = cssVar("--muted") || "#9a9a9a";
      const line = cssVar("--line") || "#333333";
      const accent =
        cssVar("--accent-indicator") || cssVar("--accent") || "#6d8cff";

      const maxDegree = Math.max(1, ...graph.nodes.map((n) => n.degree));

      const folderElements = graph.folders.map((folder) => ({
        data: {
          id: folder.rel,
          label: `${folder.name}  (${folder.noteCount})`,
          isFolder: true,
          hue: folder.hue,
          parent: folder.parent ?? undefined,
        },
      }));

      const noteElements = graph.nodes.map((node) => ({
        data: {
          id: node.rel,
          label: node.title,
          degree: node.degree,
          // Distinct key from the folder nodes' `hue` (used for their
          // fill) so the two style rules below never collide on one node.
          ringHue: node.folder ? folderByRel.get(node.folder)?.hue : undefined,
          parent: node.folder ?? undefined,
        },
      }));

      const instance = cytoscape({
        container,
        elements: [
          ...folderElements,
          ...noteElements,
          ...graph.edges.map((edge, i) => ({
            data: { id: `e${i}`, source: edge.source, target: edge.target },
          })),
        ],
        style: [
          {
            selector: "node",
            style: {
              "background-color": muted,
              label: "data(label)",
              color: ink,
              "font-size": 10,
              "text-valign": "bottom",
              "text-margin-y": 4,
              "text-wrap": "ellipsis",
              "text-max-width": "90px",
              width: (el: NodeSingular) =>
                8 + 14 * Math.sqrt((el.data("degree") ?? 0) / maxDegree),
              height: (el: NodeSingular) =>
                8 + 14 * Math.sqrt((el.data("degree") ?? 0) / maxDegree),
              "border-width": 0,
            },
          },
          {
            // Notes that sit inside a folder get a slight tinted ring
            // matching that folder's color — a light touch, not a fill.
            selector: "node[ringHue]",
            style: {
              "border-width": 1.5,
              "border-opacity": 0.6,
              "border-color": (el: NodeSingular) =>
                `hsl(${el.data("ringHue")}, 55%, ${isDarkMode() ? "62%" : "42%"})`,
            },
          },
          {
            selector: "node:selected",
            style: { "background-color": accent, color: ink, "font-weight": 600 },
          },
          {
            selector: "node[?isFolder]",
            style: {
              shape: "round-rectangle",
              // No fill — the user asked for colored borders, not colored
              // boxes. "background-opacity: 0" keeps the shape (so the
              // dashed outline still reads as a container) without ever
              // painting over what's inside it.
              "background-opacity": 0,
              "border-width": 1.5,
              "border-color": (el: NodeSingular) => folderBorder(el.data("hue")),
              "border-style": "dashed",
              label: "data(label)",
              "text-valign": "top",
              "text-halign": "center",
              "text-margin-y": -6,
              "font-size": 10.5,
              "font-weight": 600,
              color: (el: NodeSingular) => folderBorder(el.data("hue")),
              padding: "18px",
              "compound-sizing-wrt-labels": "include",
            },
          },
          {
            selector: "edge",
            style: {
              width: 1,
              "line-color": line,
              "curve-style": "haystack",
              "haystack-radius": 0,
              opacity: 0.55,
            },
          },
        ],
        // A container that isn't visible/sized yet (still mid-mount, or
        // behind a not-yet-active tab) reports 0x0 to cytoscape, which
        // collapses a physics-based layout onto a single line. Start with
        // 'grid' (well-behaved at any size, even 0x0) and only run the
        // real 'cose' layout once the ResizeObserver below confirms the
        // container actually has real pixel dimensions.
        layout: { name: "grid" },
        wheelSensitivity: 0.2,
        minZoom: 0.15,
        maxZoom: 3,
      });

      const runLayout = () => {
        instance.layout(COSE_LAYOUT).run();
      };

      instance.on("tap", "node", (event) => {
        const node = event.target as NodeSingular;
        if (node.data("isFolder")) {
          setCollapsed((prev) => {
            const next = new Set(prev);
            const rel = node.id();
            if (next.has(rel)) next.delete(rel);
            else next.add(rel);
            return next;
          });
          return;
        }
        setView({ type: "note", rel: node.id() });
      });

      instance.on("cxttap", "node", (event) => {
        const node = event.target as NodeSingular;
        const rendered = node.renderedPosition();
        const rect = container.getBoundingClientRect();
        const position = { x: rect.left + rendered.x, y: rect.top + rendered.y };
        if (node.data("isFolder")) {
          setFolderMenu({ position, rel: node.id(), name: node.data("label") as string });
        } else {
          setNodeMenu({ position, rel: node.id(), title: node.data("label") as string });
        }
      });

      // Right-clicking empty canvas (not a node) offers a lightweight
      // "New note" action — `cxttap` on the core itself (rather than the
      // "node" selector above) only fires for clicks that hit no element.
      instance.on("cxttap", (event) => {
        if (event.target !== instance) return;
        const position = { x: event.originalEvent.clientX, y: event.originalEvent.clientY };
        setBgMenu(position);
      });

      // Cytoscape's own `cxttap` above only drives *our* menu — the
      // browser/webview still fires its native right-click menu underneath
      // unless we stop it here too, which is why right-clicking a node
      // used to show both at once.
      const blockNativeContextMenu = (event: MouseEvent) => event.preventDefault();
      container.addEventListener("contextmenu", blockNativeContextMenu);
      removeContextMenuBlock = () =>
        container.removeEventListener("contextmenu", blockNativeContextMenu);

      instance.on("mouseover", "node", (event) => {
        event.target.connectedEdges().style("opacity", 1);
        container.style.setProperty("cursor", "pointer");
      });
      instance.on("mouseout", "node", (event) => {
        event.target.connectedEdges().style("opacity", 0.55);
        container.style.removeProperty("cursor");
      });

      cy = instance;
      cyRef.current = instance;

      // Re-run layout only once the container has a real, non-zero size —
      // this is the actual fix for the collapsed-into-a-line bug: don't
      // trust the container's size at construction time, wait for it.
      resizeObserver = new ResizeObserver((entries) => {
        const box = entries[0]?.contentRect;
        if (box && box.width > 20 && box.height > 20) {
          instance.resize();
          runLayout();
          resizeObserver?.disconnect();
        }
      });
      resizeObserver.observe(container);
    })();

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      removeContextMenuBlock?.();
      cy?.destroy();
      cyRef.current = null;
    };
  }, [graph, setView, folderByRel]);

  // Apply collapse state to the live graph without rebuilding it — hide
  // everything nested under a collapsed folder, keep the folder itself
  // visible (its label already shows the note count), then reflow.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !graph) return;
    cy.batch(() => {
      cy.nodes().forEach((node) => {
        const rel = node.id();
        const isFolder = node.data("isFolder") as boolean;
        const parentRel = isFolder
          ? folderByRel.get(rel)?.parent ?? null
          : nodeByRel.get(rel)?.folder ?? null;
        node.style("display", hiddenAncestor(parentRel) ? "none" : "element");
      });
    });
    cy.layout(COSE_LAYOUT).run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collapsed, graph]);

  // Search dims everything that doesn't match instead of hiding it — a
  // lighter touch than filtering outright, and it keeps the layout stable
  // while you type instead of re-flowing the whole graph on every keystroke.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    const term = query.trim().toLowerCase();
    cy.batch(() => {
      if (!term) {
        cy.elements().style("opacity", "");
        return;
      }
      const matchedIds = new Set<string>();
      cy.nodes().forEach((node) => {
        const label = (node.data("label") as string | undefined)?.toLowerCase() ?? "";
        const matches = label.includes(term);
        if (matches) matchedIds.add(node.id());
        node.style("opacity", matches ? 1 : 0.12);
      });
      cy.edges().forEach((edge) => {
        const bothMatch =
          matchedIds.has(edge.source().id()) && matchedIds.has(edge.target().id());
        edge.style("opacity", bothMatch ? 0.55 : 0.05);
      });
    });
  }, [query, graph]);

  const closeNodeMenu = () => setNodeMenu(null);
  const closeFolderMenu = () => setFolderMenu(null);

  const submitRename = async () => {
    if (!renaming) return;
    const value = renaming.value.trim();
    if (!value) {
      setRenaming(null);
      return;
    }
    try {
      await ipc.renameEntry(renaming.rel, value);
      reloadGraph();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
    setRenaming(null);
  };

  const bgMenuItems: MenuItem[] = bgMenu
    ? [
        {
          label: "New note",
          icon: FilePlus,
          onSelect: () => {
            void ipc.createNote("", "Untitled").then((rel) => {
              reloadGraph();
              setView({ type: "note", rel });
            });
          },
        },
      ]
    : [];

  const nodeMenuItems: MenuItem[] = nodeMenu
    ? (() => {
        const pinned = pins.includes(nodeMenu.rel);
        const fullNode = nodeByRel.get(nodeMenu.rel);
        return [
          {
            label: "Open note",
            icon: FileText,
            onSelect: () => setView({ type: "note", rel: nodeMenu.rel }),
          },
          {
            label: pinned ? "Unpin note" : "Pin note",
            icon: pinned ? PinOff : Pin,
            onSelect: () => void togglePin(nodeMenu.rel),
          },
          {
            label: "Reveal in sidebar",
            icon: ScanSearch,
            onSelect: () => expandTo(nodeMenu.rel),
          },
          {
            label: "Rename",
            icon: Pencil,
            onSelect: () =>
              setRenaming({ rel: nodeMenu.rel, kind: "note", value: nodeMenu.title }),
          },
          {
            label: isMac() ? "Reveal in Finder" : "Open file location",
            icon: FolderOpen,
            onSelect: () => {
              if (!root) return;
              void revealItemInDir(`${root}/${nodeMenu.rel}`).catch((error) =>
                toast.error(error instanceof Error ? error.message : String(error)),
              );
            },
          },
          {
            label: "Show info",
            icon: Info,
            onSelect: () => {
              if (fullNode) setInfo({ type: "note", node: fullNode });
            },
          },
        ];
      })()
    : [];

  const folderMenuItems: MenuItem[] = folderMenu
    ? (() => {
        const isCollapsed = collapsed.has(folderMenu.rel);
        const fullFolder = folderByRel.get(folderMenu.rel);
        return [
          {
            label: isCollapsed ? "Expand folder" : "Collapse folder",
            icon: isCollapsed ? Maximize2 : Minimize2,
            onSelect: () =>
              setCollapsed((prev) => {
                const next = new Set(prev);
                if (next.has(folderMenu.rel)) next.delete(folderMenu.rel);
                else next.add(folderMenu.rel);
                return next;
              }),
          },
          {
            label: "Rename",
            icon: Pencil,
            onSelect: () =>
              setRenaming({
                rel: folderMenu.rel,
                kind: "folder",
                value: fullFolder?.name ?? folderMenu.name,
              }),
          },
          {
            label: isMac() ? "Reveal in Finder" : "Open file location",
            icon: FolderOpen,
            onSelect: () => {
              if (!root) return;
              void revealItemInDir(`${root}/${folderMenu.rel}`).catch((error) =>
                toast.error(error instanceof Error ? error.message : String(error)),
              );
            },
          },
          {
            label: "Show info",
            icon: Info,
            onSelect: () => {
              if (fullFolder) setInfo({ type: "folder", folder: fullFolder });
            },
          },
        ];
      })()
    : [];

  return (
    <div className="relative h-full w-full overflow-hidden">
      {loading && (
        <div className="flex h-full items-center justify-center text-[12.5px] text-faint">
          Building graph…
        </div>
      )}
      {!loading && graph && graph.nodes.length === 0 && (
        <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
          <Waypoints size={22} strokeWidth={1.5} className="text-faint" />
          <p className="text-[13px] text-muted">No notes yet</p>
          <p className="max-w-[280px] text-[11.5px] text-faint">
            The graph fills in as you write notes and link between them with
            [[wikilinks]].
          </p>
        </div>
      )}
      {!loading && graph && graph.nodes.length > 0 && (
        <>
          <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md border border-line-soft bg-panel px-2 py-1">
            <Search size={12.5} strokeWidth={1.8} className="text-faint" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter notes…"
              className="w-[140px] bg-transparent text-[11.5px] text-ink outline-none placeholder:text-faint"
            />
          </div>
          <Tooltip label="Fit to view" side="left">
            <button
              type="button"
              onClick={() => cyRef.current?.layout(COSE_LAYOUT).run()}
              className="absolute right-3 top-3 z-10 grid h-7 w-7 place-items-center rounded-md border border-line-soft bg-panel text-faint transition-colors duration-100 hover:bg-hover hover:text-ink"
            >
              <ScanSearch size={13.5} strokeWidth={1.8} />
            </button>
          </Tooltip>
        </>
      )}
      <div ref={containerRef} className="h-full w-full" />
      {nodeMenu && (
        <ContextMenu position={nodeMenu.position} items={nodeMenuItems} onClose={closeNodeMenu} />
      )}
      {folderMenu && (
        <ContextMenu
          position={folderMenu.position}
          items={folderMenuItems}
          onClose={closeFolderMenu}
        />
      )}
      {bgMenu && (
        <ContextMenu position={bgMenu} items={bgMenuItems} onClose={() => setBgMenu(null)} />
      )}
      {info && <InfoPanel target={info} onClose={() => setInfo(null)} />}
      {renaming && (
        <RenameOverlay
          value={renaming.value}
          kind={renaming.kind}
          onChange={(value) => setRenaming({ ...renaming, value })}
          onSubmit={() => void submitRename()}
          onCancel={() => setRenaming(null)}
        />
      )}
    </div>
  );
}

/** Small floating rename prompt — opened from the "Rename" context menu
 * item on either a note or a folder node, confirmed with Enter. */
function RenameOverlay({
  value,
  kind,
  onChange,
  onSubmit,
  onCancel,
}: {
  value: string;
  kind: "note" | "folder";
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="absolute inset-0 z-40" onMouseDown={onCancel}>
      <div
        className="absolute left-1/2 top-1/2 w-[260px] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-line bg-bg p-3 shadow-lg shadow-black/8 dark:shadow-black/40"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="mb-2 text-[12px] font-medium text-muted">
          Rename {kind === "note" ? "note" : "folder"}
        </p>
        <input
          autoFocus
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit();
            if (event.key === "Escape") onCancel();
          }}
          className="h-8 w-full rounded-md border border-line-soft bg-panel px-2.5 text-[12.5px] text-ink outline-none focus-visible:border-ink/40"
        />
      </div>
    </div>
  );
}

/** Small floating card with file/folder metadata — opened from the
 * "Show info" context menu item on either a note or a folder node. */
function InfoPanel({ target, onClose }: { target: InfoTarget; onClose: () => void }) {
  const rows: Array<[string, string]> =
    target.type === "note"
      ? [
          ["Path", target.node.rel],
          ["Type", target.node.kind === "canvas" ? "Canvas" : "Note"],
          ["Connections", String(target.node.degree)],
          ["Created", formatDate(target.node.createdMs)],
          ["Modified", formatDate(target.node.modifiedMs)],
          ["Size", formatBytes(target.node.sizeBytes)],
        ]
      : [
          ["Path", target.folder.rel],
          ["Notes inside", String(target.folder.noteCount)],
          ["Modified", formatDate(target.folder.modifiedMs)],
        ];
  const title = target.type === "note" ? target.node.title : target.folder.name;

  return (
    <div className="absolute inset-0 z-40" onMouseDown={onClose}>
      <div
        className="absolute right-3 top-14 w-[240px] rounded-lg border border-line bg-bg p-3 shadow-lg shadow-black/8 dark:shadow-black/40"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p className="mb-2 truncate text-[13px] font-semibold text-ink">{title}</p>
        <dl className="flex flex-col gap-1.5">
          {rows.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3">
              <dt className="text-[10.5px] uppercase tracking-wide text-faint">{label}</dt>
              <dd className="truncate text-[11.5px] text-muted" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}
