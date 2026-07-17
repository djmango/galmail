#!/usr/bin/env bun
/**
 * Migrate encrypted secrets/dev.json → secrets/dev.yaml without losing values.
 *
 * Usage: bun scripts/migrate-dev-secrets-to-yaml.ts
 *
 * Requires the same SSH-age identity used for sops (may prompt for passphrase).
 * After verifying `bun run secrets:edit` / `bun run dev`, delete secrets/dev.json.
 */
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { stringifyFlatSecretsYaml } from "./secrets-yaml";

const root = resolve(import.meta.dir, "..");
const jsonPath = resolve(root, "secrets/dev.json");
const yamlPath = resolve(root, "secrets/dev.yaml");

if (!existsSync(jsonPath)) {
  console.error(`missing ${jsonPath}`);
  process.exit(1);
}
if (existsSync(yamlPath)) {
  console.error(
    `${yamlPath} already exists; aborting to avoid overwrite.\n` +
      "Remove or rename it first if you intend to re-migrate from JSON.",
  );
  process.exit(1);
}

const env: Record<string, string | undefined> = { ...process.env };
if (!env.SOPS_AGE_SSH_PRIVATE_KEY_FILE && !env.SOPS_AGE_KEY_FILE) {
  const sshKey = resolve(env.HOME ?? "", ".ssh/id_ed25519");
  if (existsSync(sshKey)) env.SOPS_AGE_SSH_PRIVATE_KEY_FILE = sshKey;
}

const decrypted = Bun.spawnSync(["sops", "-d", jsonPath], {
  cwd: root,
  env,
  stdin: "inherit",
  stdout: "pipe",
  stderr: "inherit",
});
if (decrypted.exitCode !== 0) {
  process.exit(decrypted.exitCode ?? 1);
}

const current = JSON.parse(decrypted.stdout.toString()) as Record<
  string,
  unknown
>;
const flat: Record<string, string> = {};
for (const [key, value] of Object.entries(current)) {
  if (key === "sops") continue;
  if (value === null || value === undefined) {
    flat[key] = "";
    continue;
  }
  flat[key] = typeof value === "string" ? value : JSON.stringify(value);
}

const plaintextPath = resolve(root, "secrets/dev.yaml.plain.tmp");
writeFileSync(plaintextPath, stringifyFlatSecretsYaml(flat), { mode: 0o600 });
try {
  const encrypted = Bun.spawnSync(
    ["sops", "-e", plaintextPath, "--filename-override", yamlPath],
    {
      cwd: root,
      env,
      stdin: "inherit",
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  if (encrypted.exitCode !== 0) {
    process.exit(encrypted.exitCode ?? 1);
  }
  writeFileSync(yamlPath, encrypted.stdout, { mode: 0o600 });
} finally {
  Bun.spawnSync(["rm", "-f", plaintextPath]);
}

// Sanity: decrypt YAML and compare key set + values.
const check = Bun.spawnSync(["sops", "-d", yamlPath], {
  cwd: root,
  env,
  stdin: "inherit",
  stdout: "pipe",
  stderr: "inherit",
});
if (check.exitCode !== 0) {
  console.error("wrote YAML but failed to re-decrypt; leaving JSON in place");
  process.exit(check.exitCode ?? 1);
}
const roundTrip = Bun.YAML.parse(check.stdout.toString()) as Record<
  string,
  unknown
>;
for (const [key, value] of Object.entries(flat)) {
  const got = roundTrip[key];
  const gotStr =
    got === null || got === undefined
      ? ""
      : typeof got === "string"
        ? got
        : JSON.stringify(got);
  if (gotStr !== value) {
    console.error(`migration mismatch for ${key}`);
    process.exit(1);
  }
}

console.log(`wrote ${yamlPath}`);
console.log(
  "Verify with: bun run secrets:edit   # or: bun scripts/with-sops.ts -- env | head",
);
console.log(
  "When satisfied, remove the legacy file:\n  rm secrets/dev.json",
);
