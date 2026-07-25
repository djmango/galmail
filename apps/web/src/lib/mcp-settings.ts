import {
  createDefaultMcpPolicy,
  createMcpClient,
  loadMcpPolicyFromLocalStorage,
  persistMcpPolicyToLocalStorage,
  type McpApprovalMode,
  type McpClientCredential,
  type McpPolicy,
  type McpScope,
  DEFAULT_PHASE1_SCOPES,
} from "@galmail/mcp";

export {
  createDefaultMcpPolicy,
  createMcpClient,
  loadMcpPolicyFromLocalStorage,
  persistMcpPolicyToLocalStorage,
  DEFAULT_PHASE1_SCOPES,
  type McpApprovalMode,
  type McpClientCredential,
  type McpPolicy,
  type McpScope,
};

export function cursorMcpConfigSnippet(token: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        galmail: {
          command: "bun",
          args: ["run", "--filter", "@galmail/mcp", "stdio"],
          env: {
            GALMAIL_MCP_TOKEN: token,
            GALMAIL_MCP_BRIDGE_URL: "http://127.0.0.1:8675",
          },
        },
      },
    },
    null,
    2,
  );
}

export function addMcpClient(
  policy: McpPolicy,
  name: string,
): { policy: McpPolicy; client: McpClientCredential } {
  const client = createMcpClient({ name });
  return {
    policy: { ...policy, clients: [...policy.clients, client] },
    client,
  };
}

export function revokeMcpClient(
  policy: McpPolicy,
  clientId: string,
  now = () => new Date(),
): McpPolicy {
  return {
    ...policy,
    clients: policy.clients.map((client) =>
      client.id === clientId
        ? { ...client, revokedAt: now().toISOString() }
        : client,
    ),
  };
}
