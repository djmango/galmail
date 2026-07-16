#!/usr/bin/env bun
/**
 * Fail if frontend sources contain typographic em/en dashes.
 * Prefer ASCII "-" in product UI and frontend code.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const frontendRoot = resolve(
  process.env.GALMAIL_FRONTEND_ROOT ?? join(root, "apps/web/src"),
);
const extensions = new Set([".css", ".html", ".js", ".jsx", ".ts", ".tsx"]);
const banned = [
  { name: "em dash", char: "\u2014", glyph: "—" },
  { name: "en dash", char: "\u2013", glyph: "–" },
] as const;

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") return [];
      return filesUnder(path);
    }
    const extension = entry.name.slice(entry.name.lastIndexOf("."));
    return extensions.has(extension) ? [path] : [];
  });
}

if (!statSync(frontendRoot).isDirectory()) {
  console.error(`missing frontend root: ${frontendRoot}`);
  process.exit(2);
}

const offenders: string[] = [];
for (const file of filesUnder(frontendRoot)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const dash of banned) {
      if (!line.includes(dash.char)) continue;
      offenders.push(
        `${relative(process.cwd(), file)}:${index + 1}: ${dash.name} (${dash.glyph})`,
      );
    }
  });
}

if (offenders.length > 0) {
  console.error("Frontend must not use typographic dashes. Use ASCII '-'.\n");
  for (const offender of offenders) console.error(`  ${offender}`);
  process.exit(1);
}

console.log("lint:emdash passed (no em/en dashes in frontend)");
