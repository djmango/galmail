/**
 * Local mirror of the ios-project CI job: generate Xcode project, run
 * GalMailAppleTests on a Simulator, and build both app extensions.
 */
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const appleRoot = resolve(import.meta.dir, "../apps/web/src-tauri/gen/apple");

function run(command: string, args: string[], cwd = appleRoot): void {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run("xcodegen", [
  "generate",
  "--spec",
  resolve(appleRoot, "project.yml"),
  "--project",
  appleRoot,
]);

const destination = spawnSync(
  "python3",
  [
    "-c",
    `
import json, subprocess, sys
raw = subprocess.check_output(["xcrun", "simctl", "list", "devices", "available", "-j"])
data = json.loads(raw)
for runtime, devices in data.get("devices", {}).items():
    if "iOS" not in runtime:
        continue
    for device in devices:
        if device.get("isAvailable") and "iPhone" in device.get("name", ""):
            print(f"platform=iOS Simulator,id={device['udid']}")
            raise SystemExit(0)
raise SystemExit("no available iPhone simulator")
`,
  ],
  { encoding: "utf8" },
);
if (destination.status !== 0) {
  console.error(destination.stderr || destination.stdout);
  process.exit(destination.status ?? 1);
}
const dest = destination.stdout.trim();
console.log(`Using destination: ${dest}`);

run("xcodebuild", [
  "test",
  "-project",
  "galmail-tauri.xcodeproj",
  "-scheme",
  "GalMailAppleTests",
  "-destination",
  dest,
  "CODE_SIGNING_ALLOWED=NO",
]);

for (const target of ["GalMailNotificationService", "GalMailShareExtension"]) {
  run("xcodebuild", [
    "-project",
    "galmail-tauri.xcodeproj",
    "-target",
    target,
    "-sdk",
    "iphonesimulator",
    "-destination",
    "generic/platform=iOS Simulator",
    "CODE_SIGNING_ALLOWED=NO",
    "build",
  ]);
}

console.log("ios:check passed");
