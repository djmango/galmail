import {
  mkdirSync,
  writeFileSync,
  existsSync,
  cpSync,
  readdirSync,
  readFileSync,
  appendFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "../..");
const SHOTS_LOG = "shots.jsonl";

export type MobileShot = {
  id: string;
  file: string;
  title: string;
  test?: string;
  at: string;
};

export type MobileArtifactManifest = {
  generatedAt: string;
  artifactDir: string;
  device: string;
  shots: MobileShot[];
  videos: Array<{ file: string; source: string }>;
};

/** Prefer Cursor cloud artifacts dir when writable; else local test-results. */
export function resolveMobileArtifactDir(): string {
  const fromEnv = process.env.GALMAIL_E2E_ARTIFACT_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);

  const cursorDir = "/opt/cursor/artifacts/mobile-ux";
  try {
    mkdirSync(cursorDir, { recursive: true });
    return cursorDir;
  } catch {
    // Fall through when the Cursor mount is unavailable (local/CI).
  }

  return path.join(WEB_ROOT, "test-results", "mobile-ux");
}

export function ensureMobileArtifactDir(): string {
  const dir = resolveMobileArtifactDir();
  mkdirSync(dir, { recursive: true });
  mkdirSync(path.join(dir, "videos"), { recursive: true });
  return dir;
}

export function resetMobileArtifactShots(): void {
  const dir = ensureMobileArtifactDir();
  writeFileSync(path.join(dir, SHOTS_LOG), "", "utf8");
}

function readShotsLog(): MobileShot[] {
  const dir = resolveMobileArtifactDir();
  const logPath = path.join(dir, SHOTS_LOG);
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as MobileShot];
      } catch {
        return [];
      }
    });
}

export function listMobileArtifactShots(): MobileShot[] {
  const deduped = new Map<string, MobileShot>();
  for (const shot of readShotsLog()) deduped.set(shot.id, shot);
  return [...deduped.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Capture a full-page PNG into the mobile UX artifact directory and append it
 * to the on-disk shot log (survives Playwright worker restarts).
 */
export async function captureMobileShot(
  page: Page,
  id: string,
  title: string,
  testTitle?: string,
): Promise<string> {
  const dir = ensureMobileArtifactDir();
  const file = `${id}.png`;
  const abs = path.join(dir, file);
  await page.screenshot({ path: abs, fullPage: true });
  const shot: MobileShot = {
    id,
    file,
    title,
    test: testTitle,
    at: new Date().toISOString(),
  };
  appendFileSync(
    path.join(dir, SHOTS_LOG),
    `${JSON.stringify(shot)}\n`,
    "utf8",
  );
  return abs;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function writeMobileArtifactGallery(input?: {
  videos?: Array<{ file: string; source: string }>;
  device?: string;
}): MobileArtifactManifest {
  const dir = ensureMobileArtifactDir();
  const videos = input?.videos ?? [];
  const orderedShots = listMobileArtifactShots();
  const manifest: MobileArtifactManifest = {
    generatedAt: new Date().toISOString(),
    artifactDir: dir,
    device: input?.device ?? "Pixel 7 (mobile-chrome)",
    shots: orderedShots,
    videos,
  };

  writeFileSync(
    path.join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  const shotCards = manifest.shots
    .map(
      (shot) => `
    <figure class="card">
      <a href="${escapeHtml(shot.file)}" target="_blank" rel="noreferrer">
        <img src="${escapeHtml(shot.file)}" alt="${escapeHtml(shot.title)}" loading="lazy" />
      </a>
      <figcaption>
        <strong>${escapeHtml(shot.id)}</strong>
        <span>${escapeHtml(shot.title)}</span>
        ${shot.test ? `<em>${escapeHtml(shot.test)}</em>` : ""}
      </figcaption>
    </figure>`,
    )
    .join("\n");

  const videoCards = videos
    .map(
      (video) => `
    <figure class="card video">
      <video controls playsinline src="${escapeHtml(video.file)}"></video>
      <figcaption>
        <strong>${escapeHtml(path.basename(video.file))}</strong>
        <span>${escapeHtml(video.source)}</span>
      </figcaption>
    </figure>`,
    )
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>GalMail mobile UX e2e gallery</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; padding: 1.25rem; background: #0c0d10; color: #e8e9ed; }
    h1 { margin: 0 0 0.35rem; font-size: 1.35rem; }
    .meta { color: #9aa0ad; margin-bottom: 1.25rem; font-size: 0.9rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
    .card { margin: 0; background: #16181e; border: 1px solid #2a2e38; border-radius: 12px; overflow: hidden; }
    .card img, .card video { display: block; width: 100%; background: #000; }
    figcaption { display: grid; gap: 0.2rem; padding: 0.7rem 0.8rem 0.85rem; font-size: 0.85rem; }
    figcaption strong { font-size: 0.78rem; color: #8ab4ff; }
    figcaption em { color: #8b919e; font-style: normal; font-size: 0.78rem; }
    h2 { margin: 1.75rem 0 0.75rem; font-size: 1.05rem; }
  </style>
</head>
<body>
  <h1>GalMail mobile UX e2e gallery</h1>
  <p class="meta">${escapeHtml(manifest.device)} · ${escapeHtml(manifest.generatedAt)} · ${manifest.shots.length} shots · ${videos.length} videos<br/>${escapeHtml(dir)}</p>
  <h2>Screenshots</h2>
  <div class="grid">
    ${shotCards || "<p class='meta'>No screenshots captured.</p>"}
  </div>
  <h2>Videos</h2>
  <div class="grid">
    ${videoCards || "<p class='meta'>No videos collected yet. Re-run with video recording enabled.</p>"}
  </div>
</body>
</html>
`;
  writeFileSync(path.join(dir, "index.html"), html, "utf8");
  writeFileSync(
    path.join(dir, "README.md"),
    [
      "# Mobile UX e2e artifacts",
      "",
      `- Generated: ${manifest.generatedAt}`,
      `- Device: ${manifest.device}`,
      "- Open `index.html` for the gallery.",
      "- Machine-readable: `manifest.json`.",
      "",
      "## Shots",
      ...manifest.shots.map((s) => `- \`${s.file}\`: ${s.title}`),
      "",
      "## Videos",
      ...(videos.length
        ? videos.map((v) => `- \`${v.file}\` (from ${v.source})`)
        : ["- (none)"]),
      "",
    ].join("\n"),
    "utf8",
  );

  return manifest;
}

/** Copy Playwright .webm recordings into the artifact gallery videos/ folder. */
export function collectMobileVideos(
  testResultsDir = path.join(WEB_ROOT, "test-results"),
): Array<{
  file: string;
  source: string;
}> {
  const dir = ensureMobileArtifactDir();
  const videosDir = path.join(dir, "videos");
  const collected: Array<{ file: string; source: string }> = [];
  if (!existsSync(testResultsDir)) return collected;

  const stack = [testResultsDir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "mobile-ux") continue;
        stack.push(abs);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".webm")) continue;
      const parent = path.basename(path.dirname(abs));
      const safe = parent
        .replace(/[^a-zA-Z0-9._-]+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 80);
      const destName = `${safe || "run"}.webm`;
      const dest = path.join(videosDir, destName);
      cpSync(abs, dest);
      collected.push({
        file: path.join("videos", destName),
        source: path.relative(REPO_ROOT, abs),
      });
    }
  }
  return collected;
}

export function publishMobileArtifacts(): MobileArtifactManifest {
  const videos = collectMobileVideos();
  return writeMobileArtifactGallery({ videos });
}
