import { publishMobileArtifacts } from "./mobile-artifacts";

const manifest = publishMobileArtifacts();
console.log(
  JSON.stringify(
    {
      artifactDir: manifest.artifactDir,
      shots: manifest.shots.length,
      videos: manifest.videos.length,
      index: `${manifest.artifactDir}/index.html`,
    },
    null,
    2,
  ),
);
