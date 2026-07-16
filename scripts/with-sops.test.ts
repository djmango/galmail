import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "with-sops.ts");

function unlockOpenSshKey(keyPath: string, passphrase: string): string {
  const dir = mkdtempSync(join(tmpdir(), "galmail-sops-test-"));
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
          DISPLAY: process.env.DISPLAY || "galmail-sops",
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(unlocked.exitCode).toBe(0);
    return readFileSync(tmpKey, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("with-sops SSH identity session", () => {
  it("prints GALMAIL_SOPS_SSH_IDENTITY for SOPS_AGE_SSH_PRIVATE_KEY_CMD", () => {
    const identity = "-----BEGIN OPENSSH PRIVATE KEY-----\ntest\n-----END OPENSSH PRIVATE KEY-----\n";
    const result = Bun.spawnSync(
      [process.execPath, script, "--print-ssh-identity"],
      {
        env: {
          ...process.env,
          GALMAIL_SOPS_SSH_IDENTITY: identity,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toBe(identity);
  });

  it("decrypts multiple sops files with one unlocked SSH identity", () => {
    const dir = mkdtempSync(join(tmpdir(), "galmail-sops-multi-"));
    const keyPath = join(dir, "id_ed25519");
    const passphrase = "test-passphrase-not-used-interactively";
    try {
      const generated = Bun.spawnSync(
        ["ssh-keygen", "-t", "ed25519", "-f", keyPath, "-N", passphrase, "-q"],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(generated.exitCode).toBe(0);

      const pub = readFileSync(`${keyPath}.pub`, "utf8").trim();
      const aPath = join(dir, "a.json");
      const bPath = join(dir, "b.json");
      writeFileSync(aPath, `${JSON.stringify({ A: "1" }, null, 2)}\n`);
      writeFileSync(bPath, `${JSON.stringify({ B: "2" }, null, 2)}\n`);

      for (const path of [aPath, bPath]) {
        const encrypted = Bun.spawnSync(
          ["sops", "--config", "/dev/null", "-e", "-i", "--age", pub, path],
          {
            env: { ...process.env },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        expect(encrypted.exitCode).toBe(0);
      }

      const identity = unlockOpenSshKey(keyPath, passphrase);
      const keyCmd = `${process.execPath} ${script} --print-ssh-identity`;
      const decryptEnv = { ...process.env };
      decryptEnv.GALMAIL_SOPS_SSH_IDENTITY = identity;
      decryptEnv.SOPS_AGE_SSH_PRIVATE_KEY_CMD = keyCmd;
      // Prefer CMD; a FILE path would prompt before CMD is tried.
      delete decryptEnv.SOPS_AGE_SSH_PRIVATE_KEY_FILE;

      const first = Bun.spawnSync(
        ["sops", "--config", "/dev/null", "-d", aPath],
        {
          env: decryptEnv,
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const second = Bun.spawnSync(
        ["sops", "--config", "/dev/null", "-d", bPath],
        {
          env: decryptEnv,
          stdout: "pipe",
          stderr: "pipe",
        },
      );

      expect(first.exitCode).toBe(0);
      expect(second.exitCode).toBe(0);
      expect(JSON.parse(first.stdout.toString())).toEqual({ A: "1" });
      expect(JSON.parse(second.stdout.toString())).toEqual({ B: "2" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
