#!/usr/bin/env bun
import { AutoApproveGate } from "../approval.js";
import {
  GalMailMcpBridgeClient,
  resolveLiveBridgeUrl,
} from "../bridge-client.js";
import { createFixtureMcpHost } from "../fixture-host.js";
import { handleJsonRpc, type JsonRpcRequest } from "../protocol.js";
import { loadStandaloneMcpPolicy } from "../runtime-policy.js";
import { createGalMailMcpServer } from "../server.js";

const DEFAULT_PORT = 8676;

function logStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() ?? null;
}

async function main() {
  const port =
    Number.parseInt(process.env.GALMAIL_MCP_PORT ?? "", 10) || DEFAULT_PORT;
  const allowFixture = process.env.GALMAIL_MCP_ALLOW_FIXTURE === "1";
  const bridgeUrl = await resolveLiveBridgeUrl(
    process.env.GALMAIL_MCP_BRIDGE_URL,
  );
  if (!bridgeUrl && !allowFixture) {
    logStderr(
      "[galmail-mcp] Live bridge not reachable. Open GalMail and enable MCP.",
    );
    process.exit(1);
  }

  const { policy, token, minted } = loadStandaloneMcpPolicy();
  if (minted) {
    logStderr(`[galmail-mcp] token:\n${token}`);
  }

  const host = await createFixtureMcpHost();

  logStderr(
    `[galmail-mcp] listening on http://127.0.0.1:${port}/mcp (${bridgeUrl ? `live->${bridgeUrl}` : "fixture"})`,
  );

  Bun.serve({
    hostname: "127.0.0.1",
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/health") {
        return Response.json({
          ok: true,
          service: "galmail-mcp",
          mode: bridgeUrl ? "live" : "fixture",
          bridgeUrl: bridgeUrl ?? null,
        });
      }
      if (url.pathname !== "/mcp" || request.method !== "POST") {
        return new Response("Not found", { status: 404 });
      }

      const presented = bearerToken(request) ?? process.env.GALMAIL_MCP_TOKEN;
      if (presented !== token && !bridgeUrl) {
        return new Response("Unauthorized", { status: 401 });
      }

      const liveBridge =
        bridgeUrl && presented
          ? new GalMailMcpBridgeClient(bridgeUrl, presented)
          : bridgeUrl
            ? new GalMailMcpBridgeClient(bridgeUrl, token)
            : undefined;

      const server = createGalMailMcpServer({
        policy,
        host,
        approval: new AutoApproveGate(),
        getToken: () => presented ?? token,
        autoApprove: true,
        bridge: liveBridge,
      });

      const message = (await request.json()) as JsonRpcRequest;
      const response = await handleJsonRpc(server, message);
      if (!response) return new Response(null, { status: 204 });
      return Response.json(response);
    },
  });
}

main().catch((error) => {
  logStderr(
    `[galmail-mcp] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
