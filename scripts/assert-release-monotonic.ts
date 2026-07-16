import { readFile } from "node:fs/promises";

const [currentVersion, previousManifestPath] = process.argv.slice(2);

type Version = {
  major: number;
  minor: number;
  patch: number;
  channel: "alpha" | "beta" | "stable";
  sequence: number;
};

function parse(value: string): Version {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta)\.(\d+))?$/.exec(value);
  if (!match) {
    throw new Error(`unsupported release version: ${value}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    channel: (match[4] as Version["channel"] | undefined) ?? "stable",
    sequence: Number(match[5] ?? 0),
  };
}

const current = parse(currentVersion ?? "");
const manifest = JSON.parse(await readFile(previousManifestPath ?? "", "utf8"));
const previous = parse(String(manifest.version ?? ""));
if (current.channel !== previous.channel) {
  throw new Error("channel manifest contains a version from another channel");
}

const currentOrder = [
  current.major,
  current.minor,
  current.patch,
  current.sequence,
];
const previousOrder = [
  previous.major,
  previous.minor,
  previous.patch,
  previous.sequence,
];
let comparison = 0;
for (let index = 0; index < currentOrder.length; index += 1) {
  comparison = currentOrder[index]! - previousOrder[index]!;
  if (comparison !== 0) {
    break;
  }
}

if (comparison <= 0) {
  throw new Error(
    `refusing channel rollback from ${manifest.version} to ${currentVersion}`,
  );
}
