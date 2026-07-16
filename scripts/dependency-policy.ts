import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

type Component = {
  type: "library";
  name: string;
  version: string;
  licenses: Array<{ license: { name: string } }>;
  purl: string;
};

const root = resolve(import.meta.dir, "..");
const denied = /\b(?:AGPL|GPL|SSPL|BUSL)(?:-|$)/i;
const components = new Map<string, Component>();
const violations: string[] = [];

const nodePackages = new Bun.Glob(
  "node_modules/.bun/*/node_modules/**/package.json",
);
for await (const path of nodePackages.scan({ cwd: root, onlyFiles: true })) {
  const manifest = (await Bun.file(resolve(root, path)).json()) as {
    name?: string;
    version?: string;
    license?: string | { type?: string };
    private?: boolean;
  };
  if (!manifest.name || !manifest.version || manifest.private) continue;
  const license =
    typeof manifest.license === "string"
      ? manifest.license
      : manifest.license?.type;
  if (!license)
    violations.push(
      `npm:${manifest.name}@${manifest.version}: missing license`,
    );
  if (license && denied.test(license)) {
    violations.push(
      `npm:${manifest.name}@${manifest.version}: denied ${license}`,
    );
  }
  const key = `npm:${manifest.name}@${manifest.version}`;
  components.set(key, {
    type: "library",
    name: manifest.name,
    version: manifest.version,
    licenses: [{ license: { name: license ?? "NOASSERTION" } }],
    purl: `pkg:npm/${encodeURIComponent(manifest.name)}@${manifest.version}`,
  });
}

for (const manifest of ["Cargo.toml", "apps/web/src-tauri/Cargo.toml"]) {
  const cargo = Bun.spawnSync(
    [
      "cargo",
      "metadata",
      "--format-version",
      "1",
      "--locked",
      "--manifest-path",
      manifest,
    ],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  if (!cargo.success) {
    throw new Error(`cargo metadata failed: ${cargo.stderr.toString()}`);
  }
  const metadata = JSON.parse(cargo.stdout.toString()) as {
    packages: Array<{
      name: string;
      version: string;
      license: string | null;
      source: string | null;
    }>;
  };
  for (const pkg of metadata.packages.filter((item) => item.source !== null)) {
    if (!pkg.license)
      violations.push(`cargo:${pkg.name}@${pkg.version}: missing license`);
    if (pkg.license && denied.test(pkg.license)) {
      violations.push(
        `cargo:${pkg.name}@${pkg.version}: denied ${pkg.license}`,
      );
    }
    const key = `cargo:${pkg.name}@${pkg.version}`;
    components.set(key, {
      type: "library",
      name: pkg.name,
      version: pkg.version,
      licenses: [{ license: { name: pkg.license ?? "NOASSERTION" } }],
      purl: `pkg:cargo/${pkg.name}@${pkg.version}`,
    });
  }
}

if (violations.length > 0) {
  throw new Error(`Dependency policy failed:\n${violations.sort().join("\n")}`);
}

const sbomFlag = process.argv.indexOf("--sbom");
if (sbomFlag >= 0) {
  const output = process.argv[sbomFlag + 1];
  if (!output) throw new Error("--sbom requires an output path");
  const absolute = resolve(root, output);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(
    absolute,
    `${JSON.stringify(
      {
        bomFormat: "CycloneDX",
        specVersion: "1.6",
        serialNumber: `urn:uuid:${crypto.randomUUID()}`,
        version: 1,
        metadata: {
          component: { type: "application", name: "galmail", version: "0.1.0" },
        },
        components: [...components.values()].sort((a, b) =>
          a.purl.localeCompare(b.purl),
        ),
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(`Wrote ${relative(root, absolute)}.\n`);
} else {
  process.stdout.write(
    `Dependency licenses passed for ${components.size} locked components.\n`,
  );
}
