#!/usr/bin/env bun
/**
 * Encrypt a Google OAuth Desktop client JSON download into
 * secrets/google-desktop-oauth.json and sync the public client ID into
 * secrets/dev.json when decryptable.
 *
 * Usage: bun scripts/import-google-oauth-json.ts ~/Downloads/client_secret_….json
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const secretsFile = resolve(root, "secrets/dev.json");
const oauthOverlay = resolve(root, "secrets/google-desktop-oauth.json");
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

function encryptJson(path: string, data: Record<string, string>): void {
  const plaintextPath = `${path}.plain.tmp`;
  writeFileSync(plaintextPath, `${JSON.stringify(data, null, 2)}\n`, {
    mode: 0o600,
  });
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

// Always write the overlay that the native app reads for token exchange.
encryptJson(oauthOverlay, { GOOGLE_DESKTOP_OAUTH_JSON: rawText });

// Best-effort: keep the public client ID in secrets/dev.json too.
if (existsSync(secretsFile)) {
  const decrypted = Bun.spawnSync(["sops", "-d", secretsFile], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (decrypted.exitCode === 0) {
    const current = JSON.parse(decrypted.stdout.toString()) as Record<
      string,
      string
    >;
    current.VITE_GOOGLE_DESKTOP_CLIENT_ID = clientId;
    // Prefer the overlay for the secret-bearing JSON; clear stale empty value.
    current.GOOGLE_DESKTOP_OAUTH_JSON = current.GOOGLE_DESKTOP_OAUTH_JSON || "";
    encryptJson(secretsFile, current);
  } else {
    console.warn(
      "could not update secrets/dev.json (SSH passphrase needed); overlay was still written",
    );
  }
} else if (existsSync(exampleFile)) {
  const current = JSON.parse(readFileSync(exampleFile, "utf8")) as Record<
    string,
    string
  >;
  current.VITE_GOOGLE_DESKTOP_CLIENT_ID = clientId;
  encryptJson(secretsFile, current);
}

console.log(`updated ${oauthOverlay}`);
console.log(`VITE_GOOGLE_DESKTOP_CLIENT_ID=${clientId}`);
console.log(
  "Google desktop client_secret stays in sops (GOOGLE_DESKTOP_OAUTH_JSON) and is only used by the native token exchange",
);
