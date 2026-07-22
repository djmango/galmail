#!/usr/bin/env bun
/**
 * Decrypt sops secrets and run a command with those values in the
 * environment. Never writes a .env file.
 *
 * Usage: bun scripts/with-sops.ts -- <command> [args...]
 *
 * Loads secrets/dev.yaml (preferred) or legacy secrets/dev.json, then
 * optional overlays such as secrets/google-desktop-oauth.json (later
 * files win on key conflicts).
 *
 * Note: `sops exec-env` cannot pass command arguments (e.g. `--filter`) on
 * sops 3.13, so we decrypt explicitly and spawn the command ourselves.
 *
 * Passphrase-protected SSH keys are unlocked once into a 0600 temp file and
 * reused for every `sops -d` via SOPS_AGE_SSH_PRIVATE_KEY_FILE (each sops
 * process would otherwise re-prompt).
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { restoreTerminal } from "./restore-tty";
import { parseSecretsDocument } from "./secrets-yaml";

const root = resolve(import.meta.dir, "..");
const secretsDir = resolve(root, "secrets");
const primaryYaml = resolve(secretsDir, "dev.yaml");
const primaryJson = resolve(secretsDir, "dev.json");
const primarySecrets = existsSync(primaryYaml) ? primaryYaml : primaryJson;
const args = process.argv.slice(2).filter((arg) => arg !== "--");

if (args.length === 0) {
  console.error("usage: bun scripts/with-sops.ts -- <command> [args...]");
  process.exit(2);
}

const env: Record<string, string | undefined> = { ...process.env };
if (!env.SOPS_AGE_SSH_PRIVATE_KEY_FILE && !env.SOPS_AGE_KEY_FILE) {
  const sshKey = resolve(env.HOME ?? "", ".ssh/id_ed25519");
  if (existsSync(sshKey)) {
    env.SOPS_AGE_SSH_PRIVATE_KEY_FILE = sshKey;
  }
}

async function run(
  command: string[],
  childEnv: Record<string, string | undefined>,
) {
  // Ignore SIGINT/SIGTERM here so we can restore the TTY after the child
  // exits. Ctrl+C still reaches the child via the foreground process group.
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => {});

  const child = Bun.spawn(command, {
    cwd: root,
    env: childEnv,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  restoreTerminal();
  process.exit(code ?? 1);
}

function isExampleSecretsName(name: string): boolean {
  return (
    name.endsWith(".example.yaml") ||
    name.endsWith(".example.yml") ||
    name.endsWith(".example.json") ||
    name === "dev.example.yaml" ||
    name === "dev.example.yml" ||
    name === "dev.example.json"
  );
}

function isSecretsOverlayName(name: string): boolean {
  if (isExampleSecretsName(name)) return false;
  if (name.includes(".plain.")) return false;
  // CI-only material (secrets/ci/*) is decrypted by workflows, not local with-sops.
  if (name === "ci") return false;
  const isYaml = name.endsWith(".yaml") || name.endsWith(".yml");
  const isJson = name.endsWith(".json");
  if (!isYaml && !isJson) return false;
  // Prefer YAML primary: do not also load legacy secrets/dev.json.
  if (existsSync(primaryYaml) && name === "dev.json") return false;
  return true;
}

function secretFiles(): string[] {
  const files = new Set<string>();
  if (existsSync(primarySecrets)) files.add(primarySecrets);
  if (!existsSync(secretsDir)) return [...files];
  for (const name of readdirSync(secretsDir)) {
    if (!isSecretsOverlayName(name)) continue;
    files.add(resolve(secretsDir, name));
  }
  // Primary first, then overlays alphabetically for stable overrides.
  return [...files].sort((a, b) => {
    if (a === primarySecrets) return -1;
    if (b === primarySecrets) return 1;
    return a.localeCompare(b);
  });
}

function sshPrivateKeyNeedsPassphrase(keyPath: string): boolean {
  const probe = Bun.spawnSync(["ssh-keygen", "-y", "-P", "", "-f", keyPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return probe.exitCode !== 0;
}

function readSshPassphrase(keyPath: string): string {
  process.stderr.write(`Enter passphrase for ${keyPath}: `);
  const read = Bun.spawnSync(
    [
      "bash",
      "-c",
      'read -r -s pass </dev/tty && printf "%s" "$pass" && printf "\\n" >/dev/tty',
    ],
    {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "inherit",
    },
  );
  if (read.exitCode !== 0) {
    console.error("failed to read SSH key passphrase");
    process.exit(read.exitCode ?? 1);
  }
  return read.stdout.toString();
}

/** Decrypt an OpenSSH private key once; result stays in memory for KEY_CMD. */
function unlockSshPrivateKey(keyPath: string): string {
  const passphrase = readSshPassphrase(keyPath);
  const dir = mkdtempSync(join(tmpdir(), "galmail-sops-ssh-"));
  const tmpKey = join(dir, "key");
  const askpass = join(dir, "askpass");
  try {
    writeFileSync(tmpKey, readFileSync(keyPath), { mode: 0o600 });
    writeFileSync(
      askpass,
      `#!/bin/sh\nprintf '%s\\n' "$GALMAIL_SOPS_SSH_ASKPASS"\n`,
      { mode: 0o700 },
    );
    const unlocked = Bun.spawnSync(
      ["ssh-keygen", "-p", "-f", tmpKey, "-N", ""],
      {
        env: {
          ...process.env,
          GALMAIL_SOPS_SSH_ASKPASS: passphrase,
          SSH_ASKPASS: askpass,
          SSH_ASKPASS_REQUIRE: "force",
          // ssh-keygen only honors SSH_ASKPASS when DISPLAY (or equivalent) is set.
          DISPLAY: process.env.DISPLAY || "galmail-sops",
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    if (unlocked.exitCode !== 0) {
      const detail = unlocked.stderr.toString().trim();
      console.error(
        detail || `failed to unlock SSH key for sops: ${keyPath}`,
      );
      process.exit(unlocked.exitCode ?? 1);
    }
    return readFileSync(tmpKey, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * sops 3.13 re-reads SOPS_AGE_SSH_PRIVATE_KEY_FILE in every process and
 * re-prompts for the passphrase. Unlock once into a temp file instead.
 */
function prepareAgeSshIdentity(
  childEnv: Record<string, string | undefined>,
): (() => void) | undefined {
  if (
    childEnv.SOPS_AGE_KEY ||
    childEnv.SOPS_AGE_KEY_FILE ||
    childEnv.SOPS_AGE_KEY_CMD ||
    childEnv.SOPS_AGE_SSH_PRIVATE_KEY_CMD
  ) {
    return undefined;
  }

  const keyPath =
    childEnv.SOPS_AGE_SSH_PRIVATE_KEY_FILE ||
    resolve(childEnv.HOME ?? "", ".ssh/id_ed25519");
  if (!keyPath || !existsSync(keyPath)) return undefined;
  if (!sshPrivateKeyNeedsPassphrase(keyPath)) return undefined;

  const unlocked = unlockSshPrivateKey(keyPath);
  const dir = mkdtempSync(join(tmpdir(), "galmail-sops-unlocked-"));
  const tmpKey = join(dir, "id_ed25519");
  writeFileSync(tmpKey, unlocked, { mode: 0o600 });
  childEnv.SOPS_AGE_SSH_PRIVATE_KEY_FILE = tmpKey;
  return () => rmSync(dir, { recursive: true, force: true });
}

function decryptSecretsFile(path: string): Record<string, unknown> {
  const decrypted = Bun.spawnSync(["sops", "-d", path], {
    cwd: root,
    env,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "inherit",
  });
  if (decrypted.exitCode !== 0) {
    process.exit(decrypted.exitCode ?? 1);
  }
  try {
    return parseSecretsDocument(decrypted.stdout.toString(), path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(detail || `${path} did not decrypt to a valid secrets map`);
    process.exit(1);
  }
}

const files = secretFiles();
if (files.length === 0) {
  if (env.CI || env.GALMAIL_ALLOW_MISSING_SOPS === "1") {
    await run(args, env);
  }
  console.error(
    `missing ${primaryYaml}\n` +
      "create it from secrets/dev.example.yaml:\n" +
      "  cp secrets/dev.example.yaml secrets/dev.yaml\n" +
      "  # fill values, then: sops -e -i secrets/dev.yaml\n" +
      "  # or: bun scripts/import-google-oauth-json.ts ~/Downloads/client_secret_….json\n" +
      "or set GALMAIL_ALLOW_MISSING_SOPS=1 for demo/fixture-only local runs",
  );
  process.exit(1);
}

if (!existsSync(primaryYaml) && existsSync(primaryJson)) {
  console.warn(
    "deprecated: secrets/dev.json — migrate with:\n" +
      "  bun scripts/migrate-dev-secrets-to-yaml.ts\n" +
      "then remove secrets/dev.json after verifying.",
  );
}

const cleanupUnlockedSsh = prepareAgeSshIdentity(env);

try {
  const merged: Record<string, string | undefined> = { ...env };
  for (const file of files) {
    const secrets = decryptSecretsFile(file);
    for (const [key, value] of Object.entries(secrets)) {
      if (key === "sops") continue;
      if (value === null || value === undefined) continue;
      merged[key] = typeof value === "string" ? value : JSON.stringify(value);
    }
  }

  // Do not leak the unlocked key path into the child command environment.
  delete merged.SOPS_AGE_SSH_PRIVATE_KEY_FILE;
  delete merged.SOPS_AGE_SSH_PRIVATE_KEY_CMD;
  await run(args, merged);
} finally {
  cleanupUnlockedSsh?.();
}
