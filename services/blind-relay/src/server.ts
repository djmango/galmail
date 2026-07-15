import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Blind event relay — opaque webhook routing + push hints only.
 * MUST NOT accept plaintext mail subjects/bodies or OAuth tokens.
 */
export type DeviceRegistration = {
  deviceId: string;
  pushToken: string;
  platform: "ios" | "macos" | "web";
  opaqueAccountHints: string[];
};

const FORBIDDEN_KEYS = [
  "accessToken",
  "refreshToken",
  "subject",
  "body",
  "bodyHtml",
  "bodyText",
  "rawMime",
];

export function assertBlindPayload(payload: unknown): void {
  if (!payload || typeof payload !== "object") return;
  const obj = payload as Record<string, unknown>;
  for (const key of FORBIDDEN_KEYS) {
    if (key in obj) {
      throw new Error(`Blind relay rejected plaintext field: ${key}`);
    }
  }
}

export function signRegistration(
  secret: string,
  deviceId: string,
  pushToken: string,
): string {
  return createHmac("sha256", secret).update(`${deviceId}:${pushToken}`).digest("hex");
}

export function verifySignature(
  secret: string,
  deviceId: string,
  pushToken: string,
  signature: string,
): boolean {
  const expected = Buffer.from(signRegistration(secret, deviceId, pushToken), "hex");
  const actual = Buffer.from(signature, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

const devices = new Map<string, DeviceRegistration>();
const events: Array<{ opaqueRouteId: string; eventType: string; at: string }> = [];

export function createRelayApp(
  secret = process.env.RELAY_HMAC_SECRET ?? "dev-only-change-me",
) {
  const app = new Hono();

  app.get("/health", (c) => c.json({ ok: true, service: "galmail-blind-relay" }));

  app.post("/v1/devices", async (c) => {
    const body = await c.req.json<DeviceRegistration & { signature?: string }>();
    try {
      assertBlindPayload(body);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
    if (!body.deviceId || !body.pushToken || !body.platform) {
      return c.json({ error: "invalid registration" }, 400);
    }
    if (
      body.signature &&
      !verifySignature(secret, body.deviceId, body.pushToken, body.signature)
    ) {
      return c.json({ error: "bad signature" }, 401);
    }
    devices.set(body.deviceId, {
      deviceId: body.deviceId,
      pushToken: body.pushToken,
      platform: body.platform,
      opaqueAccountHints: body.opaqueAccountHints ?? [],
    });
    return c.json({ ok: true });
  });

  app.post("/v1/events", async (c) => {
    const body = await c.req.json<{
      opaqueRouteId: string;
      eventType: string;
      ciphertextHint?: string;
      subject?: string;
    }>();
    try {
      assertBlindPayload(body);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
    if (!body.opaqueRouteId || !body.eventType) {
      return c.json({ error: "invalid event" }, 400);
    }
    events.push({
      opaqueRouteId: body.opaqueRouteId,
      eventType: body.eventType,
      at: new Date().toISOString(),
    });
    return c.json({ ok: true, queued: true, preview: "New mail" });
  });

  app.get("/v1/debug/stats", (c) =>
    c.json({ devices: devices.size, events: events.length }),
  );

  return app;
}

const shouldListen = process.env.GALMAIL_RELAY_LISTEN !== "0";
if (shouldListen && process.env.VITEST !== "true") {
  const port = Number(process.env.PORT ?? 8787);
  const app = createRelayApp();
  console.log(`GalMail blind relay listening on http://127.0.0.1:${port}`);
  serve({ fetch: app.fetch, port });
}
