import { ipc } from "@/lib/ipc";

/** Best-effort: a diagnostics call failing should never surface to the
 * person as a second error on top of whatever actually went wrong. */
function record(level: "error" | "warn" | "panic", message: string, context?: string) {
  void ipc.debugLogAdd(level, "frontend", message, context).catch(() => {});
}

/** Installed once, at app startup — catches anything that would otherwise
 * only ever show up in a devtools console nobody's watching. */
export function installGlobalErrorCapture() {
  window.addEventListener("error", (event) => {
    record("error", event.message, event.error?.stack);
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const context = reason instanceof Error ? reason.stack : undefined;
    record("error", `Unhandled promise rejection: ${message}`, context);
  });
}

/** For call sites that already catch an error themselves (like
 * `ErrorBoundary`) and want it in the log without waiting for it to
 * surface as an uncaught exception. */
export function logCaughtError(message: string, context?: string) {
  record("error", message, context);
}
