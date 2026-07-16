import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const script = join(import.meta.dir, "lint-no-emdash.ts");
const repoRoot = join(import.meta.dir, "..");

describe("lint-no-emdash", () => {
  it("fails when frontend sources contain an em dash", () => {
    const directory = mkdtempSync(join(tmpdir(), "galmail-emdash-"));
    writeFileSync(join(directory, "Bad.tsx"), 'export const label = "Hello—world";\n');
    try {
      const result = Bun.spawnSync(["bun", script], {
        cwd: repoRoot,
        env: {
          ...process.env,
          GALMAIL_FRONTEND_ROOT: directory,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode).toBe(1);
      expect(result.stderr.toString()).toContain("em dash");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("passes on the current frontend tree", () => {
    const result = Bun.spawnSync(["bun", script], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("lint:emdash passed");
  });
});
