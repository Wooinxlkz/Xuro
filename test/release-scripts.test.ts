import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const projectRoot = join(import.meta.dir, "..");
const projectVersion = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8")).version;

function run(args: string[]) {
  return Bun.spawnSync(args, { cwd: projectRoot, stderr: "pipe", stdout: "pipe" });
}

describe("release script validation", () => {
  test("accepts the synchronized project version", () => {
    const result = run(["bun", "scripts/verify-release-version.js", projectVersion]);
    expect(result.exitCode).toBe(0);
  });

  test("rejects a mismatched project version", () => {
    const result = run(["bun", "scripts/verify-release-version.js", "9.9.9"]);
    expect(result.exitCode).not.toBe(0);
  });
});
