import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const sourceRoots = ["apps/web/src", "packages", "services", "crates"];
const sourceExtensions = new Set([".js", ".jsx", ".rs", ".ts", ".tsx"]);
const excludedSegments = ["/dist/", "/node_modules/", "/target/"];

function filesUnder(path: string): string[] {
  const absolute = resolve(root, path);
  if (!statSync(absolute).isDirectory()) return [absolute];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = join(absolute, entry.name);
    return entry.isDirectory() ? filesUnder(relative(root, child)) : [child];
  });
}

function productionSources(): string[] {
  return sourceRoots.flatMap(filesUnder).filter((path) => {
    const normalized = path.replaceAll("\\", "/");
    const extension = normalized.slice(normalized.lastIndexOf("."));
    return (
      sourceExtensions.has(extension) &&
      !normalized.endsWith(".d.ts") &&
      !excludedSegments.some((segment) => normalized.includes(segment)) &&
      !normalized.match(/\.(?:test|spec)\.[^.]+$/)
    );
  });
}

describe("security policy guards", () => {
  it("forbids direct production logging of potentially sensitive values", () => {
    const loggingApi =
      /\b(?:console\.(?:debug|error|info|log|trace|warn)|logger\.|tracing::|dbg!|eprint!|eprintln!|print!|println!)\s*(?:\(|\{)/;
    const offenders = productionSources()
      .filter((path) => loggingApi.test(readFileSync(path, "utf8")))
      .map((path) => relative(root, path));

    expect(offenders).toEqual([]);
  });

  it("keeps provider client secrets out of the webview and example env", () => {
    // Google Desktop token exchange still needs the Console-issued secret in
    // the native process (via GOOGLE_DESKTOP_OAUTH_JSON). Forbid dedicated
    // *_CLIENT_SECRET env names and any secret material in frontend sources.
    const forbiddenEnv = /\b(?:GMAIL|GOOGLE|MS|MICROSOFT)_CLIENT_SECRET\b/;
    const forbiddenLiteral = /["']client_secret["']/;
    const frontend = productionSources().filter((path) => {
      const rel = relative(root, path);
      return (
        !rel.startsWith("services/") &&
        !rel.startsWith("crates/") &&
        !rel.endsWith(".rs")
      );
    });
    const inspected = [
      ...frontend,
      resolve(root, "secrets/dev.example.yaml"),
      resolve(root, "apps/web/src-tauri/tauri.conf.json"),
    ];
    const offenders = inspected
      .filter((path) => {
        const text = readFileSync(path, "utf8");
        return forbiddenEnv.test(text) || forbiddenLiteral.test(text);
      })
      .map((path) => relative(root, path));

    expect(offenders).toEqual([]);
  });

  it("documents local secrets via sops instead of dotenv", () => {
    const example = readFileSync(
      resolve(root, "secrets/dev.example.yaml"),
      "utf8",
    );
    expect(example).toContain("VITE_GOOGLE_DESKTOP_CLIENT_ID");
    expect(example).toContain("VITE_GOOGLE_IOS_CLIENT_ID");
    expect(example).toContain("GOOGLE_DESKTOP_OAUTH_JSON");
    expect(existsSync(resolve(root, "secrets/dev.example.json"))).toBe(false);
    expect(existsSync(resolve(root, ".env.example"))).toBe(false);
  });
});

function existsSync(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}
