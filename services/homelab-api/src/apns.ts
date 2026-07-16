import { createEs256Jwt } from "./crypto.js";
import type { HomelabConfig } from "./config.js";
import { apnsConfigured } from "./config.js";

/** Generic blind payload: never include subject, snippet, or body. */
const BLIND_ALERT = {
  aps: {
    alert: {
      title: "New mail",
      body: "Open GalMail to fetch updates.",
    },
    "content-available": 1,
  },
} as const;

export type ApnsSendResult = {
  status: number;
  reason?: string;
  dryRun: boolean;
};

export async function sendApns(
  config: HomelabConfig,
  deviceToken: string,
  sandbox: boolean,
): Promise<ApnsSendResult> {
  if (!/^[a-fA-F0-9]{64,200}$/.test(deviceToken)) {
    throw new Error("invalid APNs token");
  }
  if (!apnsConfigured(config)) {
    return { status: 0, reason: "apns_not_configured", dryRun: true };
  }

  const jwt = await createEs256Jwt(
    config.apnsPrivateKey,
    { alg: "ES256", kid: config.apnsKeyId },
    { iss: config.apnsTeamId, iat: Math.floor(Date.now() / 1000) },
  );
  const host = sandbox
    ? "api.sandbox.push.apple.com"
    : "api.push.apple.com";
  const response = await fetch(`https://${host}/3/device/${deviceToken}`, {
    method: "POST",
    headers: {
      authorization: `bearer ${jwt}`,
      "apns-topic": config.apnsTopic,
      "apns-push-type": "alert",
      "apns-priority": "5",
      "content-type": "application/json",
    },
    body: JSON.stringify(BLIND_ALERT),
  });

  let reason: string | undefined;
  if (!response.ok) {
    try {
      const body = (await response.json()) as { reason?: string };
      reason = body.reason;
    } catch {
      reason = `http_${response.status}`;
    }
  }
  return { status: response.status, reason, dryRun: false };
}
