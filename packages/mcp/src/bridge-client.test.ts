import { describe, expect, test } from "bun:test";
import { GalMailMcpBridgeClient } from "./bridge-client.js";

describe("GalMailMcpBridgeClient", () => {
  test("health and tool call against a mock bridge", async () => {
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/health") {
          return Response.json({ ok: true, service: "galmail-mcp-bridge" });
        }
        if (url.pathname === "/v1/tools/call") {
          const auth = request.headers.get("authorization");
          if (auth !== "Bearer secret") {
            return new Response("Unauthorized", { status: 401 });
          }
          return Response.json({
            ok: true,
            result: { accounts: [{ accountId: "gmail:live" }] },
          });
        }
        return new Response("Not found", { status: 404 });
      },
    });

    const client = new GalMailMcpBridgeClient(
      `http://127.0.0.1:${server.port}`,
      "secret",
    );
    expect(await client.health()).toBe(true);
    const result = (await client.callTool("list_accounts")) as {
      accounts: Array<{ accountId: string }>;
    };
    expect(result.accounts[0]?.accountId).toBe("gmail:live");
    server.stop(true);
  });
});
