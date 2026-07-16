import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("creates an isolated alpha updater configuration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "galmail-release-"));
  const output = join(directory, "tauri.release.json");
  try {
    const process = Bun.spawn(
      [
        "bun",
        "scripts/prepare-tauri-release-config.ts",
        "alpha",
        "1.2.3-alpha.4",
        "galmail/galmail",
        "untrusted-comment: minisign public key",
        "Developer ID Application: GalMail (TEAMID)",
        output,
      ],
      { cwd: import.meta.dir + "/.." },
    );
    expect(await process.exited).toBe(0);
    const config = JSON.parse(await readFile(output, "utf8"));
    expect(config.identifier).toBe("app.galmail.client.alpha");
    expect(config.bundle.createUpdaterArtifacts).toBe(true);
    expect(config.plugins.updater.endpoints[0]).toEndWith(
      "/releases/download/updates-alpha/latest.json",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects a prerelease version on stable", async () => {
  const process = Bun.spawn(
    [
      "bun",
      "scripts/prepare-tauri-release-config.ts",
      "stable",
      "1.2.3-beta.1",
      "galmail/galmail",
      "untrusted-comment: minisign public key",
      "Developer ID Application: GalMail (TEAMID)",
      "/tmp/galmail-invalid-release.json",
    ],
    {
      cwd: import.meta.dir + "/..",
      stderr: "ignore",
    },
  );
  expect(await process.exited).not.toBe(0);
});

test("creates an updater manifest for immutable release assets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "galmail-updater-"));
  const macos = join(directory, "macos");
  const output = join(directory, "latest.json");
  await mkdir(macos);
  await writeFile(join(macos, "GalMail.app.tar.gz"), "archive");
  await writeFile(join(macos, "GalMail.app.tar.gz.sig"), "signed-value\n");
  try {
    const process = Bun.spawn(
      [
        "bun",
        "scripts/create-updater-manifest.ts",
        directory,
        "galmail/galmail",
        "v1.2.3-beta.2",
        "1.2.3-beta.2",
        "beta",
        output,
      ],
      { cwd: import.meta.dir + "/.." },
    );
    expect(await process.exited).toBe(0);
    const manifest = JSON.parse(await readFile(output, "utf8"));
    expect(manifest.platforms["darwin-aarch64"].signature).toBe("signed-value");
    expect(manifest.platforms["darwin-aarch64"].url).toContain(
      "/releases/download/v1.2.3-beta.2/",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("allows only forward movement within an update channel", async () => {
  const directory = await mkdtemp(join(tmpdir(), "galmail-monotonic-"));
  const manifest = join(directory, "latest.json");
  await writeFile(manifest, JSON.stringify({ version: "1.2.3-beta.2" }));
  try {
    const upgrade = Bun.spawn(
      ["bun", "scripts/assert-release-monotonic.ts", "1.2.3-beta.3", manifest],
      { cwd: import.meta.dir + "/.." },
    );
    expect(await upgrade.exited).toBe(0);

    const rollback = Bun.spawn(
      ["bun", "scripts/assert-release-monotonic.ts", "1.2.3-beta.1", manifest],
      { cwd: import.meta.dir + "/..", stderr: "ignore" },
    );
    expect(await rollback.exited).not.toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
