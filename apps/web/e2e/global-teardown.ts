import { publishMobileArtifacts } from "./mobile-artifacts";

/** After the suite, gather videos + write the browsable gallery/manifest. */
export default async function globalTeardown() {
  const manifest = publishMobileArtifacts();
  console.log(
    `[mobile-ux] artifacts: ${manifest.shots.length} shots, ${manifest.videos.length} videos -> ${manifest.artifactDir}`,
  );
}
