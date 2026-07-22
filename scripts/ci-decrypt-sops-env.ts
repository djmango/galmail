#!/usr/bin/env bun
/**
 * Decrypt a sops YAML map and append KEY=value lines to GITHUB_ENV (or stdout).
 *
 * Usage:
 *   bun scripts/ci-decrypt-sops-env.ts secrets/ci/apple.yaml
 *
 * Requires SOPS_AGE_KEY or SOPS_AGE_KEY_FILE (CI) or SSH age identity (local).
 */
import { appendFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseSecretsDocument } from "./secrets-yaml";

const file = process.argv[2];
if (!file) {
  console.error("usage: bun scripts/ci-decrypt-sops-env.ts <secrets-file>");
  process.exit(2);
}

const path = resolve(file);
if (!existsSync(path)) {
  console.error(`missing secrets file: ${path}`);
  process.exit(1);
}

const decrypted = Bun.spawnSync(["sops", "-d", path], {
  stdout: "pipe",
  stderr: "inherit",
  env: process.env,
});
if (decrypted.exitCode !== 0) {
  process.exit(decrypted.exitCode ?? 1);
}

const secrets = parseSecretsDocument(decrypted.stdout.toString(), path);
const lines: string[] = [];
for (const [key, value] of Object.entries(secrets)) {
  if (key === "sops") continue;
  if (value === null || value === undefined) continue;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  // GITHUB_ENV multiline: key<<EOF ... EOF
  if (text.includes("\n")) {
    lines.push(`${key}<<EOF`, text, "EOF");
  } else {
    lines.push(`${key}=${text}`);
  }
}

const githubEnv = process.env.GITHUB_ENV;
if (githubEnv) {
  appendFileSync(githubEnv, `${lines.join("\n")}\n`);
  console.log(`Loaded ${Object.keys(secrets).filter((k) => k !== "sops").length} keys from ${file}`);
} else {
  process.stdout.write(`${lines.join("\n")}\n`);
}
