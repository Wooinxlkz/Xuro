import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { create } from "zustand";
import { shouldShowReleaseNotes } from "@/lib/updateRelease";

/**
 * Update checks go straight to the GitHub Releases API instead of a signed
 * updater manifest — no dependency on usexuro.app being deployed, no
 * artifact signing to keep in sync. "Update" means: open the browser to
 * download the new installer; there's no silent in-place install.
 */
const REPO = "Wooinxlkz/Xuro";
const RELEASES_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE_URL = `https://github.com/${REPO}/releases/latest`;

type Status = "idle" | "checking" | "available" | "error";

export interface ReleaseInfo {
  version: string;
  htmlUrl: string;
  downloadUrl: string | null;
  body: string;
}

interface UpdaterState {
  status: Status;
  release: ReleaseInfo | null;
  releaseNotesOpen: boolean;
  /** Look for a newer release. `silent` swallows "up to date"/failure noise. */
  check: (opts?: { silent?: boolean }) => Promise<void>;
  /** Show feature notes first, or go straight to the download for a fix-only release. */
  requestDownload: () => Promise<void>;
  /** Open the installer download (or the release page) in the default browser. */
  download: () => Promise<void>;
  dismissReleaseNotes: () => void;
}

function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

export const useUpdater = create<UpdaterState>((set, get) => ({
  status: "idle",
  release: null,
  releaseNotesOpen: false,

  check: async ({ silent = true } = {}) => {
    if (get().status === "checking") return;
    set({ status: "checking", releaseNotesOpen: false });
    try {
      const currentVersion = await getVersion();
      const response = await fetch(RELEASES_API_URL, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) {
        throw new Error(`GitHub returned ${response.status}`);
      }
      const data = await response.json();
      const latestVersion = String(data.tag_name ?? "").replace(/^v/, "");

      if (!latestVersion || !isNewer(latestVersion, currentVersion)) {
        set({ status: "idle", release: null, releaseNotesOpen: false });
        if (!silent) toast("You're on the latest version.");
        return;
      }

      const assets: Array<{ name?: unknown; browser_download_url?: unknown }> =
        Array.isArray(data.assets) ? data.assets : [];
      const installer = assets.find(
        (asset) => typeof asset.name === "string" && asset.name.endsWith("-setup.exe"),
      );

      set({
        status: "available",
        release: {
          version: latestVersion,
          htmlUrl: typeof data.html_url === "string" ? data.html_url : RELEASES_PAGE_URL,
          downloadUrl:
            typeof installer?.browser_download_url === "string"
              ? installer.browser_download_url
              : null,
          body: typeof data.body === "string" ? data.body : "",
        },
        releaseNotesOpen: false,
      });
    } catch (err) {
      set({ status: "error", release: null, releaseNotesOpen: false });
      if (!silent) {
        toast.error(err instanceof Error ? err.message : "Update check failed.");
      }
    }
  },

  requestDownload: async () => {
    const release = get().release;
    if (!release || get().status !== "available") return;
    const currentVersion = await getVersion();
    if (
      shouldShowReleaseNotes({
        currentVersion,
        version: release.version,
        body: release.body,
      })
    ) {
      set({ releaseNotesOpen: true });
      return;
    }
    await get().download();
  },

  download: async () => {
    const release = get().release;
    if (!release) return;
    await openUrl(release.downloadUrl ?? release.htmlUrl);
  },

  dismissReleaseNotes: () => set({ releaseNotesOpen: false }),
}));
