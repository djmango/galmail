#!/usr/bin/env bun
/**
 * Copy the Vite frontend build into the Tauri iOS Xcode resource folder.
 *
 * Xcode bundles `apps/web/src-tauri/gen/apple/assets` (see project.yml). Vite
 * writes to `apps/web/dist`. Without this sync, device/simulator builds can
 * ship stale web UI until someone copies dist by hand.
 *
 * Usage:
 *   bun scripts/sync-ios-web-assets.ts
 *   bun scripts/sync-ios-web-assets.ts --build
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = join(repoRoot, "apps/web");
const distDir = join(webRoot, "dist");
const assetsDir = join(repoRoot, "apps/web/src-tauri/gen/apple/assets");

const shouldBuild = process.argv.includes("--build");

function ensureDist() {
  if (existsSync(join(distDir, "index.html"))) {
    return;
  }
  if (!shouldBuild) {
    throw new Error(
      [
        `Missing frontend build at ${distDir}.`,
        "Run `bun run --cwd apps/web build` or pass --build.",
      ].join(" "),
    );
  }
  console.log("→ Building workspace packages + frontend…");
  // apps/web `tsc` resolves @galmail/* from package dist outputs.
  execFileSync("bun", ["run", "--filter", "@galmail/core-api", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  execFileSync("bun", ["run", "--filter", "./packages/*", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  execFileSync("bun", ["run", "build"], {
    cwd: webRoot,
    stdio: "inherit",
  });
  if (!existsSync(join(distDir, "index.html"))) {
    throw new Error(`Frontend build did not produce ${join(distDir, "index.html")}`);
  }
}

ensureDist();

rmSync(assetsDir, { recursive: true, force: true });
cpSync(distDir, assetsDir, { recursive: true });

console.log(`→ Synced ${distDir} → ${assetsDir}`);
