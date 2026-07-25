#!/usr/bin/env bun
import { AutoApproveGate } from "../approval.js";
import {
  GalMailMcpBridgeClient,
  resolveLiveBridgeUrl,
} from "../bridge-client.js";
import { createFixtureMcpHost } from "../fixture-host.js";
import { runStdioServer } from "../protocol.js";
import { loadStandaloneMcpPolicy } from "../runtime-policy.js";
import { createGalMailMcpServer } from "../server.js";

function logStderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function main() {
  const allowFixture = process.env.GALMAIL_MCP_ALLOW_FIXTURE === "1";
  const bridgeUrl = await resolveLiveBridgeUrl(
    process.env.GALMAIL_MCP_BRIDGE_URL,
  );
  const { policy, token, minted } = loadStandaloneMcpPolicy();

  if (!bridgeUrl && !allowFixture) {
    logStderr(
      "[galmail-mcp] Live bridge not reachable at http://127.0.0.1:8675.\n" +
        "Open GalMail desktop, enable MCP in Settings, create a client, then retry.\n" +
        "For fixture demos only: GALMAIL_MCP_ALLOW_FIXTURE=1",
    );
    process.exit(1);
  }

  if (minted && !bridgeUrl) {
    logStderr(`[galmail-mcp] fixture token:\n${token}`);
  }

  const bridge = bridgeUrl
    ? new GalMailMcpBridgeClient(
        bridgeUrl,
        process.env.GALMAIL_MCP_TOKEN ?? token,
      )
    : undefined;
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
    logStderr(`[galmail-mcp] live bridge ${bridgeUrl}`);
  } else {
    logStderr("[galmail-mcp] fixture mode (GALMAIL_MCP_ALLOW_FIXTURE=1)");
  }

  await runStdioServer(server);
}

main().catch((error) => {
  logStderr(
    `[galmail-mcp] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
