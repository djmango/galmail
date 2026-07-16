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

function ensureLocalTeamConfig() {
  if (!existsSync(localConf)) {
    writeFileSync(
      localConf,
      `${JSON.stringify(
        {
          $schema: "https://schema.tauri.app/config/2",
          bundle: { iOS: { developmentTeam: TEAM_ID } },
        },
        null,
        2,
      )}\n`,
    );
    console.log(`→ Wrote ${localConf} (gitignored)`);
  }
}

function ensureProject() {
  console.log("→ Generating Xcode project…");
  run("xcodegen", [
    "generate",
    "--spec",
    join(appleDir, "project.yml"),
    "--project",
    appleDir,
  ]);

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

const auth = resolveAuth();
try {
  ensureLocalTeamConfig();
  ensureProject();
  mkdirSync(buildRoot, { recursive: true });

  if (!skipFrontend) {
    console.log("→ Building frontend…");
    run("bun", ["run", "--cwd", "apps/web", "build"]);
  }

  console.log(`→ Archiving ${SCHEME} (${BUNDLE_ID})…`);
  run("xcodebuild", [
    "-project",
    iosProject,
    "-scheme",
    SCHEME,
    "-configuration",
    "Release",
    "-destination",
    "generic/platform=iOS",
    "-archivePath",
    archivePath,
    "-allowProvisioningUpdates",
    ...xcodeAuthArgs(auth),
    `DEVELOPMENT_TEAM=${TEAM_ID}`,
    "archive",
  ]);

  if (archiveOnly) {
    console.log(`\nDone. Archive at ${archivePath}`);
    process.exit(0);
  }

  console.log(
    exportOnly
      ? "→ Exporting IPA…"
      : "→ Exporting IPA (app-store-connect)…",
  );
  run("xcodebuild", [
    "-exportArchive",
    "-archivePath",
    archivePath,
    "-exportPath",
    exportDir,
    "-exportOptionsPlist",
    exportOnly ? exportPlist : uploadPlist,
    "-allowProvisioningUpdates",
    ...xcodeAuthArgs(auth),
  ]);

  if (exportOnly) {
    console.log(`\nDone. IPA at ${exportDir}/`);
  } else {
    // upload plist destination=upload may already upload; also push via altool as fallback
    try {
      uploadIpa(auth, findIpa(exportDir));
    } catch (err) {
      console.warn(
        "altool upload skipped/failed (export may have uploaded already):",
        err instanceof Error ? err.message : err,
      );
    }
    console.log(
      `\nDone. Create the ASC app for ${BUNDLE_ID} if missing, then check TestFlight.`,
    );
    console.log(
      `https://appstoreconnect.apple.com/apps → GalMail → TestFlight`,
    );
  }
} finally {
  auth.cleanup?.();
}
