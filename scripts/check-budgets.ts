import { readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const dist = resolve(import.meta.dir, "../apps/web/dist");
const limits = {
  ".js": 100 * 1024,
  ".css": 20 * 1024,
} as const;
const totalUncompressedLimit = 350 * 1024;

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
