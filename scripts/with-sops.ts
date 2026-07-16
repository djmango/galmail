#!/usr/bin/env bun
/**
 * Run a command with secrets/dev.json decrypted into the environment via
 * `sops exec-env`. Never writes a .env file.
 *
 * Usage: bun scripts/with-sops.ts -- <command> [args...]
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

if (!existsSync(secretsFile)) {
  if (env.CI || env.GALMAIL_ALLOW_MISSING_SOPS === "1") {
    const child = Bun.spawn(args, {
      cwd: root,
      env,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    process.exit(await child.exited);
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

const child = Bun.spawn(["sops", "exec-env", secretsFile, ...args], {
  cwd: root,
  env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await child.exited);
