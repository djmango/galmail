import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const [bundleDirectory, repository, tag, version, channel, output] =
  process.argv.slice(2);

if (
  !bundleDirectory ||
  !repository ||
  !tag ||
  !version ||
  !channel ||
  !output
) {
  throw new Error(
    "usage: create-updater-manifest <bundle> <repo> <tag> <version> <channel> <output>",
  );
}

async function filesBelow(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? filesBelow(path) : [path];
    }),
  );
  return files.flat();
}

const files = await filesBelow(bundleDirectory);
const updaterArchive = files.find((path) => path.endsWith(".app.tar.gz"));
if (!updaterArchive) {
  throw new Error("Tauri updater archive was not generated");
}
const signaturePath = `${updaterArchive}.sig`;
if (!files.includes(signaturePath)) {
  throw new Error("Tauri updater signature was not generated");
}

const encodedName = encodeURIComponent(basename(updaterArchive));
const manifest = {
  version,
  notes: `GalMail ${version} ${channel} release`,
  pub_date: new Date().toISOString(),
  platforms: {
    "darwin-aarch64": {
      signature: (await readFile(signaturePath, "utf8")).trim(),
      url: `https://github.com/${repository}/releases/download/${tag}/${encodedName}`,
    },
  },
};

await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, {
  mode: 0o600,
});
