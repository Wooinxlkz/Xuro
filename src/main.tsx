import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { QuickCaptureWindow } from "./components/capture/QuickCaptureWindow";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./styles.css";
import { queryClient } from "./lib/queryClient";
import { installGlobalErrorCapture } from "./lib/debugLog";

// Kill macOS autocorrect/autocapitalize/spellcheck in every text field.
document.addEventListener("focusin", (event) => {
  const el = event.target;
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.setAttribute("autocorrect", "off");
    el.setAttribute("autocomplete", "off");
    el.autocapitalize = "off";
    el.spellcheck = false;
  }
});

// Xuro renders every menu itself (ContextMenu, right-click menus in the
// tree, the graph, etc.) — the OS/webview's own native context menu never
// belongs anywhere in the app. Blocking it once here, globally, is more
// reliable than relying on every component to remember `onContextMenu={e
// => e.preventDefault()}` individually, which is what let it slip through
// on the graph view before.
document.addEventListener("contextmenu", (event) => event.preventDefault());

installGlobalErrorCapture();

const Root = getCurrentWindow().label === "quick-capture" ? QuickCaptureWindow : App;

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <Root />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
