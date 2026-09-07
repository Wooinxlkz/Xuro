# Security Policy

Xuro is a local-first app: your notes live on your disk, and by default nothing leaves your machine. Xuro Cloud (publishing, billing) is the one part of the system that talks to a server, so most of what matters here is about that surface and about the desktop app's update/install path.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a suspected security vulnerability.** Public issues are indexed and searchable, and a live report can be used before it's fixed.

Instead, report it privately:

- Preferred: open a [GitHub Security Advisory](https://github.com/Wooinxlkz/Xuro/security/advisories/new) for this repository (private by default, visible only to maintainers until resolved).
- Alternative: email the maintainer listed on the [GitHub profile](https://github.com/Wooinxlkz) with a subject line starting `[SECURITY]`.

Please include:

- A clear description of the issue and its impact.
- Steps to reproduce, or a proof of concept if you have one.
- The Xuro version and platform you tested on (Settings → About in the app, or the installer filename).

You should get an acknowledgment within a few days. This is a small, actively-developed project without a dedicated security team, so response times are best-effort — but reports are taken seriously and fixed as quickly as possible.

## Scope

In scope:

- The Xuro desktop app (`src-tauri/`, `src/`) — including the auto-updater, vault file handling, and IPC boundary between the frontend and Rust.
- `services/cloud-api` — the backend for Xuro Cloud accounts, publishing, and billing.
- `site` — the marketing site and published-note pages at `usexuro.app`, where user-published content is served.

Out of scope:

- Vulnerabilities that require physical access to an already-unlocked device, or a device already compromised by other malware.
- Denial of service from sending large amounts of traffic (rate-limiting reports for the public API are still welcome).
- Social engineering of maintainers or users.
- Issues that only affect very old, no-longer-published releases.

## Supported versions

Only the most recently published release is supported with security fixes, across all three platforms Xuro ships for (Windows, macOS, Linux). Because Xuro auto-updates, please confirm an issue still reproduces on the latest release before reporting — check `https://github.com/Wooinxlkz/Xuro/releases/latest`.

## What "local-first" means for your data

- Your vault (notes, todos, bookmarks) is a plain folder on your disk that Xuro reads and writes directly — there is no background upload of vault contents.
- Xuro Cloud publishing is opt-in per note: nothing is sent to `services/cloud-api` unless you explicitly publish that note.
- Xuro checks `api.github.com` for the latest published release and compares its version to the running app. If a newer version exists, it offers a link to download the installer from the GitHub release — there is no separate update server, no signed manifest, and no silent in-place install; you always run the downloaded installer yourself.

If you find a way around any of the above — the update check pointing you at a malicious download, vault data leaving the device unexpectedly, or a way to read another user's published notes or account data — that's exactly the kind of report this policy is for.
