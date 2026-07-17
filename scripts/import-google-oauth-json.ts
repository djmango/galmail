#!/usr/bin/env bun
/**
 * Encrypt a Google OAuth Desktop client JSON download into
 * secrets/google-desktop-oauth.json and sync the public client ID into
 * secrets/dev.yaml when decryptable.
 *
 * Usage: bun scripts/import-google-oauth-json.ts ~/Downloads/client_secret_….json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isYamlSecretsPath,
  parseSecretsDocument,
  stringifyFlatSecretsYaml,
} from "./secrets-yaml";

const root = resolve(import.meta.dir, "..");
const secretsYaml = resolve(root, "secrets/dev.yaml");
const secretsJson = resolve(root, "secrets/dev.json");
const secretsFile = existsSync(secretsYaml) ? secretsYaml : secretsJson;
const oauthOverlay = resolve(root, "secrets/google-desktop-oauth.json");
const exampleFile = resolve(root, "secrets/dev.example.yaml");
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

const rawText = readFileSync(absoluteJson, "utf8").trim();
const raw = JSON.parse(rawText) as Record<string, unknown>;
const client = (raw.installed ?? raw.web ?? raw) as Record<string, unknown>;
const clientId = String(client.client_id ?? "");
const clientSecret = String(client.client_secret ?? "");
if (!clientId.endsWith(".apps.googleusercontent.com")) {
  console.error("JSON does not look like a Google OAuth client download");
  process.exit(1);
}
if (!clientSecret) {
  console.error("JSON is missing client_secret (required by Google token exchange)");
  process.exit(1);
}

const env = { ...process.env };
if (!env.SOPS_AGE_SSH_PRIVATE_KEY_FILE && !env.SOPS_AGE_KEY_FILE) {
  const sshKey = resolve(env.HOME ?? "", ".ssh/id_ed25519");
  if (existsSync(sshKey)) env.SOPS_AGE_SSH_PRIVATE_KEY_FILE = sshKey;
}

function encryptSecretsFile(path: string, data: Record<string, string>): void {
  const plaintextPath = `${path}.plain.tmp`;
  const body = isYamlSecretsPath(path)
    ? stringifyFlatSecretsYaml(data)
    : `${JSON.stringify(data, null, 2)}\n`;
  writeFileSync(plaintextPath, body, { mode: 0o600 });
  try {
    const encrypted = Bun.spawnSync(
      ["sops", "-e", plaintextPath, "--filename-override", path],
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
    writeFileSync(path, encrypted.stdout, { mode: 0o600 });
  } finally {
    Bun.spawnSync(["rm", "-f", plaintextPath]);
  }
}

function asStringMap(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === "sops") continue;
    if (value === null || value === undefined) {
      out[key] = "";
      continue;
    }
    out[key] = typeof value === "string" ? value : JSON.stringify(value);
  }
  return out;
}

// Always write the overlay that the native app reads for token exchange.
encryptSecretsFile(oauthOverlay, { GOOGLE_DESKTOP_OAUTH_JSON: rawText });

// Best-effort: keep the public client ID in secrets/dev.yaml (or legacy JSON).
if (existsSync(secretsFile)) {
  const decrypted = Bun.spawnSync(["sops", "-d", secretsFile], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (decrypted.exitCode === 0) {
    const current = asStringMap(
      parseSecretsDocument(decrypted.stdout.toString(), secretsFile),
    );
    current.VITE_GOOGLE_DESKTOP_CLIENT_ID = clientId;
    // Prefer the overlay for the secret-bearing JSON; clear stale empty value.
    current.GOOGLE_DESKTOP_OAUTH_JSON = current.GOOGLE_DESKTOP_OAUTH_JSON || "";
    encryptSecretsFile(secretsFile, current);
  } else {
    console.warn(
      `could not update ${secretsFile} (SSH passphrase needed); overlay was still written`,
    );
  }
} else if (existsSync(exampleFile)) {
  const current = asStringMap(
    parseSecretsDocument(readFileSync(exampleFile, "utf8"), exampleFile),
  );
  current.VITE_GOOGLE_DESKTOP_CLIENT_ID = clientId;
  encryptSecretsFile(secretsYaml, current);
}

console.log(`updated ${oauthOverlay}`);
console.log(`VITE_GOOGLE_DESKTOP_CLIENT_ID=${clientId}`);
console.log(
  "Google desktop client_secret stays in sops (GOOGLE_DESKTOP_OAUTH_JSON) and is only used by the native token exchange",
);
