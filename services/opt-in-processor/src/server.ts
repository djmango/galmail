import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

type Bindings = Env;
type AppEnv = { Bindings: Bindings };
export type RevocationJob = { operationId: string };

export type OptInConsent = {
  enabled: true;
  consentVersion: string;
  provider: "gmail";
  purpose: "priority-classification";
  allowedFields: Array<"subject" | "snippet">;
  processingRegion: string;
  retentionHours: number;
  allowAi: boolean;
  providerToken: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ACCOUNT_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const ALLOWED_FIELDS = new Set(["subject", "snippet"]);

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

async function sha256(value: string): Promise<string> {
  return toBase64Url(
    await crypto.subtle.digest("SHA-256", encoder.encode(value)),
  );
}

async function importHmac(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signAccountTokenForTest(
  secret: string,
  accountId: string,
  expiresAtSeconds = Math.floor(Date.now() / 1000) + 300,
): Promise<string> {
  const header = toBase64Url(
    encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const payload = toBase64Url(
    encoder.encode(
      JSON.stringify({
        sub: accountId,
        aud: "galmail-hosted",
        exp: expiresAtSeconds,
        jti: crypto.randomUUID(),
      }),
    ),
  );
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importHmac(secret),
    encoder.encode(unsigned),
  );
  return `${unsigned}.${toBase64Url(signature)}`;
}

async function verifyAccountToken(
  token: string,
  secret: string,
): Promise<string> {
  const parts = token.split(".");
  if (parts.length !== 3)
    throw new HTTPException(401, { message: "invalid token" });
  const [header, payload, signature] = parts;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await importHmac(secret),
    fromBase64Url(signature),
    encoder.encode(`${header}.${payload}`),
  );
  if (!valid) throw new HTTPException(401, { message: "invalid token" });
  let claims: { sub?: string; aud?: string; exp?: number };
  try {
    claims = JSON.parse(
      decoder.decode(fromBase64Url(payload)),
    ) as typeof claims;
  } catch {
    throw new HTTPException(401, { message: "invalid token" });
  }
  if (
    !claims.sub ||
    !ACCOUNT_PATTERN.test(claims.sub) ||
    claims.aud !== "galmail-hosted" ||
    !claims.exp ||
    claims.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new HTTPException(401, { message: "expired or invalid token" });
  }
  return claims.sub;
}

async function authorize(
  request: Request,
  env: Bindings,
  accountId: string,
): Promise<void> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "authentication required" });
  }
  const authenticatedAccount = await verifyAccountToken(
    authorization.slice(7),
    env.ACCOUNT_AUTH_SECRET,
  );
  if (authenticatedAccount !== accountId) {
    throw new HTTPException(403, { message: "account isolation violation" });
  }
  const outcome = await env.API_RATE_LIMITER.limit({
    key: await sha256(accountId),
  });
  if (!outcome.success)
    throw new HTTPException(429, { message: "rate limit exceeded" });
}

function parseJson<T>(text: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HTTPException(400, { message: "invalid JSON" });
  }
}

function validateConsent(consent: OptInConsent, env: Bindings): void {
  const keys = Object.keys(consent).sort();
  const expectedKeys = [
    "allowAi",
    "allowedFields",
    "consentVersion",
    "enabled",
    "processingRegion",
    "provider",
    "providerToken",
    "purpose",
    "retentionHours",
  ].sort();
  if (
    JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
    consent.enabled !== true ||
    consent.consentVersion !== env.CONSENT_VERSION ||
    consent.provider !== "gmail" ||
    consent.purpose !== "priority-classification" ||
    consent.processingRegion !== env.PROCESSING_REGION ||
    !Array.isArray(consent.allowedFields) ||
    consent.allowedFields.length === 0 ||
    consent.allowedFields.some((field) => !ALLOWED_FIELDS.has(field)) ||
    new Set(consent.allowedFields).size !== consent.allowedFields.length ||
    !Number.isInteger(consent.retentionHours) ||
    consent.retentionHours < 0 ||
    consent.retentionHours > Number(env.MAX_RETENTION_HOURS) ||
    typeof consent.allowAi !== "boolean" ||
    typeof consent.providerToken !== "string" ||
    consent.providerToken.length < 16 ||
    consent.providerToken.length > 8192
  ) {
    throw new HTTPException(400, {
      message: "consent must exactly match the current disclosure",
    });
  }
}

async function importAesKey(secret: string): Promise<CryptoKey> {
  const raw = fromBase64Url(secret);
  if (raw.byteLength !== 32)
    throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

async function encrypt(
  plaintext: string,
  secret: string,
  associatedData: string,
): Promise<{ ciphertext: string; nonce: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: encoder.encode(associatedData),
    },
    await importAesKey(secret),
    encoder.encode(plaintext),
  );
  return { ciphertext: toBase64Url(ciphertext), nonce: toBase64Url(nonce) };
}

async function decrypt(
  ciphertext: string,
  nonce: string,
  secret: string,
  associatedData: string,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64Url(nonce),
      additionalData: encoder.encode(associatedData),
    },
    await importAesKey(secret),
    fromBase64Url(ciphertext),
  );
  return decoder.decode(plaintext);
}

export function safeLog(
  level: "info" | "warn" | "error",
  event: string,
  fields: { outcome?: string; status?: number } = {},
): void {
  const record = { level, event, ...fields };
  const serialized = JSON.stringify(record);
  if (
    /subject|snippet|token|content|accountId|providerToken|authorization/i.test(
      serialized,
    )
  ) {
    throw new Error("sensitive processor log rejected");
  }
  void serialized;
}

function metric(env: Bindings, event: string, outcome: string): void {
  env.METRICS.writeDataPoint({
    blobs: [event, outcome, env.ENVIRONMENT],
    doubles: [1],
    indexes: [event],
  });
}

function coarseHour(epochSeconds: number): number {
  return Math.floor(epochSeconds / 3600) * 3600;
}

async function writeAudit(
  env: Bindings,
  accountId: string,
  action: string,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO processor_audit
      (audit_id, account_id_hash, action, coarse_hour, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      await sha256(accountId),
      action,
      coarseHour(now),
      now + 30 * 86400,
    )
    .run();
}

export function createOptInApp(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }
    safeLog("error", "request_failed", { outcome: "internal_error" });
    return c.json({ error: "internal error" }, 500);
  });

  app.get("/health", async (c) => {
    const result = await c.env.DB.prepare("SELECT 1 AS ok").first<{
      ok: number;
    }>();
    return c.json({
      ok: result?.ok === 1,
      service: "galmail-opt-in-processor",
      environment: c.env.ENVIRONMENT,
    });
  });

  app.put("/v1/accounts/:accountId/consent", async (c) => {
    const accountId = c.req.param("accountId");
    await authorize(c.req.raw, c.env, accountId);
    const consent = parseJson<OptInConsent>(await c.req.text());
    validateConsent(consent, c.env);
    const encryptedToken = await encrypt(
      consent.providerToken,
      c.env.TOKEN_ENCRYPTION_KEY,
      `${accountId}\nprovider-token\n1`,
    );
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      `INSERT INTO account_consents
        (account_id, enabled, consent_version, provider, purpose,
         allowed_fields_json, processing_region, retention_hours, allow_ai,
         token_ciphertext, token_nonce, token_key_version, consented_at, updated_at)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(account_id) DO UPDATE SET
         enabled = 1, consent_version = excluded.consent_version,
         provider = excluded.provider, purpose = excluded.purpose,
         allowed_fields_json = excluded.allowed_fields_json,
         processing_region = excluded.processing_region,
         retention_hours = excluded.retention_hours, allow_ai = excluded.allow_ai,
         token_ciphertext = excluded.token_ciphertext,
         token_nonce = excluded.token_nonce, token_key_version = 1,
         consented_at = excluded.consented_at, revoked_at = NULL,
         updated_at = excluded.updated_at`,
    )
      .bind(
        accountId,
        consent.consentVersion,
        consent.provider,
        consent.purpose,
        JSON.stringify(consent.allowedFields),
        consent.processingRegion,
        consent.retentionHours,
        consent.allowAi ? 1 : 0,
        encryptedToken.ciphertext,
        encryptedToken.nonce,
        now,
        now,
      )
      .run();
    await writeAudit(c.env, accountId, "consent.enabled");
    metric(c.env, "consent", "enabled");
    return c.json({
      ok: true,
      warning: "This account is not zero-access while consent remains enabled.",
      consentVersion: consent.consentVersion,
    });
  });

  app.get("/v1/accounts/:accountId/consent", async (c) => {
    const accountId = c.req.param("accountId");
    await authorize(c.req.raw, c.env, accountId);
    const row = await c.env.DB.prepare(
      `SELECT enabled, consent_version, provider, purpose, allowed_fields_json,
              processing_region, retention_hours, allow_ai, consented_at, revoked_at
       FROM account_consents WHERE account_id = ?`,
    )
      .bind(accountId)
      .first<{
        enabled: number;
        consent_version: string;
        provider: string;
        purpose: string;
        allowed_fields_json: string;
        processing_region: string;
        retention_hours: number;
        allow_ai: number;
        consented_at: number;
        revoked_at: number | null;
      }>();
    if (!row) {
      return c.json({
        enabled: false,
        consentVersion: c.env.CONSENT_VERSION,
        processingRegion: c.env.PROCESSING_REGION,
      });
    }
    return c.json({
      enabled: row.enabled === 1,
      consentVersion: row.consent_version,
      provider: row.provider,
      purpose: row.purpose,
      allowedFields: JSON.parse(row.allowed_fields_json),
      processingRegion: row.processing_region,
      retentionHours: row.retention_hours,
      allowAi: row.allow_ai === 1,
      consentedAt: row.consented_at,
      revokedAt: row.revoked_at,
    });
  });

  app.post("/v1/accounts/:accountId/classify", async (c) => {
    const accountId = c.req.param("accountId");
    await authorize(c.req.raw, c.env, accountId);
    const consent = await c.env.DB.prepare(
      `SELECT consent_version, allowed_fields_json, retention_hours
       FROM account_consents
       WHERE account_id = ? AND enabled = 1 AND revoked_at IS NULL`,
    )
      .bind(accountId)
      .first<{
        consent_version: string;
        allowed_fields_json: string;
        retention_hours: number;
      }>();
    if (!consent || consent.consent_version !== c.env.CONSENT_VERSION) {
      throw new HTTPException(403, {
        message: "current versioned consent required",
      });
    }
    const normalized = parseJson<{ subject?: string; snippet?: string }>(
      await c.req.text(),
    );
    const providedFields = Object.keys(normalized);
    const allowedFields = new Set(
      JSON.parse(consent.allowed_fields_json) as string[],
    );
    if (
      providedFields.some(
        (field) => !ALLOWED_FIELDS.has(field) || !allowedFields.has(field),
      ) ||
      providedFields.length === 0 ||
      Object.values(normalized).some(
        (value) => typeof value !== "string" || value.length > 4096,
      )
    ) {
      throw new HTTPException(400, {
        message: "request exceeds consented fields",
      });
    }
    const urgent = /security|urgent|2fa|verification/i.test(
      normalized.subject ?? "",
    );
    if (consent.retention_hours > 0) {
      const inputId = crypto.randomUUID();
      const encryptedInput = await encrypt(
        JSON.stringify(normalized),
        c.env.TOKEN_ENCRYPTION_KEY,
        `${accountId}\nretained-input\n${inputId}\n1`,
      );
      const now = Math.floor(Date.now() / 1000);
      await c.env.DB.prepare(
        `INSERT INTO retained_inputs
          (input_id, account_id, ciphertext, nonce, key_version, created_at, expires_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)`,
      )
        .bind(
          inputId,
          accountId,
          encryptedInput.ciphertext,
          encryptedInput.nonce,
          now,
          now + consent.retention_hours * 3600,
        )
        .run();
    }
    metric(c.env, "classify", "complete");
    return c.json({
      priority: urgent ? "urgent" : "normal",
      source: "rules",
      retentionHours: consent.retention_hours,
    });
  });

  app.delete("/v1/accounts/:accountId/consent", async (c) => {
    const accountId = c.req.param("accountId");
    await authorize(c.req.raw, c.env, accountId);
    const row = await c.env.DB.prepare(
      `SELECT provider, token_ciphertext, token_nonce
       FROM account_consents
       WHERE account_id = ? AND enabled = 1 AND token_ciphertext IS NOT NULL`,
    )
      .bind(accountId)
      .first<{
        provider: "gmail";
        token_ciphertext: string;
        token_nonce: string;
      }>();
    const now = Math.floor(Date.now() / 1000);
    const operationId = crypto.randomUUID();
    if (row) {
      const token = await decrypt(
        row.token_ciphertext,
        row.token_nonce,
        c.env.TOKEN_ENCRYPTION_KEY,
        `${accountId}\nprovider-token\n1`,
      );
      const revocationToken = await encrypt(
        token,
        c.env.TOKEN_ENCRYPTION_KEY,
        `revoke\n${operationId}\n1`,
      );
      await c.env.DB.batch([
        c.env.DB.prepare(
          "DELETE FROM account_consents WHERE account_id = ?",
        ).bind(accountId),
        c.env.DB.prepare(
          `INSERT INTO provider_revocations
              (operation_id, account_id_hash, provider, token_ciphertext,
               token_nonce, token_key_version, state, created_at, expires_at)
             VALUES (?, ?, ?, ?, ?, 1, 'queued', ?, ?)`,
        ).bind(
          operationId,
          await sha256(accountId),
          row.provider,
          revocationToken.ciphertext,
          revocationToken.nonce,
          now,
          now + Number(c.env.REVOCATION_JOB_RETENTION_HOURS) * 3600,
        ),
        c.env.DB.prepare(
          `INSERT INTO deletion_receipts
            (operation_id, account_id_hash, state, coarse_hour, expires_at)
           VALUES (?, ?, 'local_complete_provider_pending', ?, ?)`,
        ).bind(
          operationId,
          await sha256(accountId),
          coarseHour(now),
          now + 30 * 86400,
        ),
      ]);
      await c.env.REVOCATION_QUEUE.send({ operationId });
    } else {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "DELETE FROM account_consents WHERE account_id = ?",
        ).bind(accountId),
        c.env.DB.prepare(
          `INSERT INTO deletion_receipts
            (operation_id, account_id_hash, state, coarse_hour, expires_at)
           VALUES (?, ?, 'complete', ?, ?)`,
        ).bind(
          operationId,
          await sha256(accountId),
          coarseHour(now),
          now + 30 * 86400,
        ),
      ]);
    }
    await writeAudit(c.env, accountId, "consent.revoked");
    metric(c.env, "consent", "revoked");
    return c.json({
      ok: true,
      erased: true,
      operationId,
      providerRevocation: row ? "queued" : "not_required",
    });
  });

  return app;
}

const app = createOptInApp();

async function consumeRevocations(
  batch: MessageBatch<RevocationJob>,
  env: Bindings,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const row = await env.DB.prepare(
        `SELECT provider, token_ciphertext, token_nonce, expires_at
         FROM provider_revocations WHERE operation_id = ? AND state = 'queued'`,
      )
        .bind(message.body.operationId)
        .first<{
          provider: "gmail";
          token_ciphertext: string;
          token_nonce: string;
          expires_at: number;
        }>();
      if (!row || row.expires_at <= Math.floor(Date.now() / 1000)) {
        message.ack();
        continue;
      }
      const token = await decrypt(
        row.token_ciphertext,
        row.token_nonce,
        env.TOKEN_ENCRYPTION_KEY,
        `revoke\n${message.body.operationId}\n1`,
      );
      const response = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
      if (response.ok || response.status === 400) {
        await env.DB.batch([
          env.DB.prepare(
            `UPDATE provider_revocations SET state = 'complete',
             token_ciphertext = '', token_nonce = '', completed_at = ?
             WHERE operation_id = ?`,
          ).bind(Math.floor(Date.now() / 1000), message.body.operationId),
          env.DB.prepare(
            "UPDATE deletion_receipts SET state = 'complete' WHERE operation_id = ?",
          ).bind(message.body.operationId),
        ]);
        metric(env, "provider_revoke", "complete");
        message.ack();
      } else {
        await env.DB.prepare(
          "UPDATE provider_revocations SET attempts = attempts + 1 WHERE operation_id = ?",
        )
          .bind(message.body.operationId)
          .run();
        message.retry({
          delaySeconds: Math.min(900, 60 * 2 ** message.attempts),
        });
      }
    } catch {
      safeLog("warn", "provider_revoke_failed", { outcome: "retry" });
      message.retry({
        delaySeconds: Math.min(900, 60 * 2 ** message.attempts),
      });
    }
  }
}

async function enforceRetention(env: Bindings): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM retained_inputs WHERE expires_at <= ?").bind(
      now,
    ),
    env.DB.prepare(
      `UPDATE provider_revocations SET state = 'expired',
         token_ciphertext = '', token_nonce = ''
         WHERE state = 'queued' AND expires_at <= ?`,
    ).bind(now),
    env.DB.prepare(
      `UPDATE deletion_receipts
       SET state = 'local_complete_provider_expired'
       WHERE operation_id IN (
         SELECT operation_id FROM provider_revocations WHERE state = 'expired'
       )`,
    ),
    env.DB.prepare("DELETE FROM processor_audit WHERE expires_at <= ?").bind(
      now,
    ),
    env.DB.prepare("DELETE FROM deletion_receipts WHERE expires_at <= ?").bind(
      now,
    ),
  ]);
  metric(env, "retention", "complete");
}

export default {
  fetch: app.fetch,
  queue: consumeRevocations,
  scheduled(
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(enforceRetention(env));
  },
} satisfies ExportedHandler<Bindings, RevocationJob>;
