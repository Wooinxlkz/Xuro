#!/usr/bin/env node

/**
 * Generate latest.json for the Tauri updater (Windows, macOS, Linux).
 *
 * This script generates the latest.json manifest file needed for Tauri
 * updates. It reads the updater signature for each platform that was
 * built and creates a properly formatted JSON file. Platforms whose
 * signature file isn't found are skipped, so this works whether you're
 * generating the manifest from a single-platform build or from a
 * merged directory containing artifacts from all platforms (see the
 * "publish" job in .github/workflows/release.yml).
 *
 * Usage:
 *   bun scripts/generate-latest-json.js <version> [--type=fix|feature] <notes>
 *
 * Env vars:
 *   ARTIFACTS_DIR   Directory to read signatures from. Defaults to
 *                   src-tauri/target/release/bundle (a normal local
 *                   build). The release workflow points this at a
 *                   merged folder holding every platform's artifacts.
 *
 * Example:
 *   bun scripts/generate-latest-json.js "0.2.0" --type=feature "New properties"
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");

const GITHUB_REPO = "Wooinxlkz/xuro";
const APP_NAME = "Xuro";

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error(
    "Usage: bun scripts/generate-latest-json.js <version> [--type=fix|feature] <notes>",
  );
  console.error(
    'Example: bun scripts/generate-latest-json.js "0.1.1" "Bug fixes"'
  );
  process.exit(1);
}

const version = args[0];
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`Invalid semantic version: ${version}`);
  process.exit(1);
}

const invalidTypeArg = args.slice(1).find((arg) => arg.startsWith("--type=") && !/^--type=(fix|feature)$/.test(arg));
if (invalidTypeArg) {
  console.error(`Invalid release type: ${invalidTypeArg}`);
  process.exit(1);
}

const typeArg = args.slice(1).find((arg) => /^--type=(fix|feature)$/.test(arg));
const releaseType = typeArg?.slice("--type=".length);
const notes = args
  .slice(1)
  .filter((arg) => arg !== typeArg)
  .join(" ");
if (!notes.trim()) {
  console.error("Release notes cannot be empty");
  process.exit(1);
}
const pubDate = new Date().toISOString();
const releaseUrl = `https://github.com/${GITHUB_REPO}/releases/download/v${version}`;

// Either a plain "src-tauri/target/release/bundle" tree from a local
// build, or (in CI) a flat merged directory holding every platform's
// renamed release artifacts - see the "publish" job in release.yml.
const artifactsDir = process.env.ARTIFACTS_DIR
  ? resolve(projectRoot, process.env.ARTIFACTS_DIR)
  : join(projectRoot, "src-tauri", "target", "release", "bundle");

function readSignature(filePath) {
  try {
    return readFileSync(filePath, "utf-8").trim();
  } catch {
    return null;
  }
}

console.log("📦 Generating latest.json for version", version);
console.log("");

const latestJson = {
  version,
  notes,
  pub_date: pubDate,
  ...(releaseType ? { release_type: releaseType } : {}),
  platforms: {},
};

// Each entry: the updater platform key, the release-asset filename we
// publish, and where the matching .sig lives in a plain local
// `tauri build` output tree (nestedPath), as a fallback to the flat
// merged CI artifacts dir (fileName + ".sig" directly in artifactsDir).
const platformTargets = [
  {
    key: "windows-x86_64",
    fileName: `${APP_NAME}_${version}_x64-setup.nsis.zip`,
    nestedPath: ["nsis", `${APP_NAME}_${version}_x64-setup.nsis.zip`],
  },
  {
    key: "darwin-x86_64",
    fileName: `${APP_NAME}_${version}_x64.app.tar.gz`,
    nestedPath: ["macos", `${APP_NAME}.app.tar.gz`],
  },
  {
    key: "darwin-aarch64",
    fileName: `${APP_NAME}_${version}_aarch64.app.tar.gz`,
    nestedPath: ["macos", `${APP_NAME}.app.tar.gz`],
  },
  {
    key: "linux-x86_64",
    fileName: `${APP_NAME}_${version}_amd64.AppImage.tar.gz`,
    nestedPath: ["appimage", `${APP_NAME}_${version}_amd64.AppImage.tar.gz`],
  },
];

for (const { key, fileName, nestedPath } of platformTargets) {
  const flatPath = join(artifactsDir, `${fileName}.sig`);
  const nestedSigPath = `${join(artifactsDir, ...nestedPath)}.sig`;

  const signature = readSignature(flatPath) ?? readSignature(nestedSigPath);

  if (signature) {
    latestJson.platforms[key] = {
      signature,
      url: `${releaseUrl}/${fileName}`,
    };
    console.log(`✓ Added ${key}`);
  } else {
    console.warn(`⚠ Skipping ${key} (signature file not found)`);
  }
}

const outputPath = join(projectRoot, "latest.json");
writeFileSync(outputPath, JSON.stringify(latestJson, null, 2) + "\n", "utf-8");

console.log("");
console.log("✅ Generated latest.json");
console.log(`   Location: ${outputPath}`);
console.log("");

if (Object.keys(latestJson.platforms).length === 0) {
  console.log("⚠️  Warning: No platforms were added to latest.json");
  console.log("");
  console.log("📝 This usually means no updater signature files were found.");
  console.log("   Signature files are created automatically by the Tauri updater plugin");
  console.log("   whenever createUpdaterArtifacts is enabled in tauri.conf.json.");
} else {
  console.log("📋 Next steps:");
  console.log("   1. Review the generated latest.json file");
  console.log(`   2. Upload the update bundle to GitHub release v${version}`);
  console.log("   3. Publish latest.json at /updates/latest.json");
}
console.log("");
