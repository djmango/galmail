import { serve } from "@hono/node-server";
import { Hono } from "hono";

/**
 * Isolated per-account remote processor.
 * Tokens/content accepted ONLY for accounts with explicit consent.
 * Content logging is prohibited; retention is configurable (default 0h).
 */
export type OptInSession = {
  accountId: string;
  allowAi: boolean;
  retentionHours: number;
  disclosureVersion: string;
  /** Encrypted token blob — never log */
  tokenVaultRef: string;
};

const sessions = new Map<string, OptInSession>();

export function createOptInApp() {
  const app = new Hono();

  app.get("/health", (c) =>
    c.json({ ok: true, service: "galmail-opt-in-processor" }),
  );

  app.post("/v1/sessions", async (c) => {
    const body = await c.req.json<OptInSession>();
    if (!body.accountId || !body.disclosureVersion || !body.tokenVaultRef) {
      return c.json({ error: "invalid session" }, 400);
    }
    if (body.retentionHours < 0) {
      return c.json({ error: "retentionHours must be >= 0" }, 400);
    }
    sessions.set(body.accountId, body);
    return c.json({
      ok: true,
      warning:
        "This account is no longer zero-access while the session remains enabled.",
    });
  });

  app.delete("/v1/sessions/:accountId", (c) => {
    sessions.delete(c.req.param("accountId"));
    return c.json({ ok: true, erased: true });
  });

  app.post("/v1/classify", async (c) => {
    const body = await c.req.json<{
      accountId: string;
      normalized: { subject?: string; snippet?: string };
    }>();
    const session = sessions.get(body.accountId);
    if (!session) {
      return c.json({ error: "account not opted in" }, 403);
    }
    // Intentionally do not log body.
    const urgent = /security|urgent|2fa/i.test(body.normalized.subject ?? "");
    return c.json({
      priority: urgent ? "urgent" : "normal",
      source: session.allowAi ? "remote_ai" : "rules",
      retentionHours: session.retentionHours,
    });
  });

  return app;
}

if (process.env.GALMAIL_OPTIN_LISTEN !== "0" && process.env.VITEST !== "true") {
  const port = Number(process.env.PORT ?? 8788);
  console.log(`GalMail opt-in processor listening on http://127.0.0.1:${port}`);
  serve({ fetch: createOptInApp().fetch, port });
}
