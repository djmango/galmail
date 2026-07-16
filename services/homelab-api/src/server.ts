import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { classifyMessage } from "./ai.js";
import { sendApns } from "./apns.js";
import { apnsConfigured, type HomelabConfig } from "./config.js";
import { verifyAccountToken } from "./crypto.js";
import type { Database } from "./db.js";
import { purgeExpiredInputs } from "./db.js";

const ACCOUNT_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const DEVICE_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export type HomelabEnv = {
  Variables: {
    config: HomelabConfig;
    db: Database;
    accountId?: string;
  };
};

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HTTPException(400, { message: "invalid json" });
  }
}

async function requireAccount(
  c: {
    req: { header: (name: string) => string | undefined; param: (name: string) => string };
    get: (key: "config") => HomelabConfig;
    set: (key: "accountId", value: string) => void;
  },
  accountIdParam?: string,
): Promise<string> {
  const authorization = c.req.header("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "authentication required" });
  }
  const token = authorization.slice(7);
  const config = c.get("config");
  let accountId: string;
  try {
    accountId = await verifyAccountToken(token, config.accountAuthSecret);
  } catch {
    throw new HTTPException(401, { message: "invalid token" });
  }
  if (accountIdParam && accountId !== accountIdParam) {
    throw new HTTPException(403, { message: "account isolation violation" });
  }
  if (!ACCOUNT_PATTERN.test(accountId)) {
    throw new HTTPException(400, { message: "invalid account id" });
  }
  c.set("accountId", accountId);
  return accountId;
}

function requireAdmin(c: {
  req: { header: (name: string) => string | undefined };
  get: (key: "config") => HomelabConfig;
}): void {
  const config = c.get("config");
  const header = c.req.header("x-galmail-admin-token");
  if (!header || header !== config.apiAdminToken) {
    throw new HTTPException(401, { message: "admin token required" });
  }
}

export function createHomelabApp(
  config: HomelabConfig,
  db: Database,
): Hono<HomelabEnv> {
  const app = new Hono<HomelabEnv>();

  app.use("*", async (c, next) => {
    c.set("config", config);
    c.set("db", db);
    await next();
  });

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }
    console.error("homelab_api_error", error);
    return c.json({ error: "internal error" }, 500);
  });

  app.get("/health", async (c) => {
    const rows = await db`SELECT 1 AS ok`;
    return c.json({
      ok: rows[0]?.ok === 1,
      service: "galmail-homelab-api",
      region: config.processingRegion,
      apnsConfigured: apnsConfigured(config),
      fcmEnabled: config.fcmEnabled,
      openaiBase: config.openaiApiBase,
    });
  });

  app.get("/openapi.json", (c) =>
    c.json({
      openapi: "3.0.3",
      info: {
        title: "GalMail Homelab API",
        version: "0.1.0",
        description:
          "Self-hosted BFF for device push registration, remote opt-in consent, and optional AI classify. Mail sync stays on-device.",
      },
      paths: {
        "/health": { get: { summary: "Liveness + dependency probe" } },
        "/v1/devices": {
          post: { summary: "Register or refresh a push device" },
          get: { summary: "List active devices for the authenticated account" },
        },
        "/v1/devices/{deviceId}": {
          delete: { summary: "Revoke a device push registration" },
        },
        "/v1/push/test": {
          post: { summary: "Send a generic blind APNs test (admin token)" },
        },
        "/v1/accounts/{accountId}/consent": {
          get: { summary: "Read remote processing consent" },
          put: { summary: "Set remote processing consent" },
          delete: { summary: "Revoke consent and purge retained inputs" },
        },
        "/v1/ai/classify": {
          post: {
            summary:
              "Classify subject/snippet when account opted in (rules + optional LLM)",
          },
        },
        "/v1/dev/token": {
          post: {
            summary: "Mint a short-lived account JWT (admin; lab only)",
          },
        },
      },
    }),
  );

  app.post("/v1/devices", async (c) => {
    const accountId = await requireAccount(c);
    const body = parseJson<{
      deviceId: string;
      platform: "apns" | "fcm" | "webpush";
      pushToken: string;
      sandbox?: boolean;
      displayName?: string;
    }>(await c.req.text());

    if (!DEVICE_PATTERN.test(body.deviceId ?? "")) {
      throw new HTTPException(400, { message: "invalid deviceId" });
    }
    if (!["apns", "fcm", "webpush"].includes(body.platform)) {
      throw new HTTPException(400, { message: "invalid platform" });
    }
    if (body.platform === "fcm" && !config.fcmEnabled) {
      throw new HTTPException(501, {
        message: "FCM stub only; set FCM_ENABLED=true when wired",
      });
    }
    if (
      body.platform === "apns" &&
      !/^[a-fA-F0-9]{64,200}$/.test(body.pushToken ?? "")
    ) {
      throw new HTTPException(400, { message: "invalid APNs token" });
    }
    if (
      body.platform !== "apns" &&
      (typeof body.pushToken !== "string" ||
        body.pushToken.length < 8 ||
        body.pushToken.length > 4096)
    ) {
      throw new HTTPException(400, { message: "invalid push token" });
    }

    const sandbox = body.sandbox ?? config.apnsSandboxDefault;
    const displayName = (body.displayName ?? "").slice(0, 80);
    await db`
      INSERT INTO devices (
        device_id, account_id, platform, push_token, sandbox, display_name,
        updated_at, revoked_at
      ) VALUES (
        ${body.deviceId}, ${accountId}, ${body.platform}, ${body.pushToken},
        ${sandbox}, ${displayName}, NOW(), NULL
      )
      ON CONFLICT (device_id) DO UPDATE SET
        account_id = EXCLUDED.account_id,
        platform = EXCLUDED.platform,
        push_token = EXCLUDED.push_token,
        sandbox = EXCLUDED.sandbox,
        display_name = EXCLUDED.display_name,
        updated_at = NOW(),
        revoked_at = NULL
    `;
    return c.json({ ok: true, deviceId: body.deviceId, platform: body.platform });
  });

  app.get("/v1/devices", async (c) => {
    const accountId = await requireAccount(c);
    type DeviceRow = {
      device_id: string;
      platform: string;
      sandbox: boolean;
      display_name: string;
      created_at: Date | string;
      updated_at: Date | string;
      last_push_at: Date | string | null;
    };
    const rows = (await db`
      SELECT device_id, platform, sandbox, display_name, created_at, updated_at, last_push_at
      FROM devices
      WHERE account_id = ${accountId} AND revoked_at IS NULL
      ORDER BY created_at ASC
    `) as unknown as DeviceRow[];
    return c.json({
      devices: rows.map((row) => ({
        deviceId: row.device_id,
        platform: row.platform,
        sandbox: row.sandbox,
        displayName: row.display_name,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastPushAt: row.last_push_at,
      })),
    });
  });

  app.delete("/v1/devices/:deviceId", async (c) => {
    const accountId = await requireAccount(c);
    const deviceId = c.req.param("deviceId");
    if (!DEVICE_PATTERN.test(deviceId)) {
      throw new HTTPException(400, { message: "invalid deviceId" });
    }
    const result = await db`
      UPDATE devices
      SET revoked_at = NOW(), updated_at = NOW()
      WHERE device_id = ${deviceId}
        AND account_id = ${accountId}
        AND revoked_at IS NULL
    `;
    if ((result.count ?? 0) === 0) {
      throw new HTTPException(404, { message: "device not found" });
    }
    return c.json({ ok: true });
  });

  app.post("/v1/push/test", async (c) => {
    requireAdmin(c);
    const body = parseJson<{
      deviceId?: string;
      pushToken?: string;
      sandbox?: boolean;
    }>(await c.req.text());

    let pushToken = body.pushToken;
    let sandbox = body.sandbox ?? config.apnsSandboxDefault;
    if (body.deviceId) {
      const rows = await db`
        SELECT push_token, sandbox, platform
        FROM devices
        WHERE device_id = ${body.deviceId} AND revoked_at IS NULL
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) throw new HTTPException(404, { message: "device not found" });
      if (row.platform !== "apns") {
        throw new HTTPException(400, { message: "only APNs supported in v1" });
      }
      pushToken = String(row.push_token);
      sandbox = Boolean(row.sandbox);
    }
    if (!pushToken) {
      throw new HTTPException(400, { message: "deviceId or pushToken required" });
    }

    const result = await sendApns(config, pushToken, sandbox);
    if (body.deviceId && !result.dryRun && result.status >= 200 && result.status < 300) {
      await db`
        UPDATE devices SET last_push_at = NOW(), updated_at = NOW()
        WHERE device_id = ${body.deviceId}
      `;
    }
    return c.json({
      ok: result.dryRun || (result.status >= 200 && result.status < 300),
      ...result,
    });
  });

  app.get("/v1/accounts/:accountId/consent", async (c) => {
    const accountId = c.req.param("accountId");
    await requireAccount(c, accountId);
    const rows = await db`
      SELECT enabled, allow_ai, retention_hours, disclosure_version,
             consented_at, revoked_at
      FROM account_consents WHERE account_id = ${accountId}
    `;
    const row = rows[0];
    if (!row) {
      return c.json({
        accountId,
        enabled: false,
        allowAi: false,
        retentionHours: 0,
        disclosureVersion: config.consentDisclosureVersion,
        processingRegion: config.processingRegion,
      });
    }
    return c.json({
      accountId,
      enabled: row.enabled,
      allowAi: row.allow_ai,
      retentionHours: row.retention_hours,
      disclosureVersion: row.disclosure_version,
      consentedAt: row.consented_at,
      revokedAt: row.revoked_at,
      processingRegion: config.processingRegion,
    });
  });

  app.put("/v1/accounts/:accountId/consent", async (c) => {
    const accountId = c.req.param("accountId");
    await requireAccount(c, accountId);
    const body = parseJson<{
      enabled: boolean;
      allowAi: boolean;
      retentionHours: number;
      disclosureVersion: string;
    }>(await c.req.text());

    if (body.enabled && body.disclosureVersion !== config.consentDisclosureVersion) {
      throw new HTTPException(400, {
        message: "consent requires current disclosure version",
      });
    }
    if (
      typeof body.retentionHours !== "number" ||
      body.retentionHours < 0 ||
      body.retentionHours > config.retentionMaxHours
    ) {
      throw new HTTPException(400, {
        message: `retentionHours must be 0..${config.retentionMaxHours}`,
      });
    }

    if (!body.enabled) {
      await db`DELETE FROM retained_inputs WHERE account_id = ${accountId}`;
      await db`
        INSERT INTO account_consents (
          account_id, enabled, allow_ai, retention_hours, disclosure_version,
          consented_at, revoked_at, updated_at
        ) VALUES (
          ${accountId}, FALSE, FALSE, 0, ${config.consentDisclosureVersion},
          NULL, NOW(), NOW()
        )
        ON CONFLICT (account_id) DO UPDATE SET
          enabled = FALSE,
          allow_ai = FALSE,
          retention_hours = 0,
          revoked_at = NOW(),
          updated_at = NOW()
      `;
      return c.json({
        ok: true,
        warning: null,
        disclosureVersion: config.consentDisclosureVersion,
      });
    }

    await db`
      INSERT INTO account_consents (
        account_id, enabled, allow_ai, retention_hours, disclosure_version,
        consented_at, revoked_at, updated_at
      ) VALUES (
        ${accountId}, TRUE, ${Boolean(body.allowAi)}, ${body.retentionHours},
        ${body.disclosureVersion}, NOW(), NULL, NOW()
      )
      ON CONFLICT (account_id) DO UPDATE SET
        enabled = TRUE,
        allow_ai = EXCLUDED.allow_ai,
        retention_hours = EXCLUDED.retention_hours,
        disclosure_version = EXCLUDED.disclosure_version,
        consented_at = NOW(),
        revoked_at = NULL,
        updated_at = NOW()
    `;
    return c.json({
      ok: true,
      warning:
        "This account is not zero-access while consent remains enabled.",
      disclosureVersion: body.disclosureVersion,
      processingRegion: config.processingRegion,
    });
  });

  app.delete("/v1/accounts/:accountId/consent", async (c) => {
    const accountId = c.req.param("accountId");
    await requireAccount(c, accountId);
    await db`DELETE FROM retained_inputs WHERE account_id = ${accountId}`;
    await db`DELETE FROM account_consents WHERE account_id = ${accountId}`;
    return c.json({ ok: true, purged: true });
  });

  app.post("/v1/ai/classify", async (c) => {
    const accountIdHeader = c.req.header("x-galmail-account-id");
    if (!accountIdHeader || !ACCOUNT_PATTERN.test(accountIdHeader)) {
      throw new HTTPException(400, {
        message: "x-galmail-account-id required",
      });
    }
    await requireAccount(c, accountIdHeader);
    await purgeExpiredInputs(db);

    const consentRows = await db`
      SELECT enabled, allow_ai, retention_hours, disclosure_version
      FROM account_consents
      WHERE account_id = ${accountIdHeader}
        AND enabled = TRUE
        AND revoked_at IS NULL
    `;
    const consent = consentRows[0];
    if (
      !consent ||
      consent.disclosure_version !== config.consentDisclosureVersion
    ) {
      throw new HTTPException(403, {
        message: "current versioned consent required",
      });
    }

    const body = parseJson<{ subject?: string; snippet?: string }>(
      await c.req.text(),
    );
    const subject =
      typeof body.subject === "string" ? body.subject.slice(0, 4096) : undefined;
    const snippet =
      typeof body.snippet === "string" ? body.snippet.slice(0, 4096) : undefined;
    if (!subject && !snippet) {
      throw new HTTPException(400, { message: "subject or snippet required" });
    }

    const result = await classifyMessage(
      config,
      { subject, snippet },
      Boolean(consent.allow_ai),
    );

    const retentionHours = Number(consent.retention_hours);
    if (retentionHours > 0) {
      const inputId = crypto.randomUUID();
      const expiresAt = new Date(
        Date.now() + retentionHours * 3600 * 1000,
      ).toISOString();
      await db`
        INSERT INTO retained_inputs (
          input_id, account_id, purpose, payload_json, expires_at
        ) VALUES (
          ${inputId},
          ${accountIdHeader},
          'classify',
          ${JSON.stringify({ subject, snippet })},
          ${expiresAt}
        )
      `;
    }

    return c.json({
      ...result,
      retentionHours,
      processingRegion: config.processingRegion,
    });
  });

  /** Lab helper: mint account JWTs without a separate issuer. */
  app.post("/v1/dev/token", async (c) => {
    requireAdmin(c);
    const body = parseJson<{ accountId: string; ttlSeconds?: number }>(
      await c.req.text(),
    );
    if (!ACCOUNT_PATTERN.test(body.accountId ?? "")) {
      throw new HTTPException(400, { message: "invalid accountId" });
    }
    const { signAccountToken } = await import("./crypto.js");
    const ttl = Math.min(Math.max(body.ttlSeconds ?? 3600, 60), 86400);
    const token = await signAccountToken(
      config.accountAuthSecret,
      body.accountId,
      Math.floor(Date.now() / 1000) + ttl,
    );
    return c.json({ token, expiresIn: ttl, audience: "galmail-homelab" });
  });

  return app;
}
