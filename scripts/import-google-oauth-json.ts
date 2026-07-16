#!/usr/bin/env bun
/**
 * Merge a Google OAuth Desktop client JSON download into secrets/dev.json
 * (sops-encrypted). Does not write .env files.
 *
 * Usage: bun scripts/import-google-oauth-json.ts ~/Downloads/client_secret_….json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const secretsFile = resolve(root, "secrets/dev.json");
const exampleFile = resolve(root, "secrets/dev.example.json");
const jsonPath = process.argv[2];

if (!jsonPath) {
  console.error(
    "usage: bun scripts/import-google-oauth-json.ts <client_secret_….json>",
  );
  process.exit(2);
}

const absoluteJson = resolve(jsonPath);
if (!existsSync(absoluteJson)) {
  console.error(`file not found: ${absoluteJson}`);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(absoluteJson, "utf8")) as Record<
  string,
  unknown
>;
const client = (raw.installed ?? raw.web ?? raw) as Record<string, unknown>;
const clientId = String(client.client_id ?? "");
if (!clientId.endsWith(".apps.googleusercontent.com")) {
  console.error("JSON does not look like a Google OAuth client download");
  process.exit(1);
}

const env = { ...process.env };
if (!env.SOPS_AGE_SSH_PRIVATE_KEY_FILE && !env.SOPS_AGE_KEY_FILE) {
  const sshKey = resolve(env.HOME ?? "", ".ssh/id_ed25519");
  if (existsSync(sshKey)) env.SOPS_AGE_SSH_PRIVATE_KEY_FILE = sshKey;
}

let current: Record<string, string> = {};
if (existsSync(secretsFile)) {
  const decrypted = Bun.spawnSync(["sops", "-d", secretsFile], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (decrypted.exitCode !== 0) {
    console.error(decrypted.stderr.toString() || "sops decrypt failed");
    process.exit(decrypted.exitCode ?? 1);
  }
  current = JSON.parse(decrypted.stdout.toString()) as Record<string, string>;
} else {
  current = JSON.parse(readFileSync(exampleFile, "utf8")) as Record<
    string,
    string
  >;
}

current.VITE_GOOGLE_DESKTOP_CLIENT_ID = clientId;
current.GOOGLE_DESKTOP_OAUTH_JSON = JSON.stringify(raw);

const plaintextPath = `${secretsFile}.plain.tmp`;
writeFileSync(plaintextPath, `${JSON.stringify(current, null, 2)}\n`, {
  mode: 0o600,
});
try {
  const encrypted = Bun.spawnSync(
    ["sops", "-e", plaintextPath, "--filename-override", "secrets/dev.json"],
    {
      cwd: root,
      env,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (encrypted.exitCode !== 0) {
    console.error(encrypted.stderr.toString() || "sops encrypt failed");
    process.exit(encrypted.exitCode ?? 1);
  }
  writeFileSync(secretsFile, encrypted.stdout, { mode: 0o600 });
} finally {
  Bun.spawnSync(["rm", "-f", plaintextPath]);
}

console.log(`updated ${secretsFile}`);
console.log(`VITE_GOOGLE_DESKTOP_CLIENT_ID=${clientId}`);
console.log(
  "client secret is stored only inside GOOGLE_DESKTOP_OAUTH_JSON (sops); the app does not load it",
);
