import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ipc } from "@/lib/ipc";

const SAVE_DEBOUNCE_MS = 800;

export function CanvasEditor({ rel }: { rel: string }) {
  const [initialData, setInitialData] = useState<ExcalidrawInitialDataState | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDark =
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark");

  useEffect(() => {
    let cancelled = false;
    setInitialData(null);
    setError(null);
    ipc
      .canvasRead(rel)
      .then((raw) => {
        if (cancelled) return;
        try {
          setInitialData(JSON.parse(raw) as ExcalidrawInitialDataState);
        } catch {
          setInitialData({ elements: [], appState: {} });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [rel]);

  const handleChange = (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const payload = JSON.stringify({
        type: "excalidraw",
        version: 2,
        source: "xuro",
        elements,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          gridSize: appState.gridSize,
        },
        files,
      });
      void ipc.canvasWrite(rel, payload).catch((err) => {
        toast.error(err instanceof Error ? err.message : String(err));
      });
    }, SAVE_DEBOUNCE_MS);
  };

  if (error) {
    return (
      <div className="grid h-full place-items-center">
        <p className="text-[12.5px] text-danger">{error}</p>
      </div>
    );
  }

  if (!initialData) return null;

  return (
    <div className="h-full w-full">
      <Excalidraw
        key={rel}
        initialData={initialData}
        theme={isDark ? "dark" : "light"}
        onChange={handleChange}
      />
    </div>
  );
}
