import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

type Bindings = Env;
type Variables = { accountId: string; deviceId: string };
type AppEnv = { Bindings: Bindings; Variables: Variables };

export type PushJob = { eventId: string; routeId: string };
type DeviceIdentity = {
  deviceId: string;
  displayName: string;
  identityJwk: JsonWebKey;
};

const FORBIDDEN_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "subject",
  "snippet",
  "body",
  "bodyhtml",
  "bodytext",
  "rawmime",
  "from",
  "to",
  "cc",
  "bcc",
  "providertoken",
  "vaultkey",
]);
const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const INVITE_TTL_SECONDS = 10 * 60;
const REPLAY_TTL_SECONDS = 10 * 60;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

export function assertBlindPayload(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) assertBlindPayload(item);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      throw new Error(`Blind relay rejected sensitive field: ${key}`);
    }
    assertBlindPayload(child);
  }
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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

async function sha256(value: string | ArrayBuffer): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  return toBase64Url(await crypto.subtle.digest("SHA-256", bytes));
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
    !ID_PATTERN.test(claims.sub) ||
    claims.aud !== "galmail-hosted" ||
    !claims.exp ||
    claims.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new HTTPException(401, { message: "expired or invalid token" });
  }
  return claims.sub;
}

function bearer(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    throw new HTTPException(401, { message: "authentication required" });
  }
  return authorization.slice(7);
}

async function timingSafeSecret(
  actual: string,
  expected: string,
): Promise<boolean> {
  const actualDigest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(actual),
  );
  const expectedDigest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(expected),
  );
  const key = await importHmac(toBase64Url(expectedDigest));
  const signature = await crypto.subtle.sign("HMAC", key, expectedDigest);
  return crypto.subtle.verify("HMAC", key, signature, actualDigest);
}

function parseJson<T>(text: string): T {
  try {
    const parsed = JSON.parse(text) as T;
    assertBlindPayload(parsed);
    return parsed;
  } catch (error) {
    throw new HTTPException(400, {
      message: error instanceof Error ? error.message : "invalid JSON",
    });
  }
}

function assertExactKeys(value: object, expected: string[]): void {
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new HTTPException(400, { message: "unexpected request fields" });
  }
}

function validateIdentity(identity: DeviceIdentity): void {
  if (
    !ID_PATTERN.test(identity.deviceId) ||
    identity.displayName.length < 1 ||
    identity.displayName.length > 80 ||
    identity.identityJwk.kty !== "EC" ||
    identity.identityJwk.crv !== "P-256" ||
    !identity.identityJwk.x ||
    !identity.identityJwk.y
  ) {
    throw new HTTPException(400, { message: "invalid P-256 device identity" });
  }
}

async function accountAuth(
  request: Request,
  env: Bindings,
  expected: string,
): Promise<void> {
  const accountId = await verifyAccountToken(
    bearer(request),
    env.ACCOUNT_AUTH_SECRET,
  );
  if (accountId !== expected) {
    throw new HTTPException(403, { message: "account isolation violation" });
  }
  const outcome = await env.API_RATE_LIMITER.limit({
    key: await sha256(accountId),
  });
  if (!outcome.success)
    throw new HTTPException(429, { message: "rate limit exceeded" });
}

async function verifyDeviceRequest(
  request: Request,
  env: Bindings,
  accountId: string,
  body: ArrayBuffer,
): Promise<string> {
  await accountAuth(request, env, accountId);
  const deviceId = request.headers.get("x-galmail-device-id") ?? "";
  const nonce = request.headers.get("x-galmail-nonce") ?? "";
  const signature = request.headers.get("x-galmail-signature") ?? "";
  const timestamp = Number(request.headers.get("x-galmail-timestamp"));
  if (
    !ID_PATTERN.test(deviceId) ||
    !ID_PATTERN.test(nonce) ||
    !signature ||
    !Number.isFinite(timestamp) ||
    Math.abs(Math.floor(Date.now() / 1000) - timestamp) > MAX_CLOCK_SKEW_SECONDS
  ) {
    throw new HTTPException(401, {
      message: "invalid device signature headers",
    });
  }
  const row = await env.DB.prepare(
    `SELECT identity_jwk FROM devices
     WHERE account_id = ? AND device_id = ? AND revoked_at IS NULL`,
  )
    .bind(accountId, deviceId)
    .first<{ identity_jwk: string }>();
  if (!row) throw new HTTPException(401, { message: "device is not approved" });
  const canonical = [
    timestamp,
    nonce,
    request.method.toUpperCase(),
    new URL(request.url).pathname,
    await sha256(body),
  ].join("\n");
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    JSON.parse(row.identity_jwk) as JsonWebKey,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    publicKey,
    fromBase64Url(signature),
    encoder.encode(canonical),
  );
  if (!valid)
    throw new HTTPException(401, { message: "invalid device signature" });
  const nonceHash = await sha256(nonce);
  try {
    await env.DB.prepare(
      `INSERT INTO replay_nonces(account_id, device_id, nonce_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    )
      .bind(accountId, deviceId, nonceHash, timestamp + REPLAY_TTL_SECONDS)
      .run();
  } catch {
    throw new HTTPException(409, { message: "replayed request" });
  }
  await env.DB.prepare(
    "UPDATE devices SET last_seen_at = ? WHERE account_id = ? AND device_id = ?",
  )
    .bind(Math.floor(Date.now() / 1000), accountId, deviceId)
    .run();
  return deviceId;
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

async function encryptEndpoint(
  value: unknown,
  secret: string,
  accountId: string,
  routeId: string,
): Promise<{ ciphertext: string; nonce: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: encoder.encode(`${accountId}\n${routeId}\n1`),
    },
    await importAesKey(secret),
    encoder.encode(JSON.stringify(value)),
  );
  return { ciphertext: toBase64Url(ciphertext), nonce: toBase64Url(nonce) };
}

async function decryptEndpoint<T>(
  ciphertext: string,
  nonce: string,
  secret: string,
  accountId: string,
  routeId: string,
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64Url(nonce),
      additionalData: encoder.encode(`${accountId}\n${routeId}\n1`),
    },
    await importAesKey(secret),
    fromBase64Url(ciphertext),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

function metric(env: Bindings, event: string, outcome: string): void {
  env.METRICS.writeDataPoint({
    blobs: [event, outcome, env.ENVIRONMENT],
    doubles: [1],
    indexes: [event],
  });
}

export function safeLog(
  level: "info" | "warn" | "error",
  event: string,
  fields: { outcome?: string; status?: number } = {},
): void {
  const record = { level, event, ...fields };
  assertBlindPayload(record);
  void JSON.stringify(record);
}

function coarseHour(epochSeconds: number): number {
  return Math.floor(epochSeconds / 3600) * 3600;
}

function objectKey(
  accountId: string,
  blobId: string,
  revision: number,
): string {
  return `${accountId}/${blobId}/${revision}.ciphertext`;
}

async function audit(
  env: Bindings,
  accountId: string | null,
  action: string,
  actor: string | null,
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO audit_events
      (audit_id, account_id, action, actor_device_id, coarse_hour, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      accountId,
      action,
      actor,
      coarseHour(now),
      now + Number(env.AUDIT_RETENTION_DAYS) * 86400,
    )
    .run();
}

function pemToBytes(pem: string): ArrayBuffer {
  return fromBase64Url(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""));
}

async function createProviderJwt(
  privateKeyPem: string,
  header: Record<string, string>,
  claims: Record<string, string | number>,
): Promise<string> {
  const encodedHeader = toBase64Url(encoder.encode(JSON.stringify(header)));
  const encodedClaims = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const unsigned = `${encodedHeader}.${encodedClaims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(unsigned),
  );
  return `${unsigned}.${toBase64Url(signature)}`;
}

export interface PushDispatcher {
  dispatch(platform: "apns" | "webpush", destination: unknown): Promise<number>;
}

function createPushDispatcher(env: Bindings): PushDispatcher {
  return {
    async dispatch(platform, destination) {
      if (platform === "apns") {
        const target = destination as {
          deviceToken: string;
          sandbox?: boolean;
        };
        if (!/^[a-fA-F0-9]{64,200}$/.test(target.deviceToken))
          throw new Error("invalid APNs token");
        const token = await createProviderJwt(
          env.APNS_PRIVATE_KEY,
          { alg: "ES256", kid: env.APNS_KEY_ID },
          { iss: env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) },
        );
        const host = target.sandbox
          ? "api.sandbox.push.apple.com"
          : "api.push.apple.com";
        const response = await fetch(
          `https://${host}/3/device/${target.deviceToken}`,
          {
            method: "POST",
            headers: {
              authorization: `bearer ${token}`,
              "apns-topic": env.APNS_TOPIC,
              "apns-push-type": "alert",
              "apns-priority": "5",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              aps: {
                alert: {
                  title: "New mail",
                  body: "Open GalMail to fetch updates.",
                },
                "content-available": 1,
              },
            }),
          },
        );
        return response.status;
      }
      const target = destination as { endpoint: string };
      const endpoint = new URL(target.endpoint);
      if (endpoint.protocol !== "https:")
        throw new Error("invalid Web Push endpoint");
      const token = await createProviderJwt(
        env.WEB_PUSH_PRIVATE_KEY,
        { alg: "ES256", typ: "JWT" },
        {
          aud: endpoint.origin,
          exp: Math.floor(Date.now() / 1000) + 12 * 3600,
          sub: env.WEB_PUSH_SUBJECT,
        },
      );
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `vapid t=${token}, k=${env.WEB_PUSH_PUBLIC_KEY}`,
          ttl: "60",
          urgency: "normal",
          "content-length": "0",
        },
      });
      return response.status;
    },
  };
}

export function createRelayApp(): Hono<AppEnv> {
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
      service: "galmail-blind-relay",
      environment: c.env.ENVIRONMENT,
    });
  });

  app.post("/v1/accounts/:accountId/devices/bootstrap", async (c) => {
    const accountId = c.req.param("accountId");
    await accountAuth(c.req.raw, c.env, accountId);
    const identity = parseJson<DeviceIdentity>(await c.req.text());
    assertExactKeys(identity, ["deviceId", "displayName", "identityJwk"]);
    validateIdentity(identity);
    const now = Math.floor(Date.now() / 1000);
    try {
      await c.env.DB.batch([
        c.env.DB.prepare(
          "INSERT INTO accounts(account_id, created_at) VALUES (?, ?)",
        ).bind(accountId, now),
        c.env.DB.prepare(
          `INSERT INTO devices
              (account_id, device_id, display_name, identity_jwk, approved_at, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(
          accountId,
          identity.deviceId,
          identity.displayName,
          JSON.stringify(identity.identityJwk),
          now,
          now,
        ),
      ]);
    } catch {
      throw new HTTPException(409, { message: "account already bootstrapped" });
    }
    await audit(c.env, accountId, "device.bootstrap", identity.deviceId);
    return c.json({ ok: true, deviceId: identity.deviceId }, 201);
  });

  app.post("/v1/accounts/:accountId/device-invites", async (c) => {
    const accountId = c.req.param("accountId");
    const body = await c.req.arrayBuffer();
    const deviceId = await verifyDeviceRequest(
      c.req.raw,
      c.env,
      accountId,
      body,
    );
    if (body.byteLength !== 0)
      throw new HTTPException(400, { message: "body must be empty" });
    const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const now = Math.floor(Date.now() / 1000);
    await c.env.DB.prepare(
      `INSERT INTO device_invites
        (invite_hash, account_id, created_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        await sha256(token),
        accountId,
        deviceId,
        now + INVITE_TTL_SECONDS,
        now,
      )
      .run();
    await audit(c.env, accountId, "device.invite_created", deviceId);
    return c.json({ token, expiresAt: now + INVITE_TTL_SECONDS }, 201);
  });

  app.post("/v1/accounts/:accountId/device-invites/claim", async (c) => {
    const accountId = c.req.param("accountId");
    await accountAuth(c.req.raw, c.env, accountId);
    const claim = parseJson<DeviceIdentity & { inviteToken: string }>(
      await c.req.text(),
    );
    assertExactKeys(claim, [
      "deviceId",
      "displayName",
      "identityJwk",
      "inviteToken",
    ]);
    const identity: DeviceIdentity = claim;
    validateIdentity(identity);
    if (claim.inviteToken.length < 32 || claim.inviteToken.length > 128) {
      throw new HTTPException(400, { message: "invalid invite token" });
    }
    const now = Math.floor(Date.now() / 1000);
    const inviteHash = await sha256(claim.inviteToken);
    const invite = await c.env.DB.prepare(
      `SELECT created_by FROM device_invites
       WHERE invite_hash = ? AND account_id = ? AND used_at IS NULL AND expires_at > ?`,
    )
      .bind(inviteHash, accountId, now)
      .first<{ created_by: string }>();
    if (!invite)
      throw new HTTPException(410, {
        message: "invite expired or already used",
      });
    try {
      const claimed = await c.env.DB.batch([
        c.env.DB.prepare(
          `INSERT INTO devices
              (account_id, device_id, display_name, identity_jwk, approved_by,
               approved_at, last_seen_at)
             SELECT account_id, ?, ?, ?, created_by, ?, ?
             FROM device_invites
             WHERE invite_hash = ? AND account_id = ?
               AND used_at IS NULL AND expires_at > ?`,
        ).bind(
          identity.deviceId,
          identity.displayName,
          JSON.stringify(identity.identityJwk),
          now,
          now,
          inviteHash,
          accountId,
          now,
        ),
        c.env.DB.prepare(
          `UPDATE device_invites SET used_at = ?
             WHERE invite_hash = ? AND account_id = ? AND used_at IS NULL`,
        ).bind(now, inviteHash, accountId),
      ]);
      if ((claimed[0].meta.changes ?? 0) !== 1) {
        throw new HTTPException(410, {
          message: "invite expired or already used",
        });
      }
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      throw new HTTPException(409, { message: "invite claim conflict" });
    }
    await audit(c.env, accountId, "device.linked", invite.created_by);
    return c.json({ ok: true, deviceId: identity.deviceId }, 201);
  });

  app.get("/v1/accounts/:accountId/devices", async (c) => {
    const accountId = c.req.param("accountId");
    const body = new ArrayBuffer(0);
    await verifyDeviceRequest(c.req.raw, c.env, accountId, body);
    const rows = await c.env.DB.prepare(
      `SELECT device_id, display_name, approved_by, approved_at, revoked_at, last_seen_at
       FROM devices WHERE account_id = ? ORDER BY approved_at`,
    )
      .bind(accountId)
      .all();
    return c.json({ devices: rows.results });
  });

  app.delete("/v1/accounts/:accountId/devices/:deviceId", async (c) => {
    const accountId = c.req.param("accountId");
    const body = new ArrayBuffer(0);
    const actor = await verifyDeviceRequest(c.req.raw, c.env, accountId, body);
    const now = Math.floor(Date.now() / 1000);
    const revoked = await c.env.DB.prepare(
      `UPDATE devices SET revoked_at = ?
         WHERE account_id = ? AND device_id = ? AND revoked_at IS NULL
           AND (SELECT COUNT(*) FROM devices
                WHERE account_id = ? AND revoked_at IS NULL) > 1`,
    )
      .bind(now, accountId, c.req.param("deviceId"), accountId)
      .run();
    if ((revoked.meta.changes ?? 0) === 0) {
      throw new HTTPException(409, {
        message: "active device not found or cannot revoke the last device",
      });
    }
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE push_routes SET disabled_at = ? WHERE account_id = ? AND device_id = ?",
      ).bind(now, accountId, c.req.param("deviceId")),
      c.env.DB.prepare(
        "DELETE FROM replay_nonces WHERE account_id = ? AND device_id = ?",
      ).bind(accountId, c.req.param("deviceId")),
    ]);
    await audit(c.env, accountId, "device.revoked", actor);
    return c.json({ ok: true, revoked: true });
  });

  app.put("/v1/accounts/:accountId/blobs/:blobId", async (c) => {
    const accountId = c.req.param("accountId");
    const blobId = c.req.param("blobId");
    if (!ID_PATTERN.test(blobId))
      throw new HTTPException(400, { message: "invalid blob ID" });
    const body = await c.req.arrayBuffer();
    const deviceId = await verifyDeviceRequest(
      c.req.raw,
      c.env,
      accountId,
      body,
    );
    const maxBytes = Number(c.env.MAX_BLOB_BYTES);
    const kind = c.req.header("x-galmail-blob-kind") ?? "";
    const revision = Number(c.req.header("x-galmail-revision"));
    const envelopeVersion = Number(c.req.header("x-galmail-envelope-version"));
    const expectedHash = c.req.header("x-galmail-ciphertext-sha256") ?? "";
    if (
      c.req.header("content-type") !== "application/vnd.galmail.ciphertext" ||
      body.byteLength < 32 ||
      body.byteLength > maxBytes ||
      !["settings", "preferences", "wrapped_key", "device_record"].includes(
        kind,
      ) ||
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      !Number.isSafeInteger(envelopeVersion) ||
      envelopeVersion < 1 ||
      expectedHash !== (await sha256(body))
    ) {
      throw new HTTPException(400, {
        message: "invalid authenticated ciphertext envelope",
      });
    }
    const key = objectKey(accountId, blobId, revision);
    await c.env.SYNC_BLOBS.put(key, body, {
      httpMetadata: { contentType: "application/vnd.galmail.ciphertext" },
      customMetadata: { envelopeVersion: String(envelopeVersion) },
    });
    const now = Math.floor(Date.now() / 1000);
    const prior = await c.env.DB.prepare(
      "SELECT object_key, revision FROM sync_blobs WHERE account_id = ? AND blob_id = ?",
    )
      .bind(accountId, blobId)
      .first<{ object_key: string; revision: number }>();
    if (prior && prior.revision >= revision) {
      await c.env.SYNC_BLOBS.delete(key);
      throw new HTTPException(409, { message: "stale blob revision" });
    }
    const persisted = await c.env.DB.prepare(
      `INSERT INTO sync_blobs
        (account_id, blob_id, kind, object_key, ciphertext_sha256, byte_length,
         envelope_version, revision, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, blob_id) DO UPDATE SET
         kind = excluded.kind, object_key = excluded.object_key,
         ciphertext_sha256 = excluded.ciphertext_sha256,
         byte_length = excluded.byte_length,
         envelope_version = excluded.envelope_version,
         revision = excluded.revision, updated_by = excluded.updated_by,
         updated_at = excluded.updated_at
       WHERE sync_blobs.revision < excluded.revision`,
    )
      .bind(
        accountId,
        blobId,
        kind,
        key,
        expectedHash,
        body.byteLength,
        envelopeVersion,
        revision,
        deviceId,
        now,
      )
      .run();
    if ((persisted.meta.changes ?? 0) !== 1) {
      await c.env.SYNC_BLOBS.delete(key);
      throw new HTTPException(409, { message: "stale blob revision" });
    }
    if (prior?.object_key && prior.object_key !== key) {
      await c.env.SYNC_BLOBS.delete(prior.object_key);
    }
    metric(c.env, "sync_blob_put", "accepted");
    return c.json({ ok: true, blobId, revision }, prior ? 200 : 201);
  });

  app.get("/v1/accounts/:accountId/blobs", async (c) => {
    const accountId = c.req.param("accountId");
    await verifyDeviceRequest(c.req.raw, c.env, accountId, new ArrayBuffer(0));
    const rows = await c.env.DB.prepare(
      `SELECT blob_id, kind, ciphertext_sha256, byte_length, envelope_version,
              revision, updated_at
       FROM sync_blobs WHERE account_id = ? ORDER BY blob_id`,
    )
      .bind(accountId)
      .all();
    return c.json({ blobs: rows.results });
  });

  app.get("/v1/accounts/:accountId/blobs/:blobId", async (c) => {
    const accountId = c.req.param("accountId");
    await verifyDeviceRequest(c.req.raw, c.env, accountId, new ArrayBuffer(0));
    const row = await c.env.DB.prepare(
      `SELECT object_key, ciphertext_sha256, envelope_version, revision
       FROM sync_blobs WHERE account_id = ? AND blob_id = ?`,
    )
      .bind(accountId, c.req.param("blobId"))
      .first<{
        object_key: string;
        ciphertext_sha256: string;
        envelope_version: number;
        revision: number;
      }>();
    if (!row) throw new HTTPException(404, { message: "blob not found" });
    const object = await c.env.SYNC_BLOBS.get(row.object_key);
    if (!object)
      throw new HTTPException(503, { message: "blob temporarily unavailable" });
    return new Response(object.body, {
      headers: {
        "content-type": "application/vnd.galmail.ciphertext",
        "x-galmail-ciphertext-sha256": row.ciphertext_sha256,
        "x-galmail-envelope-version": String(row.envelope_version),
        "x-galmail-revision": String(row.revision),
        "cache-control": "private, no-store",
      },
    });
  });

  app.delete("/v1/accounts/:accountId/blobs/:blobId", async (c) => {
    const accountId = c.req.param("accountId");
    await verifyDeviceRequest(c.req.raw, c.env, accountId, new ArrayBuffer(0));
    const row = await c.env.DB.prepare(
      "SELECT object_key FROM sync_blobs WHERE account_id = ? AND blob_id = ?",
    )
      .bind(accountId, c.req.param("blobId"))
      .first<{ object_key: string }>();
    if (!row) throw new HTTPException(404, { message: "blob not found" });
    await c.env.SYNC_BLOBS.delete(row.object_key);
    await c.env.DB.prepare(
      "DELETE FROM sync_blobs WHERE account_id = ? AND blob_id = ?",
    )
      .bind(accountId, c.req.param("blobId"))
      .run();
    return c.json({ ok: true, erased: true });
  });

  app.post("/v1/accounts/:accountId/push-routes", async (c) => {
    const accountId = c.req.param("accountId");
    const raw = await c.req.arrayBuffer();
    const deviceId = await verifyDeviceRequest(
      c.req.raw,
      c.env,
      accountId,
      raw,
    );
    const body = parseJson<{
      routeId: string;
      platform: "apns" | "webpush";
      destination: unknown;
    }>(decoder.decode(raw));
    assertExactKeys(body, ["routeId", "platform", "destination"]);
    if (
      !ID_PATTERN.test(body.routeId) ||
      !["apns", "webpush"].includes(body.platform)
    ) {
      throw new HTTPException(400, { message: "invalid push route" });
    }
    const encrypted = await encryptEndpoint(
      body.destination,
      c.env.TOKEN_ENCRYPTION_KEY,
      accountId,
      body.routeId,
    );
    const now = Math.floor(Date.now() / 1000);
    const registered = await c.env.DB.prepare(
      `INSERT INTO push_routes
        (route_id, account_id, device_id, platform, endpoint_ciphertext,
         endpoint_nonce, endpoint_key_version, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(route_id) DO UPDATE SET
         endpoint_ciphertext = excluded.endpoint_ciphertext,
         endpoint_nonce = excluded.endpoint_nonce,
         endpoint_key_version = 1, last_seen_at = excluded.last_seen_at,
         disabled_at = NULL
       WHERE push_routes.account_id = excluded.account_id
         AND push_routes.device_id = excluded.device_id`,
    )
      .bind(
        body.routeId,
        accountId,
        deviceId,
        body.platform,
        encrypted.ciphertext,
        encrypted.nonce,
        now,
        now,
      )
      .run();
    if ((registered.meta.changes ?? 0) !== 1) {
      throw new HTTPException(409, {
        message: "push route belongs to another account or device",
      });
    }
    return c.json({ ok: true, routeId: body.routeId }, 201);
  });

  app.post("/v1/events", async (c) => {
    if (
      !(await timingSafeSecret(bearer(c.req.raw), c.env.RELAY_INGRESS_SECRET))
    ) {
      throw new HTTPException(401, { message: "invalid ingress credential" });
    }
    const eventId = c.req.header("x-galmail-event-id") ?? "";
    if (!ID_PATTERN.test(eventId))
      throw new HTTPException(400, { message: "invalid event ID" });
    const outcome = await c.env.EVENT_RATE_LIMITER.limit({
      key: await sha256(c.req.header("cf-connecting-ip") ?? "unknown"),
    });
    if (!outcome.success)
      throw new HTTPException(429, { message: "rate limit exceeded" });
    const body = parseJson<{ opaqueRouteId: string; eventType: "mail.hint" }>(
      await c.req.text(),
    );
    assertExactKeys(body, ["opaqueRouteId", "eventType"]);
    if (
      !ID_PATTERN.test(body.opaqueRouteId) ||
      body.eventType !== "mail.hint"
    ) {
      throw new HTTPException(400, { message: "invalid opaque hint" });
    }
    const route = await c.env.DB.prepare(
      "SELECT route_id FROM push_routes WHERE route_id = ? AND disabled_at IS NULL",
    )
      .bind(body.opaqueRouteId)
      .first();
    if (!route) throw new HTTPException(404, { message: "route not found" });
    const now = Math.floor(Date.now() / 1000);
    try {
      await c.env.DB.prepare(
        `INSERT INTO relay_events
          (event_id, route_id, event_type, accepted_at, expires_at, delivery_state)
         VALUES (?, ?, 'mail.hint', ?, ?, 'queued')`,
      )
        .bind(
          eventId,
          body.opaqueRouteId,
          now,
          now + Number(c.env.RELAY_EVENT_RETENTION_HOURS) * 3600,
        )
        .run();
    } catch {
      throw new HTTPException(409, { message: "duplicate event" });
    }
    await c.env.PUSH_QUEUE.send({ eventId, routeId: body.opaqueRouteId });
    metric(c.env, "push_hint", "queued");
    return c.json({ ok: true, queued: true }, 202);
  });

  app.delete("/v1/accounts/:accountId", async (c) => {
    const accountId = c.req.param("accountId");
    await verifyDeviceRequest(c.req.raw, c.env, accountId, new ArrayBuffer(0));
    const blobs = await c.env.DB.prepare(
      "SELECT object_key FROM sync_blobs WHERE account_id = ?",
    )
      .bind(accountId)
      .all<{ object_key: string }>();
    const keys = blobs.results.map((row) => row.object_key);
    for (let index = 0; index < keys.length; index += 1000) {
      await c.env.SYNC_BLOBS.delete(keys.slice(index, index + 1000));
    }
    const now = Math.floor(Date.now() / 1000);
    const operationId = crypto.randomUUID();
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM accounts WHERE account_id = ?").bind(
        accountId,
      ),
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
    metric(c.env, "account_delete", "complete");
    safeLog("info", "account_deleted", { outcome: "complete" });
    return c.json({ ok: true, operationId, state: "complete" });
  });

  return app;
}

const app = createRelayApp();

async function consumePush(
  batch: MessageBatch<PushJob>,
  env: Bindings,
): Promise<void> {
  const dispatcher = createPushDispatcher(env);
  for (const message of batch.messages) {
    try {
      const route = await env.DB.prepare(
        `SELECT account_id, platform, endpoint_ciphertext, endpoint_nonce
         FROM push_routes WHERE route_id = ? AND disabled_at IS NULL`,
      )
        .bind(message.body.routeId)
        .first<{
          account_id: string;
          platform: "apns" | "webpush";
          endpoint_ciphertext: string;
          endpoint_nonce: string;
        }>();
      if (!route) {
        message.ack();
        continue;
      }
      const destination = await decryptEndpoint(
        route.endpoint_ciphertext,
        route.endpoint_nonce,
        env.TOKEN_ENCRYPTION_KEY,
        route.account_id,
        message.body.routeId,
      );
      const status = await dispatcher.dispatch(route.platform, destination);
      if (status >= 200 && status < 300) {
        await env.DB.prepare(
          "UPDATE relay_events SET delivery_state = 'delivered', provider_status = ? WHERE event_id = ?",
        )
          .bind(status, message.body.eventId)
          .run();
        metric(env, "push_delivery", "delivered");
        message.ack();
      } else if (status === 404 || status === 410) {
        await env.DB.batch([
          env.DB.prepare(
            "UPDATE push_routes SET disabled_at = ? WHERE route_id = ?",
          ).bind(Math.floor(Date.now() / 1000), message.body.routeId),
          env.DB.prepare(
            "UPDATE relay_events SET delivery_state = 'failed', provider_status = ? WHERE event_id = ?",
          ).bind(status, message.body.eventId),
        ]);
        metric(env, "push_delivery", "terminal_failure");
        message.ack();
      } else {
        message.retry({
          delaySeconds: Math.min(300, 15 * 2 ** message.attempts),
        });
      }
    } catch {
      safeLog("warn", "push_delivery_failed", { outcome: "retry" });
      message.retry({
        delaySeconds: Math.min(300, 15 * 2 ** message.attempts),
      });
    }
  }
}

async function enforceRetention(env: Bindings): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const expired = await env.DB.prepare(
    "SELECT object_key FROM sync_blobs WHERE expires_at IS NOT NULL AND expires_at <= ? LIMIT 1000",
  )
    .bind(now)
    .all<{ object_key: string }>();
  if (expired.results.length) {
    await env.SYNC_BLOBS.delete(expired.results.map((row) => row.object_key));
  }
  const inactiveBefore =
    now - Number(env.PUSH_REGISTRATION_INACTIVE_DAYS) * 86400;
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM sync_blobs WHERE expires_at IS NOT NULL AND expires_at <= ?",
    ).bind(now),
    env.DB.prepare("DELETE FROM replay_nonces WHERE expires_at <= ?").bind(now),
    env.DB.prepare(
      "DELETE FROM device_invites WHERE expires_at <= ? OR used_at IS NOT NULL",
    ).bind(now),
    env.DB.prepare("DELETE FROM relay_events WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM audit_events WHERE expires_at <= ?").bind(now),
    env.DB.prepare("DELETE FROM deletion_receipts WHERE expires_at <= ?").bind(
      now,
    ),
    env.DB.prepare(
      "UPDATE push_routes SET disabled_at = ? WHERE disabled_at IS NULL AND last_seen_at <= ?",
    ).bind(now, inactiveBefore),
  ]);
  metric(env, "retention", "complete");
}

export default {
  fetch: app.fetch,
  queue: consumePush,
  scheduled(
    _controller: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(enforceRetention(env));
  },
} satisfies ExportedHandler<Bindings, PushJob>;
