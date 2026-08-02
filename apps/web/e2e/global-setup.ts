import { resetMobileArtifactShots } from "./mobile-artifacts";

/** Clear the previous gallery shot log once before the suite starts. */
export default async function globalSetup() {
  resetMobileArtifactShots();
}
