#!/usr/bin/env bun
/**
 * Open the primary local secrets file in sops.
 * Prefers secrets/dev.yaml; falls back to legacy secrets/dev.json.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const yamlPath = resolve(root, "secrets/dev.yaml");
const jsonPath = resolve(root, "secrets/dev.json");
const path = existsSync(yamlPath) ? yamlPath : jsonPath;

if (!existsSync(path)) {
  console.error(
    `missing ${yamlPath}\n` +
      "create it from secrets/dev.example.yaml:\n" +
      "  cp secrets/dev.example.yaml secrets/dev.yaml\n" +
      "  # fill values, then: sops -e -i secrets/dev.yaml",
  );
  process.exit(1);
}

if (!existsSync(yamlPath) && existsSync(jsonPath)) {
  console.warn(
    "deprecated: editing secrets/dev.json — migrate with:\n" +
      "  bun run secrets:migrate-yaml",
  );
}

const child = Bun.spawn(["sops", path], {
  cwd: root,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exit((await child.exited) ?? 1);
