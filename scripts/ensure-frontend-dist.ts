#!/usr/bin/env bun
/**
 * Ensure apps/web/dist exists so Tauri's generate_context! can resolve frontendDist.
 * Used by cargo-check gates that do not run a full Vite build.
 */
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const dist = resolve(import.meta.dir, "../apps/web/dist");
const index = join(dist, "index.html");
mkdirSync(dist, { recursive: true });
if (!existsSync(index)) {
  writeFileSync(
    index,
    "<!doctype html><html><head><title>GalMail</title></head><body></body></html>\n",
  );
}
