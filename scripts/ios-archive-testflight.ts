#!/usr/bin/env bun
/**
 * Archive GalMail (Tauri 2 iOS) for TestFlight and upload to App Store Connect.
 *
 * Auth (first match wins):
 *   1. Env APP_STORE_CONNECT_API_KEY_{PATH,ID,ISSUER_ID}
 *   2. 1Password item "galatea admin app store connect api AuthKey_YSZLYKSL3L.p8"
 *      plus issuer from Grack SOPS (or APP_STORE_CONNECT_API_ISSUER_ID)
 *
 * Usage:
 *   bun scripts/ios-archive-testflight.ts
 *   bun scripts/ios-archive-testflight.ts --export-only
 *   bun scripts/ios-archive-testflight.ts --archive-only
 *   bun scripts/ios-archive-testflight.ts --skip-frontend
 */
import { execFileSync, execSync } from "node:child_process";
import { createPrivateKey, createSign } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appleDir = join(repoRoot, "apps/web/src-tauri/gen/apple");
const iosProject = join(appleDir, "galmail-tauri.xcodeproj");
const localConf = join(
  repoRoot,
  "apps/web/src-tauri/tauri.ios.local.conf.json",
);
const buildRoot = join(repoRoot, ".local/ios-build");
const archivePath = join(buildRoot, "GalMail.xcarchive");
const exportDir = join(buildRoot, "export");
const uploadPlist = join(appleDir, "ExportOptions-upload.plist");
const exportPlist = join(appleDir, "ExportOptions-export.plist");

const TEAM_ID = "A95F4H2423";
const SCHEME = "galmail-tauri_iOS";
const BUNDLE_ID = "com.galateacorp.mail";
/** App Store Connect numeric app id (GalMail). */
const ASC_APP_ID = "6791719499";

const args = process.argv.slice(2);
const exportOnly = args.includes("--export-only");
const archiveOnly = args.includes("--archive-only");
const skipFrontend = args.includes("--skip-frontend");

type AscAuth = {
  keyPath: string;
  keyId: string;
  issuerId: string;
  cleanup?: () => void;
};

function expandHome(path: string) {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

const xcodePathEnv = {
  ...process.env,
  CI: "true",
  PATH: `/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH ?? ""}`,
};

function run(cmd: string, cmdArgs: string[], cwd = repoRoot) {
  execFileSync(cmd, cmdArgs, {
    cwd,
    stdio: "inherit",
    env: cmd === "xcodebuild" ? xcodePathEnv : process.env,
  });
}

function authFromEnv(): AscAuth | null {
  const keyPath = expandHome(process.env.APP_STORE_CONNECT_API_KEY_PATH ?? "");
  const keyId = process.env.APP_STORE_CONNECT_API_KEY_ID?.trim();
  const issuerId = process.env.APP_STORE_CONNECT_API_ISSUER_ID?.trim();
  if (!keyPath && !keyId && !issuerId) return null;
  if (!keyPath || !keyId || !issuerId) {
    throw new Error(
      "Need all of APP_STORE_CONNECT_API_KEY_PATH, APP_STORE_CONNECT_API_KEY_ID, APP_STORE_CONNECT_API_ISSUER_ID",
    );
  }
  if (!existsSync(keyPath)) {
    throw new Error(`ASC API key not found at ${keyPath}`);
  }
  return { keyPath, keyId, issuerId };
}

function authFromOnePassword(): AscAuth | null {
  try {
    execFileSync("op", ["whoami"], { stdio: "pipe" });
  } catch {
    return null;
  }

  const dir = mkdtempSync(join(tmpdir(), "galmail-asc-"));
  const keyPath = join(dir, "AuthKey_YSZLYKSL3L.p8");
  try {
    execFileSync(
      "op",
      [
        "document",
        "get",
        "galatea admin app store connect api AuthKey_YSZLYKSL3L.p8",
        "--out-file",
        keyPath,
      ],
      { stdio: "pipe" },
    );
  } catch {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }

  let issuerId = process.env.APP_STORE_CONNECT_API_ISSUER_ID?.trim();
  if (!issuerId) {
    // Prefer issuer already staged by a previous session, else Grack SOPS.
    const staged = "/tmp/galmail-asc/issuer.txt";
    if (existsSync(staged)) {
      issuerId = readFileSync(staged, "utf8").trim();
    } else {
      const sshDir = mkdtempSync(join(tmpdir(), "galmail-sops-ssh-"));
      const sshKey = join(sshDir, "id_ed25519");
      try {
        writeFileSync(
          sshKey,
          execFileSync(
            "op",
            ["read", "op://Private/id_ed25519/private key"],
            { encoding: "utf8" },
          ),
          { mode: 0o600 },
        );
        issuerId = execFileSync(
          "sops",
          [
            "-d",
            "--extract",
            '["mobile"]["ios"]["app_store_connect"]["issuer_id"]',
            join(homedir(), "github/grack/secrets.yaml"),
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              SOPS_AGE_SSH_PRIVATE_KEY_FILE: sshKey,
            },
          },
        ).trim();
      } finally {
        rmSync(sshDir, { recursive: true, force: true });
      }
    }
  }

  if (!issuerId) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(
      "ASC issuer id missing. Set APP_STORE_CONNECT_API_ISSUER_ID.",
    );
  }

  return {
    keyPath,
    keyId: "YSZLYKSL3L",
    issuerId,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

function resolveAuth(): AscAuth {
  const fromEnv = authFromEnv();
  if (fromEnv) {
    console.log("→ Using ASC API key from environment");
    return fromEnv;
  }
  const fromOp = authFromOnePassword();
  if (fromOp) {
    console.log("→ Using ASC API key from 1Password");
    return fromOp;
  }
  throw new Error(
    "No ASC API credentials. Set APP_STORE_CONNECT_API_KEY_* or unlock 1Password CLI.",
  );
}

function xcodeAuthArgs(auth: AscAuth) {
  return [
    "-authenticationKeyPath",
    auth.keyPath,
    "-authenticationKeyID",
    auth.keyId,
    "-authenticationKeyIssuerID",
    auth.issuerId,
  ];
}

function ensureLocalTeamConfig(buildNumber: string) {
  const iosBundle: Record<string, string> = { developmentTeam: TEAM_ID };
  if (buildNumber) {
    // Tauri maps bundle.iOS.bundleVersion → CFBundleVersion for App Store uniqueness.
    iosBundle.bundleVersion = buildNumber;
  }
  writeFileSync(
    localConf,
    `${JSON.stringify(
      {
        $schema: "https://schema.tauri.app/config/2",
        bundle: { iOS: iosBundle },
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    buildNumber
      ? `→ Wrote ${localConf} (team ${TEAM_ID}, CFBundleVersion ${buildNumber})`
      : `→ Wrote ${localConf} (team ${TEAM_ID})`,
  );
}

function ensureProject(buildNumber: string) {
  const projectYml = join(appleDir, "project.yml");
  let specPath = projectYml;
  let temporarySpec: string | null = null;
  if (buildNumber) {
    temporarySpec = join(appleDir, `.project.ci-${buildNumber}.yml`);
    writeFileSync(
      temporarySpec,
      readFileSync(projectYml, "utf8").replace(
        /CFBundleVersion:\s*["']?[^"'\n]+["']?/g,
        `CFBundleVersion: "${buildNumber}"`,
      ),
    );
    specPath = temporarySpec;
    console.log(`→ Using CFBundleVersion=${buildNumber} for this archive`);
  }

  try {
    // project.yml references `assets/`; sync may not have run yet and the
    // directory is gitignored, so ensure it exists before XcodeGen validates.
    mkdirSync(join(appleDir, "assets"), { recursive: true });
    console.log("→ Generating Xcode project…");
    run("xcodegen", ["generate", "--spec", specPath, "--project", appleDir]);
  } finally {
    if (temporarySpec) {
      rmSync(temporarySpec, { force: true });
    }
  }

  // Inject team into generated pbxproj for this machine only (project.yml stays empty).
  const pbx = join(iosProject, "project.pbxproj");
  const text = readFileSync(pbx, "utf8");
  if (text.includes('DEVELOPMENT_TEAM = "";')) {
    writeFileSync(
      pbx,
      text.replaceAll('DEVELOPMENT_TEAM = "";', `DEVELOPMENT_TEAM = ${TEAM_ID};`),
    );
    console.log(`→ Set DEVELOPMENT_TEAM=${TEAM_ID} in generated pbxproj (not source yml)`);
  }
}

function uploadIpa(auth: AscAuth, ipaPath: string) {
  const keysDir = join(dirname(auth.keyPath), "private_keys");
  mkdirSync(keysDir, { recursive: true });
  const linked = join(keysDir, `AuthKey_${auth.keyId}.p8`);
  if (!existsSync(linked)) {
    execFileSync("ln", ["-sf", auth.keyPath, linked]);
  }
  console.log("→ Uploading IPA via altool…");
  run("xcrun", [
    "altool",
    "--upload-app",
    "-f",
    ipaPath,
    "--type",
    "ios",
    "--apiKey",
    auth.keyId,
    "--apiIssuer",
    auth.issuerId,
  ]);
}

function findIpa(dir: string) {
  const ipa = execSync(`ls "${dir}"/*.ipa 2>/dev/null | head -1`, {
    encoding: "utf8",
  }).trim();
  if (!ipa) throw new Error(`No .ipa in ${dir}`);
  return ipa;
}

function ascJwt(auth: AscAuth): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "ES256", kid: auth.keyId, typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      iss: auth.issuerId,
      iat: now,
      exp: now + 20 * 60,
      aud: "appstoreconnect-v1",
    }),
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const key = createPrivateKey(readFileSync(auth.keyPath));
  const signer = createSign("SHA256");
  signer.update(data);
  signer.end();
  const sig = signer
    .sign({ key, dsaEncoding: "ieee-p1363" })
    .toString("base64url");
  return `${data}.${sig}`;
}

/** Highest CFBundleVersion already on App Store Connect, or null if unknown. */
async function latestAscBuildNumber(auth: AscAuth): Promise<number | null> {
  try {
    const token = ascJwt(auth);
    const url = new URL("https://api.appstoreconnect.apple.com/v1/builds");
    url.searchParams.set("filter[app]", ASC_APP_ID);
    // uploadedDate avoids lexicographic "version" sort bugs (e.g. "9" > "10").
    url.searchParams.set("sort", "-uploadedDate");
    url.searchParams.set("limit", "50");
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      console.warn(
        `→ ASC builds query failed (${response.status}); falling back for build number`,
      );
      return null;
    }
    const body = (await response.json()) as {
      data?: Array<{ attributes?: { version?: string } }>;
    };
    const versions = (body.data ?? [])
      .map((b) => b.attributes?.version?.trim())
      .filter((v): v is string => !!v && /^\d+$/.test(v))
      .map(Number);
    if (versions.length === 0) return null;
    return Math.max(...versions);
  } catch (error) {
    console.warn(
      "→ ASC builds query error; falling back for build number:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/** Wait for ASC to finish processing, then clear export-compliance so TestFlight can ship. */
async function submitExportCompliance(
  auth: AscAuth,
  buildNumber: string,
): Promise<void> {
  const token = ascJwt(auth);
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  const deadline = Date.now() + 8 * 60 * 1000;
  let buildId: string | null = null;

  console.log(
    `→ Waiting for ASC to process CFBundleVersion=${buildNumber} (export compliance)…`,
  );
  while (Date.now() < deadline) {
    const url = new URL("https://api.appstoreconnect.apple.com/v1/builds");
    url.searchParams.set("filter[app]", ASC_APP_ID);
    url.searchParams.set("filter[version]", buildNumber);
    url.searchParams.set("sort", "-uploadedDate");
    url.searchParams.set("limit", "1");
    const response = await fetch(url, {
      headers: { Authorization: headers.Authorization },
    });
    if (response.ok) {
      const body = (await response.json()) as {
        data?: Array<{
          id: string;
          attributes?: { processingState?: string };
        }>;
      };
      const build = body.data?.[0];
      if (build) {
        buildId = build.id;
        const state = build.attributes?.processingState ?? "UNKNOWN";
        if (state === "VALID" || state === "INVALID") break;
        console.log(`  processingState=${state}; retrying…`);
      }
    }
    await new Promise((r) => setTimeout(r, 15_000));
  }

  if (!buildId) {
    console.warn(
      "→ ASC build not visible yet; answer export compliance in App Store Connect if TestFlight stays blocked.",
    );
    return;
  }

  const patch = await fetch(
    `https://api.appstoreconnect.apple.com/v1/builds/${buildId}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        data: {
          type: "builds",
          id: buildId,
          attributes: { usesNonExemptEncryption: false },
        },
      }),
    },
  );
  if (!patch.ok) {
    const err = await patch.text();
    throw new Error(
      `Failed to submit export compliance for build ${buildNumber}: ${patch.status} ${err}`,
    );
  }
  console.log(
    `→ Export compliance submitted (usesNonExemptEncryption=false) for build ${buildNumber}`,
  );
}

/**
 * Monotonic CFBundleVersion for App Store Connect.
 * Prefer max(ASC latest+1, GALMAIL_IOS_BUILD_NUMBER); else env; else unix seconds.
 */
async function resolveBuildNumber(auth: AscAuth): Promise<string> {
  const fromEnv = process.env.GALMAIL_IOS_BUILD_NUMBER?.trim();
  const envNum =
    fromEnv && /^\d+$/.test(fromEnv) ? Number(fromEnv) : null;
  const latest = await latestAscBuildNumber(auth);

  let next: number;
  if (latest !== null) {
    next = Math.max(latest + 1, envNum ?? 0);
    console.log(`→ ASC latest CFBundleVersion=${latest}; using ${next}`);
  } else if (envNum !== null) {
    next = envNum;
    console.log(
      `→ Using CFBundleVersion=${next} from GALMAIL_IOS_BUILD_NUMBER`,
    );
  } else {
    next = Math.floor(Date.now() / 1000);
    console.log(`→ Using CFBundleVersion=${next} (timestamp fallback)`);
  }
  return String(next);
}

const auth = resolveAuth();
try {
  const buildNumber = await resolveBuildNumber(auth);
  // Expose for tauri/xcodebuild subprocesses that read the env.
  process.env.GALMAIL_IOS_BUILD_NUMBER = buildNumber;

  ensureLocalTeamConfig(buildNumber);
  ensureProject(buildNumber);
  mkdirSync(buildRoot, { recursive: true });

  if (!skipFrontend) {
    run("bun", ["scripts/sync-ios-web-assets.ts", "--build"]);
  } else {
    run("bun", ["scripts/sync-ios-web-assets.ts"]);
  }

  // Prefer `tauri ios build` so the Xcode Rust script gets CLI options
  // (direct xcodebuild fails with "failed to read CLI options" WebSocket errors).
  console.log(`→ Building + exporting IPA via tauri ios build (${BUNDLE_ID})…`);
  const tauriArgs = [
    "x",
    "tauri",
    "ios",
    "build",
    "--ci",
    "--export-method",
    exportOnly || archiveOnly ? "debugging" : "app-store-connect",
    "-c",
    localConf,
  ];
  if (archiveOnly) {
    tauriArgs.push("--archive-only");
  }
  run("bun", tauriArgs, join(repoRoot, "apps/web"));

  const tauriIpa = join(
    appleDir,
    "build",
    "arm64",
    "GalMail.ipa",
  );
  if (archiveOnly) {
    console.log(`\nDone. Archive under ${join(appleDir, "build")}`);
    process.exit(0);
  }

  if (exportOnly) {
    console.log(`\nDone. IPA at ${tauriIpa}`);
  } else {
    const ipaPath = existsSync(tauriIpa) ? tauriIpa : findIpa(exportDir);
    // Must fail the job if ASC rejects the upload (e.g. duplicate build number).
    // Previously this was swallowed, so CI went green with no new TestFlight build.
    uploadIpa(auth, ipaPath);
    await submitExportCompliance(auth, buildNumber);
    console.log(`\nDone. Uploaded CFBundleVersion=${buildNumber}.`);
    console.log(`Check TestFlight (internal testers once READY_FOR_BETA_TESTING):`);
    console.log(
      `https://appstoreconnect.apple.com/apps/${ASC_APP_ID}/testflight/ios`,
    );
  }
} finally {
  auth.cleanup?.();
}
