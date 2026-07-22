import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function ageRecipientFromKeyFile(keyPath: string): string {
  const match = readFileSync(keyPath, "utf8").match(/public key:\s*(age1[a-z0-9]+)/i);
  if (!match) {
    throw new Error(`no age public key comment in ${keyPath}`);
  }
  return match[1]!;
}

describe("sops age decrypt session", () => {
  it("decrypts multiple sops files with one age key file", () => {
    const dir = mkdtempSync(join(tmpdir(), "galmail-sops-multi-"));
    try {
      const keyPath = join(dir, "key.txt");
      const generated = Bun.spawnSync(["age-keygen", "-o", keyPath], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(generated.exitCode).toBe(0);
      const recipient = ageRecipientFromKeyFile(keyPath);

      const aPath = join(dir, "a.json");
      const bPath = join(dir, "b.json");
      writeFileSync(aPath, `${JSON.stringify({ A: "1" }, null, 2)}\n`);
      writeFileSync(bPath, `${JSON.stringify({ B: "2" }, null, 2)}\n`);

      for (const path of [aPath, bPath]) {
        const encrypted = Bun.spawnSync(
          ["sops", "--config", "/dev/null", "-e", "-i", "--age", recipient, path],
          {
            env: { ...process.env },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        expect(encrypted.exitCode).toBe(0);
      }

      const decryptEnv = {
        ...process.env,
        SOPS_AGE_KEY_FILE: keyPath,
      };

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
