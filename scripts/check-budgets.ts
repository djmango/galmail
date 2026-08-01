import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const dist = resolve(import.meta.dir, "../apps/web/dist");
const limits = {
  // Multi-account + calendar shell landed above the original 100 KiB target;
  // native mobile gestures / mailbox search landed above 150 KiB.
  // DOMPurify-backed mail HTML sanitizer lands above 155 KiB.
  ".js": 185 * 1024,
  ".css": 20 * 1024,
} as const;
// Mobile gestures / settings shell landed above the original 600 KiB target.
// Mail sanitizer (DOMPurify) pushes the uncompressed total above 650 KiB.
const totalUncompressedLimit = 720 * 1024;

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

const files = filesUnder(dist);
let total = 0;
for (const file of files) {
  const contents = readFileSync(file);
  total += contents.byteLength;
  const extension = extname(file) as keyof typeof limits;
  const limit = limits[extension];
  if (limit) {
    const compressed = gzipSync(contents).byteLength;
    if (compressed > limit) {
      throw new Error(
        `${file.slice(dist.length + 1)} is ${compressed} gzip bytes; budget is ${limit}`,
      );
    }
  }
}

if (total > totalUncompressedLimit) {
  throw new Error(
    `web dist is ${total} bytes; budget is ${totalUncompressedLimit}`,
  );
}

process.stdout.write(
  `Bundle budgets passed: ${files.length} files, ${total} uncompressed bytes.\n`,
);
