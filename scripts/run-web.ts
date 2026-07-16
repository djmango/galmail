#!/usr/bin/env bun
/**
 * Run an @galmail/web package script without `bun --filter`.
 *
 * Bun's workspace filter supervisor prints the box UI and, on Ctrl+C, can
 * exit before unread terminal capability replies are consumed. Spawning the
 * web package directly avoids that path and restores the TTY on exit.
 *
 * Usage: bun scripts/run-web.ts <script> [args...]
 */
import { resolve } from "node:path";
import { restoreTerminal } from "./restore-tty";

const webRoot = resolve(import.meta.dir, "../apps/web");
const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("usage: bun scripts/run-web.ts <script> [args...]");
  process.exit(2);
}

// Stay alive on Ctrl+C so we can drain/restore after the child exits.
process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});

const child = Bun.spawn(["bun", "run", ...args], {
  cwd: webRoot,
  env: process.env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});

const code = await child.exited;
restoreTerminal();
process.exit(code ?? 1);
