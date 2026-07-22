#!/usr/bin/env bun
/**
 * Fail if any secrets/* file that should be sops-encrypted is committed plaintext.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const secretsRoot = join(root, "secrets");

const SKIP_NAMES = new Set([
  "dev.example.yaml",
  "dev.example.yml",
  "dev.example.json",
  "tauri-updater.pub",
]);

function isExample(name: string): boolean {
  return (
    SKIP_NAMES.has(name) ||
    name.endsWith(".example.yaml") ||
    name.endsWith(".example.yml") ||
    name.endsWith(".example.json") ||
    name.endsWith(".pub")
  );
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      out.push(...walk(path));
      continue;
    }
    if (isExample(name)) continue;
    if (!/\.(ya?ml|json)$/.test(name)) continue;
    out.push(path);
  }
  return out;
}

const failures: string[] = [];
for (const path of walk(secretsRoot)) {
  const text = readFileSync(path, "utf8");
  const hasSopsMarker =
    text.includes("\nsops:") ||
    text.includes("\n  sops:") ||
    /"sops"\s*:/.test(text);
  const hasEnc = text.includes("ENC[AES256_GCM");
  if (!hasSopsMarker || !hasEnc) {
    failures.push(relative(root, path));
  }
}

if (failures.length > 0) {
  console.error("Plaintext (or non-sops) secrets files found:");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("Encrypt with: sops -e -i <file>");
  process.exit(1);
}

console.log("All committed secrets/* files are sops-encrypted.");
