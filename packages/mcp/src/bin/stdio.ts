#!/usr/bin/env bun
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AutoApproveGate } from "../approval.js";
import {
  GalMailMcpBridgeClient,
  resolveLiveBridgeUrl,
} from "../bridge-client.js";
import { createFixtureMcpHost } from "../fixture-host.js";
import { loadStandaloneMcpPolicy } from "../runtime-policy.js";
import { createGalMailMcpServer } from "../server.js";

async function main() {
  const allowFixture = process.env.GALMAIL_MCP_ALLOW_FIXTURE === "1";
  const bridgeUrl = await resolveLiveBridgeUrl(
    process.env.GALMAIL_MCP_BRIDGE_URL,
  );
  const { policy, token, minted } = loadStandaloneMcpPolicy();

  if (!bridgeUrl && !allowFixture) {
    console.error(
      "[galmail-mcp] Live bridge not reachable at http://127.0.0.1:8675.\n" +
        "Open GalMail desktop, enable MCP in Settings, create a client, then retry.\n" +
        "For fixture demos only: GALMAIL_MCP_ALLOW_FIXTURE=1",
    );
    process.exit(1);
  }

  if (minted && !bridgeUrl) {
    console.error(
      `[galmail-mcp] fixture token:\n${token}`,
    );
  }

  const bridge = bridgeUrl
    ? new GalMailMcpBridgeClient(
        bridgeUrl,
        process.env.GALMAIL_MCP_TOKEN ?? token,
      )
    : undefined;
  // Local host used only for fixture mode; live mode proxies via bridge.
  const host = await createFixtureMcpHost();

  const server = createGalMailMcpServer({
    policy,
    host,
    approval: new AutoApproveGate(),
    getToken: () => process.env.GALMAIL_MCP_TOKEN ?? token,
    autoApprove: !bridge,
    bridge,
  });

  if (bridgeUrl) {
    console.error(`[galmail-mcp] live bridge ${bridgeUrl}`);
  } else {
    console.error("[galmail-mcp] fixture mode (GALMAIL_MCP_ALLOW_FIXTURE=1)");
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(
    "[galmail-mcp]",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
