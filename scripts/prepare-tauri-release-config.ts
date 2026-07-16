import { writeFile } from "node:fs/promises";

const [
  channel,
  version,
  repository,
  updaterPublicKey,
  signingIdentity,
  output,
] = process.argv.slice(2);

if (!["alpha", "beta", "stable"].includes(channel ?? "")) {
  throw new Error("channel must be alpha, beta, or stable");
}
if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta)\.\d+)?$/.test(version ?? "")) {
  throw new Error("version must be a supported semantic release version");
}
if (
  (channel === "stable" && version.includes("-")) ||
  (channel !== "stable" && !version.includes(`-${channel}.`))
) {
  throw new Error(
    `version ${version} does not belong to the ${channel} channel`,
  );
}
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
  throw new Error("repository must use owner/name syntax");
}
if (!updaterPublicKey || updaterPublicKey.includes("REPLACE")) {
  throw new Error("a real Tauri updater public key is required");
}
if (!signingIdentity?.startsWith("Developer ID Application:")) {
  throw new Error("a Developer ID Application signing identity is required");
}
if (!output) {
  throw new Error("output path is required");
}

const suffix = channel === "stable" ? "" : `.${channel}`;
const displaySuffix =
  channel === "stable"
    ? ""
    : ` ${channel[0]!.toUpperCase()}${channel.slice(1)}`;
const configuration = {
  productName: `GalMail${displaySuffix}`,
  version,
  identifier: `app.galmail.client${suffix}`,
  bundle: {
    createUpdaterArtifacts: true,
    macOS: {
      signingIdentity,
    },
  },
  plugins: {
    updater: {
      endpoints: [
        `https://github.com/${repository}/releases/download/updates-${channel}/latest.json`,
      ],
      pubkey: updaterPublicKey,
    },
  },
};

await writeFile(output, `${JSON.stringify(configuration, null, 2)}\n`, {
  mode: 0o600,
});
