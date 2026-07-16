#!/usr/bin/env bun
/**
 * Decrypt secrets/dev.json and run a command with those values in the
 * environment. Never writes a .env file.
 *
 * Usage: bun scripts/with-sops.ts -- <command> [args...]
 *
 * Note: `sops exec-env` cannot pass command arguments (e.g. `--filter`) on
 * sops 3.13, so we decrypt explicitly and spawn the command ourselves.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const secretsFile = resolve(root, "secrets/dev.json");
const args = process.argv.slice(2).filter((arg) => arg !== "--");

if (args.length === 0) {
  console.error("usage: bun scripts/with-sops.ts -- <command> [args...]");
  process.exit(2);
}

const env = { ...process.env };
if (!env.SOPS_AGE_SSH_PRIVATE_KEY_FILE && !env.SOPS_AGE_KEY_FILE) {
  const sshKey = resolve(env.HOME ?? "", ".ssh/id_ed25519");
  if (existsSync(sshKey)) {
    env.SOPS_AGE_SSH_PRIVATE_KEY_FILE = sshKey;
  }
}

async function run(command: string[], childEnv: Record<string, string | undefined>) {
  const child = Bun.spawn(command, {
    cwd: root,
    env: childEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(await child.exited);
}

if (!existsSync(secretsFile)) {
  if (env.CI || env.GALMAIL_ALLOW_MISSING_SOPS === "1") {
    await run(args, env);
  }
  console.error(
    `missing ${secretsFile}\n` +
      "create it from secrets/dev.example.json:\n" +
      "  cp secrets/dev.example.json secrets/dev.json\n" +
      "  # fill values, then: sops -e -i secrets/dev.json\n" +
      "  # or: bun scripts/import-google-oauth-json.ts ~/Downloads/client_secret_….json\n" +
      "or set GALMAIL_ALLOW_MISSING_SOPS=1 for fixture-only local runs",
  );
  process.exit(1);
}

const decrypted = Bun.spawnSync(["sops", "-d", secretsFile], {
  cwd: root,
  env,
  stdin: "inherit",
  stdout: "pipe",
  stderr: "inherit",
});

if (decrypted.exitCode !== 0) {
  process.exit(decrypted.exitCode ?? 1);
}

let secrets: Record<string, unknown>;
try {
  secrets = JSON.parse(decrypted.stdout.toString()) as Record<string, unknown>;
} catch {
  console.error("secrets/dev.json did not decrypt to valid JSON");
  process.exit(1);
}

const merged: Record<string, string | undefined> = { ...env };
for (const [key, value] of Object.entries(secrets)) {
  if (key === "sops") continue;
  if (value === null || value === undefined) continue;
  merged[key] = typeof value === "string" ? value : JSON.stringify(value);
}

await run(args, merged);
