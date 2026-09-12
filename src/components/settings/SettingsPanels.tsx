import {
  ArrowDownToLine,
  CheckCircle2,
  Copy,
  FolderOpen,
  Globe2,
  HardDrive,
  Loader2,
  Lock,
  Mail,
  Monitor,
  Moon,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sun,
  Trash2,
  XCircle,
} from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { version as appVersion } from "../../../package.json";
import { ipc } from "@/lib/ipc";
import type {
  DebugEntry,
  AccentColor,
  BackgroundStyle,
  CloudAccount,
  HealthCheck,
  ObsidianImportSummary,
  Theme,
} from "@/lib/types";
import {
  findShortcutConflict,
  formatShortcutParts,
  sameShortcut,
  shortcutFromEvent,
  SHORTCUT_DEFINITIONS,
  type ShortcutAction,
  type ShortcutBinding,
} from "@/lib/shortcuts";
import { cx, isMac } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Spinner } from "@/components/ui/Spinner";
import { CloudAccountCard } from "@/components/settings/CloudAccountCard";
import { openCloudBillingPortal, openCloudPlans } from "@/lib/cloud";
import { useShortcuts } from "@/stores/shortcuts";
import { useUpdater } from "@/stores/updater";
import { lockDisplayName, useLocks } from "@/stores/locks";
import { useVault } from "@/stores/vault";

const THEMES: Array<{
  value: Theme;
  label: string;
  description: string;
  icon: typeof Sun;
}> = [
  {
    value: "system",
    label: "System",
    description: "Match your system",
    icon: Monitor,
  },
  {
    value: "light",
    label: "Light",
    description: "Bright canvas",
    icon: Sun,
  },
  {
    value: "dark",
    label: "Dark",
    description: "Low light",
    icon: Moon,
  },
];

const ACCENT_COLORS: Array<{
  value: Exclude<AccentColor, "custom" | "default">;
  label: string;
  swatch: string;
}> = [
  { value: "blue", label: "Blue", swatch: "oklch(0.55 0.16 255)" },
  { value: "green", label: "Green", swatch: "oklch(0.5 0.13 150)" },
  { value: "purple", label: "Purple", swatch: "oklch(0.5 0.17 300)" },
  { value: "red", label: "Red", swatch: "oklch(0.55 0.19 25)" },
  { value: "orange", label: "Orange", swatch: "oklch(0.62 0.17 55)" },
];

const BACKGROUND_STYLES: Array<{
  value: BackgroundStyle;
  label: string;
  description: string;
  preview: string;
}> = [
  { value: "default", label: "Default", description: "Cool neutral canvas", preview: "#fbfbfa" },
  { value: "cream", label: "Cream", description: "Warm paper tone", preview: "#faf6ec" },
  { value: "soft", label: "Soft", description: "Muted warm gray", preview: "#f7f6f3" },
  { value: "mossy-hollow", label: "Mossy Hollow", description: "Sage green canvas", preview: "#f3f6ee" },
  { value: "chocolate-truffle", label: "Chocolate Truffle", description: "Warm cocoa tone", preview: "#f7f1ec" },
  { value: "ink-wash", label: "Ink Wash", description: "Cool grey wash", preview: "#f4f5f6" },
];

export function GeneralSettings() {
  const root = useVault((state) => state.root);
  const chooseVault = useVault((state) => state.chooseVault);
  const refreshTree = useVault((state) => state.refreshTree);
  const updateStatus = useUpdater((state) => state.status);
  const updateRelease = useUpdater((state) => state.release);
  const checkUpdate = useUpdater((state) => state.check);
  const requestDownload = useUpdater((state) => state.requestDownload);
  const lockedItems = useLocks((state) => state.locked);
  const removeLock = useLocks((state) => state.remove);
  const [removingLock, setRemovingLock] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ObsidianImportSummary | null>(
    null,
  );

  const handleImportObsidian = async () => {
    setImporting(true);
    setImportResult(null);
    try {
      const summary = await ipc.importObsidianVault();
      if (summary) {
        setImportResult(summary);
        await refreshTree();
        toast.success(
          `Imported ${summary.notesImported} note${summary.notesImported === 1 ? "" : "s"}`,
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };

  const handleRemoveLock = async (rel: string) => {
    setRemovingLock(rel);
    try {
      await removeLock(rel);
      toast.success(`PIN removed for "${lockDisplayName(rel)}".`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRemovingLock(null);
    }
  };

  const updateCopy =
    updateStatus === "available"
      ? `Version ${updateRelease?.version} is available`
      : updateStatus === "checking"
        ? "Checking for updates…"
        : updateStatus === "error"
          ? "Couldn't check for updates"
          : "You're on the latest version";

  return (
    <div className="space-y-6">
      <SettingsGroup
        title="Vault"
        description="The folder Xuro uses for notes and local app data."
      >
        <div className="flex items-center gap-3 rounded-xl bg-panel p-3">
          <p
            title={root}
            className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted"
          >
            {root}
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={chooseVault}
            className="shrink-0 bg-bg"
          >
            <FolderOpen size={13.5} strokeWidth={1.75} />
            Change
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Import"
        description="Bring notes in from another app. Imported into a new top-level folder — nothing existing gets overwritten."
      >
        <div className="flex flex-col gap-2.5 rounded-xl bg-panel p-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[12.5px] font-medium text-ink">Obsidian vault</p>
              <p className="mt-0.5 text-[11px] text-faint">
                Copies notes and image attachments, converts embeds, keeps
                [[wikilinks]] working as-is.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleImportObsidian()}
              loading={importing}
              className="shrink-0 bg-bg"
            >
              <ArrowDownToLine size={13} strokeWidth={1.75} />
              Import…
            </Button>
          </div>
          {importResult && (
            <div className="rounded-lg border border-line-soft bg-bg px-3 py-2 text-[11.5px] text-muted">
              Imported {importResult.notesImported} note
              {importResult.notesImported === 1 ? "" : "s"} and{" "}
              {importResult.attachmentsImported} attachment
              {importResult.attachmentsImported === 1 ? "" : "s"} into "
              {importResult.folder}".
              {importResult.skipped.length > 0 && (
                <>
                  {" "}
                  Couldn't read {importResult.skipped.length} file
                  {importResult.skipped.length === 1 ? "" : "s"}.
                </>
              )}
            </div>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Software updates"
        description="Keep Xuro current with the latest fixes and improvements."
      >
        <div className="flex items-center justify-between gap-4 rounded-xl bg-panel p-3">
            <p aria-live="polite" className="min-w-0 text-[12.5px] text-muted">
              {updateCopy}
            </p>
            {updateStatus === "available" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void requestDownload()}
                className="shrink-0 bg-bg"
              >
                <ArrowDownToLine size={13} strokeWidth={1.75} />
                Download
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => checkUpdate({ silent: false })}
                disabled={updateStatus === "checking"}
                className="shrink-0 bg-bg"
              >
                {updateStatus === "checking" ? (
                  <Spinner size={14} />
                ) : (
                  <RefreshCw size={13} strokeWidth={1.75} />
                )}
                Check
              </Button>
            )}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Locked notes & folders"
        description="Forgot a PIN? Remove the lock here — no PIN needed, unlike removing it from the right-click menu."
      >
        {lockedItems.length === 0 ? (
          <p className="text-[12.5px] text-faint">Nothing is locked right now.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {lockedItems.map((rel) => (
              <div
                key={rel}
                className="flex items-center gap-3 rounded-xl bg-panel p-3"
              >
                <Lock size={14} strokeWidth={1.75} className="shrink-0 text-faint" />
                <p
                  title={rel}
                  className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-muted"
                >
                  {lockDisplayName(rel)}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={removingLock === rel}
                  onClick={() => void handleRemoveLock(rel)}
                  className="shrink-0 bg-bg"
                >
                  {removingLock === rel ? <Spinner size={14} /> : null}
                  Remove PIN
                </Button>
              </div>
            ))}
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}

export function CloudSettings() {
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [billingBusy, setBillingBusy] = useState<"plans" | "portal" | null>(null);

  const openBilling = (kind: "plans" | "portal", action: () => Promise<void>) => {
    setBillingBusy(kind);
    void action()
      .catch((cause) => {
        toast.error(cause instanceof Error ? cause.message : "Billing could not be opened.");
      })
      .finally(() => setBillingBusy(null));
  };

  return (
    <div className="space-y-6">
      <SettingsGroup
        title="Account"
        description="Sign in once to manage public pages and future synced devices."
      >
        <CloudAccountCard onAccountChange={setAccount} />
      </SettingsGroup>

      <SettingsGroup
        title="Subscription"
        description="Your Xuro Cloud access for publishing and future sync."
      >
        <div className="flex items-center gap-3 rounded-xl bg-panel p-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line bg-bg text-muted">
            <Globe2 size={15.5} strokeWidth={1.7} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="text-[12.5px] font-semibold text-ink">Xuro Cloud</p>
              {account?.plan === "cloud" && (
                <StatusBadge tone="success">Active</StatusBadge>
              )}
            </div>
            <p className="mt-0.5 text-[10.5px] text-faint">
              {account?.plan === "cloud"
                ? "Publishing is active for this account."
                : "Publish connected notes and hosted images on the web."}
            </p>
          </div>
          {account?.plan === "cloud" ? (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 bg-bg"
              loading={billingBusy === "portal"}
              disabled={Boolean(billingBusy)}
              onClick={() => openBilling("portal", openCloudBillingPortal)}
            >
              {billingBusy === "portal" ? "Opening…" : "Manage billing"}
            </Button>
          ) : account ? (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 bg-bg"
              loading={billingBusy === "plans"}
              disabled={Boolean(billingBusy)}
              onClick={() => openBilling("plans", openCloudPlans)}
            >
              {billingBusy === "plans" ? "Opening…" : "View plans"}
            </Button>
          ) : null}
        </div>
        <p className="mt-2.5 text-[10.5px] text-faint">
          Billing and subscription changes are managed on the web.
        </p>
      </SettingsGroup>
    </div>
  );
}

export function AppearanceSettings() {
  const theme = useVault((state) => state.theme);
  const setTheme = useVault((state) => state.setTheme);
  const accentColor = useVault((state) => state.accentColor);
  const accentCustomHex = useVault((state) => state.accentCustomHex);
  const setAccentColor = useVault((state) => state.setAccentColor);
  const backgroundStyle = useVault((state) => state.backgroundStyle);
  const setBackgroundStyle = useVault((state) => state.setBackgroundStyle);
  const mac = isMac();
  const cycleTheme = useShortcuts((state) => state.bindings.cycleTheme);

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup
        title="Theme"
        description="Choose how Xuro looks across the editor and navigation."
        aside={
          <span className="flex items-center text-[10.5px] text-faint">
            <ShortcutKeys shortcut={cycleTheme} mac={mac} />
            <span className="ml-1.5">to cycle</span>
          </span>
        }
      >
        <div role="group" aria-label="Theme" className="grid grid-cols-3 gap-2">
          {THEMES.map(({ value, label, description, icon: Icon }) => {
            const active = theme === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setTheme(value)}
                className={cx(
                  "flex min-h-24 flex-col items-start rounded-xl p-3 text-left transition-colors duration-100",
                  active
                    ? "bg-invert text-invert-ink"
                    : "bg-panel text-muted hover:bg-hover hover:text-ink",
                )}
              >
                <Icon size={17} strokeWidth={1.7} />
                <span className="mt-auto text-[12.5px] font-semibold">{label}</span>
                <span
                  className={cx(
                    "mt-0.5 text-[10.5px]",
                    active ? "text-invert-ink/65" : "text-faint",
                  )}
                >
                  {description}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Accent color"
        description="A subtle accent for selection, checkmarks, and highlights. Everything else stays monochrome."
      >
        <div role="group" aria-label="Accent color" className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            aria-label="Default (monochrome)"
            aria-pressed={accentColor === "default"}
            onClick={() => setAccentColor("default")}
            className={cx(
              "grid h-8 w-8 place-items-center rounded-full border-2 transition-colors",
              accentColor === "default"
                ? "border-ink"
                : "border-transparent hover:border-line",
            )}
          >
            <span className="h-5 w-5 rounded-full bg-invert" />
          </button>
          {ACCENT_COLORS.map(({ value, label, swatch }) => {
            const active = accentColor === value;
            return (
              <button
                key={value}
                type="button"
                aria-label={label}
                aria-pressed={active}
                onClick={() => setAccentColor(value)}
                className={cx(
                  "grid h-8 w-8 place-items-center rounded-full border-2 transition-colors",
                  active ? "border-ink" : "border-transparent hover:border-line",
                )}
              >
                <span className="h-5 w-5 rounded-full" style={{ backgroundColor: swatch }} />
              </button>
            );
          })}
          <CustomAccentSwatch
            accentColor={accentColor}
            customHex={accentCustomHex}
            setAccentColor={setAccentColor}
          />
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Background"
        description="Retint the canvas and panels. Applies in both light and dark."
      >
        <div role="group" aria-label="Background" className="grid grid-cols-3 gap-2">
          {BACKGROUND_STYLES.map(({ value, label, description, preview }) => {
            const active = backgroundStyle === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setBackgroundStyle(value)}
                className={cx(
                  "flex min-h-20 flex-col items-start rounded-xl p-3 text-left transition-colors duration-100",
                  active
                    ? "bg-invert text-invert-ink"
                    : "bg-panel text-muted hover:bg-hover hover:text-ink",
                )}
              >
                <span
                  className="h-4 w-4 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: preview }}
                />
                <span className="mt-auto text-[12.5px] font-semibold">{label}</span>
                <span
                  className={cx(
                    "mt-0.5 text-[10.5px]",
                    active ? "text-invert-ink/65" : "text-faint",
                  )}
                >
                  {description}
                </span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>
    </div>
  );
}

function CustomAccentSwatch({
  accentColor,
  customHex,
  setAccentColor,
}: {
  accentColor: AccentColor;
  customHex: string | null;
  setAccentColor: (accent: AccentColor, customHex?: string) => Promise<void>;
}) {
  const isCustom = accentColor === "custom";
  return (
    <button
      type="button"
      aria-label="Custom accent color"
      aria-pressed={isCustom}
      className={cx(
        "relative grid h-8 w-8 place-items-center rounded-full border-2 transition-colors",
        isCustom ? "border-ink" : "border-transparent hover:border-line",
      )}
    >
      <span
        className="h-5 w-5 rounded-full"
        style={
          isCustom && customHex
            ? { backgroundColor: customHex }
            : {
                background:
                  "conic-gradient(from 180deg, #d45b55, #b7791f, #3f8f62, #4f7fd1, #8a63c5, #d45b55)",
              }
        }
      />
      <input
        type="color"
        aria-label="Pick a custom accent color"
        value={isCustom && customHex ? customHex : "#4f7fd1"}
        className="absolute inset-0 h-full w-full cursor-pointer rounded-full opacity-0"
        onChange={(event) => setAccentColor("custom", event.target.value)}
      />
    </button>
  );
}

export function ShortcutSettings() {
  const mac = isMac();
  const bindings = useShortcuts((state) => state.bindings);
  const setBinding = useShortcuts((state) => state.setBinding);
  const resetBinding = useShortcuts((state) => state.resetBinding);
  const resetAll = useShortcuts((state) => state.resetAll);
  const [editing, setEditing] = useState<ShortcutAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onCapture = (action: ShortcutAction, event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.key === "Escape") {
      setEditing(null);
      setError(null);
      return;
    }
    const shortcut = shortcutFromEvent(event);
    if (!shortcut) {
      setError("Use Command, Control, or Option with a key.");
      return;
    }
    const fixedConflict = fixedShortcutConflict(shortcut, mac);
    if (fixedConflict) {
      setError(`Already used by ${fixedConflict}.`);
      return;
    }
    const conflict = findShortcutConflict(bindings, shortcut, action);
    if (conflict) {
      setError(`Already used by ${conflict.label}.`);
      return;
    }
    setBinding(action, shortcut);
    setEditing(null);
    setError(null);
  };

  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event: KeyboardEvent) => onCapture(editing, event);
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [bindings, editing, mac]);

  return (
    <SettingsGroup
      title="Keyboard shortcuts"
      description="Click a shortcut, then press the new key combination."
      aside={
        <Button variant="ghost" size="sm" onClick={resetAll}>
          <RotateCcw size={13} strokeWidth={1.8} />
          Reset all
        </Button>
      }
    >
      <div className="overflow-hidden rounded-xl bg-panel">
        {SHORTCUT_DEFINITIONS.map((shortcut, index) => (
          <div
            key={shortcut.id}
            className={cx(
              "flex min-h-10 items-center justify-between gap-4 px-3.5 py-2 text-[12.5px] text-muted",
              index > 0 && "border-t border-line-soft",
            )}
          >
            <span>{shortcut.label}</span>
            <div className="flex shrink-0 items-center gap-1.5">
              <ShortcutCapture
                label={shortcut.label}
                shortcut={bindings[shortcut.id]}
                mac={mac}
                editing={editing === shortcut.id}
                onStart={() => {
                  setEditing(shortcut.id);
                  setError(null);
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Reset ${shortcut.label}`}
                onClick={() => resetBinding(shortcut.id)}
              >
                <RotateCcw size={12.5} strokeWidth={1.8} />
              </Button>
            </div>
          </div>
        ))}
        <ReadonlyShortcutRow
          label="Quick capture"
          keys={mac ? ["⌃", "⇧", "Space"] : ["Ctrl", "Shift", "Space"]}
        />
        <ReadonlyShortcutRow
          label="Open note tab"
          keys={mac ? ["⌘", "1-9"] : ["Ctrl", "1-9"]}
        />
      </div>
      {error && (
        <p aria-live="polite" className="mt-2 text-[11.5px] text-danger">
          {error}
        </p>
      )}
    </SettingsGroup>
  );
}

const REPO_URL = "https://github.com/Wooinxlkz/Xuro";
const NULLTRACE_URL = "https://github.com/Wooinxlkz";
const SITE_URL = "https://usexuro.app";
const DOWNLOAD_URL = "https://github.com/Wooinxlkz/Xuro/releases/latest";

const FEATURES = [
  "Plain markdown files on your disk — no proprietary format, no lock-in",
  "PIN locks for private notes and folders",
  "Daily Notes, Tags, Kanban board, and Snippets",
  "A real Excalidraw canvas, saved as a normal .excalidraw file",
  "Quick Capture from anywhere with a global shortcut",
  "Backlinks, full-text search, and a command palette",
  "Optional Xuro Cloud for publishing notes to the web",
];

const SHARE_TEXT = "Xuro — a fast, local-first Markdown notes app.";

function share(kind: "x" | "facebook" | "email" | "instagram") {
  if (kind === "x") {
    void openUrl(
      `https://twitter.com/intent/tweet?url=${encodeURIComponent(SITE_URL)}&text=${encodeURIComponent(SHARE_TEXT)}`,
    );
    return;
  }
  if (kind === "facebook") {
    void openUrl(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SITE_URL)}`,
    );
    return;
  }
  if (kind === "email") {
    void openUrl(
      `mailto:?subject=${encodeURIComponent("Check out Xuro")}&body=${encodeURIComponent(`${SHARE_TEXT}\n\n${SITE_URL}`)}`,
    );
    return;
  }
  // Instagram has no web share-intent for arbitrary links, so copy the
  // link instead — it can be pasted into a bio or story sticker.
  void navigator.clipboard.writeText(DOWNLOAD_URL);
  toast.success("Link copied — paste it into an Instagram bio or story.");
}

export function AboutSettings() {
  return (
    <div className="space-y-6">
      <SettingsGroup title="Xuro" description="A fast, local-first Markdown notes app.">
        <div className="overflow-hidden rounded-xl border border-line-soft bg-panel">
          <div className="flex items-center gap-3 border-b border-line-soft p-4">
            <img src="/logo.svg" alt="" className="h-10 w-10 shrink-0" />
            <div className="min-w-0">
              <p className="text-[13.5px] font-semibold text-ink">Xuro</p>
              <p className="mt-0.5 font-mono text-[11px] text-faint">
                Version {appVersion}
              </p>
            </div>
          </div>
          <ul className="divide-y divide-line-soft">
            {FEATURES.map((feature) => (
              <li
                key={feature}
                className="px-4 py-2.5 text-[12px] leading-5 text-muted"
              >
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Made by"
        description="Xuro is built and maintained independently."
      >
        <div className="flex items-center gap-3 rounded-xl bg-panel p-3">
          <div className="min-w-0 flex-1 text-[12.5px] text-muted">
            Created by{" "}
            <button
              type="button"
              onClick={() => void openUrl(NULLTRACE_URL)}
              className="font-medium text-ink underline decoration-line-soft underline-offset-2 hover:decoration-ink"
            >
              NullTrace
            </button>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openUrl(REPO_URL)}
            className="shrink-0 bg-bg"
          >
            <ShieldCheck size={13} strokeWidth={1.75} />
            View source
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup
        title="Recommend Xuro"
        description="Know someone who'd like a fast, local-first notes app? Share it."
      >
        <div className="flex flex-col gap-3 rounded-xl border border-line-soft bg-panel p-4">
          <div className="flex items-center gap-3 rounded-lg bg-gradient-to-br from-panel to-bg p-4">
            <img src="/logo.svg" alt="" className="h-9 w-9 shrink-0" />
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold text-ink">
                usexuro.app
              </p>
              <p className="mt-0.5 truncate text-[11px] text-faint">
                {SHARE_TEXT}
              </p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <ShareButton label="X" onClick={() => share("x")}>
              <XLogo />
            </ShareButton>
            <ShareButton label="Facebook" onClick={() => share("facebook")}>
              <FacebookLogo />
            </ShareButton>
            <ShareButton label="Email" onClick={() => share("email")}>
              <Mail size={15} strokeWidth={1.8} />
            </ShareButton>
            <ShareButton label="Instagram" onClick={() => share("instagram")}>
              <InstagramLogo />
            </ShareButton>
          </div>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(DOWNLOAD_URL);
              toast.success("Link copied.");
            }}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-line bg-bg py-2 text-[11.5px] font-medium text-muted transition-colors duration-100 hover:bg-hover hover:text-ink"
          >
            <Copy size={12.5} strokeWidth={1.8} />
            Copy download link
          </button>
        </div>
      </SettingsGroup>
    </div>
  );
}

function ShareButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={`Share on ${label}`}
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-lg border border-line bg-bg py-2.5 text-faint transition-colors duration-100 hover:border-line hover:bg-hover hover:text-ink"
    >
      {children}
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

function XLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function FacebookLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M22 12.06C22 6.505 17.523 2 12 2S2 6.505 2 12.06c0 5.02 3.657 9.184 8.438 9.94v-7.03H7.898v-2.91h2.54V9.845c0-2.507 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562v1.877h2.773l-.443 2.91h-2.33V22c4.78-.756 8.437-4.92 8.437-9.94z" />
    </svg>
  );
}

function InstagramLogo() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function fixedShortcutConflict(shortcut: ShortcutBinding, mac: boolean) {
  const mod = mac ? { meta: true } : { ctrl: true };
  if (
    !shortcut.alt &&
    !shortcut.shift &&
    sameShortcut(shortcut, { ...mod, key: shortcut.key }) &&
    /^[1-9]$/.test(shortcut.key)
  ) {
    return "Open note tab";
  }
  if (
    sameShortcut(shortcut, {
      ctrl: true,
      shift: true,
      key: "Space",
    })
  ) {
    return "Quick capture";
  }
  return null;
}

function SettingsGroup({
  title,
  description,
  aside,
  children,
}: {
  title: string;
  description: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex min-h-10 items-start justify-between gap-4">
        <div>
          <h4 className="text-[12.5px] font-semibold text-ink">{title}</h4>
          <p className="mt-1 text-[11.5px] leading-4 text-faint">{description}</p>
        </div>
        {aside}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-grid h-5 min-w-5 place-items-center rounded border border-line bg-bg px-1 font-mono text-[10.5px] text-muted">
      {children}
    </kbd>
  );
}

function ShortcutKeys({
  shortcut,
  mac,
}: {
  shortcut: ShortcutBinding;
  mac: boolean;
}) {
  return (
    <>
      {formatShortcutParts(shortcut, mac).map((key, index) => (
        <Kbd key={`${key}-${index}`}>{key}</Kbd>
      ))}
    </>
  );
}

function ShortcutCapture({
  label,
  shortcut,
  mac,
  editing,
  onStart,
}: {
  label: string;
  shortcut: ShortcutBinding;
  mac: boolean;
  editing: boolean;
  onStart: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Change ${label} shortcut`}
      onClick={onStart}
      className={cx(
        "inline-flex h-7 min-w-[104px] items-center justify-center gap-1 rounded-md border px-2 font-mono text-[10.5px] transition-colors duration-100",
        editing
          ? "border-ink bg-bg text-ink"
          : "border-line bg-bg text-muted hover:border-line hover:bg-hover hover:text-ink",
      )}
    >
      {editing ? "Press keys" : <ShortcutKeys shortcut={shortcut} mac={mac} />}
    </button>
  );
}

function ReadonlyShortcutRow({
  label,
  keys,
}: {
  label: string;
  keys: string[];
}) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 border-t border-line-soft px-3.5 py-2 text-[12.5px] text-muted">
      <span>{label}</span>
      <span className="flex shrink-0 items-center gap-1 opacity-70">
        {keys.map((key, index) => (
          <Kbd key={`${label}-${key}-${index}`}>{key}</Kbd>
        ))}
      </span>
    </div>
  );
}

export function DebugSettings() {
  const [entries, setEntries] = useState<DebugEntry[] | null>(null);
  const [clearing, setClearing] = useState(false);
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const load = () => {
    void ipc.debugLogList().then(setEntries).catch(() => setEntries([]));
  };

  const runHealthCheck = () => {
    setCheckingHealth(true);
    void ipc
      .debugHealthCheck()
      .then(setHealth)
      .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
      .finally(() => setCheckingHealth(false));
  };

  useEffect(load, []);
  useEffect(runHealthCheck, []);

  const clear = async () => {
    setClearing(true);
    try {
      await ipc.debugLogClear();
      setEntries([]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setClearing(false);
    }
  };

  const copyAll = () => {
    if (!entries || entries.length === 0) return;
    const text = entries
      .map((e) => `[${new Date(e.atMs).toISOString()}] ${e.level} (${e.source}): ${e.message}`)
      .join("\n");
    void navigator.clipboard.writeText(text);
    toast.success("Copied");
  };

  return (
    <div className="space-y-6">
      <SettingsGroup
        title="Connection health"
        description="A quick check for the most common causes of 'Xuro seems broken' — your internet, the Online Manga catalog, and whether your vault folder can still be written to."
        aside={
          <Button
            variant="secondary"
            size="sm"
            loading={checkingHealth}
            onClick={runHealthCheck}
          >
            <RefreshCw size={12.5} strokeWidth={1.75} />
            Run
          </Button>
        }
      >
        <div className="overflow-hidden rounded-xl border border-line-soft bg-panel">
          <HealthRow
            label="Internet connection"
            detail="Reaching the open internet at all"
            checking={checkingHealth}
            ok={health?.internet ?? null}
            icon={Globe2}
          />
          <HealthRow
            label="Online Manga catalog"
            detail="MangaDex — powers browsing, following, and reading online manga"
            checking={checkingHealth}
            ok={health?.mangaCatalog ?? null}
            icon={ShieldCheck}
          />
          <HealthRow
            label="Vault storage"
            detail={
              health?.vaultWritable === null
                ? "No vault is open right now"
                : "Your vault folder can be written to"
            }
            checking={checkingHealth}
            ok={health?.vaultWritable ?? null}
            icon={HardDrive}
            last
          />
        </div>
        {health && (
          <p className="mt-2 text-[10.5px] text-faint">
            Last checked {new Date(health.checkedAt).toLocaleTimeString()}
            {!health.internet &&
              " — if this is the only thing failing, it's almost certainly your network or a firewall, not Xuro."}
            {health.internet &&
              !health.mangaCatalog &&
              " — your internet's fine, but MangaDex isn't reachable right now (it may be down, or blocked by a firewall/VPN)."}
          </p>
        )}
      </SettingsGroup>

      <SettingsGroup
        title="Diagnostics"
        description="Unexpected errors Xuro has run into, kept locally with a timestamp — nothing here is sent anywhere."
        aside={
          entries && entries.length > 0 ? (
            <div className="flex gap-1.5">
              <Button variant="secondary" size="sm" onClick={copyAll}>
                <Copy size={12.5} strokeWidth={1.75} />
                Copy all
              </Button>
              <Button variant="secondary" size="sm" loading={clearing} onClick={() => void clear()}>
                <Trash2 size={12.5} strokeWidth={1.75} />
                Clear
              </Button>
            </div>
          ) : undefined
        }
      >
        {entries === null ? (
          <p className="py-6 text-center text-[12px] text-faint">Loading…</p>
        ) : entries.length === 0 ? (
          <div className="rounded-xl border border-line-soft bg-panel px-4 py-8 text-center">
            <p className="text-[12.5px] text-muted">No errors recorded</p>
            <p className="mt-1 text-[11px] text-faint">
              That's a good sign — this fills in automatically if something goes wrong.
            </p>
          </div>
        ) : (
          <div className="max-h-[360px] overflow-auto rounded-xl border border-line-soft bg-panel">
            <ul className="divide-y divide-line-soft">
              {entries.map((entry) => (
                <li key={entry.id} className="px-3.5 py-2.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide ${
                        entry.level === "panic"
                          ? "bg-danger/10 text-danger"
                          : entry.level === "warn"
                            ? "bg-amber-500/10 text-amber-600"
                            : "bg-danger/10 text-danger"
                      }`}
                    >
                      {entry.level}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide text-faint">
                      {entry.source}
                    </span>
                    <span className="ml-auto text-[10.5px] text-faint">
                      {new Date(entry.atMs).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 break-words font-mono text-[11.5px] leading-5 text-muted">
                    {entry.message}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SettingsGroup>
    </div>
  );
}

function HealthRow({
  label,
  detail,
  checking,
  ok,
  icon: Icon,
  last = false,
}: {
  label: string;
  detail: string;
  checking: boolean;
  ok: boolean | null;
  icon: typeof Globe2;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-3.5 py-2.5 ${last ? "" : "border-b border-line-soft"}`}
    >
      <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-sunken text-faint">
        <Icon size={14} strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium text-ink">{label}</p>
        <p className="truncate text-[11px] text-faint">{detail}</p>
      </div>
      {checking ? (
        <Loader2 size={15} className="shrink-0 animate-spin text-faint" />
      ) : ok === null ? (
        <span className="shrink-0 text-[11px] text-faint">—</span>
      ) : ok ? (
        <CheckCircle2 size={16} strokeWidth={1.75} className="shrink-0 text-success" />
      ) : (
        <XCircle size={16} strokeWidth={1.75} className="shrink-0 text-danger" />
      )}
    </div>
  );
}
