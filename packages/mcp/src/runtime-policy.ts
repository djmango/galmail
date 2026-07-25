import {
  createDefaultMcpPolicy,
  createMcpClient,
  parseMcpPolicy,
  type McpPolicy,
} from "./policy.js";
import { DEFAULT_PHASE1_SCOPES } from "./scopes.js";

/**
 * Policy for standalone mcp:stdio / mcp:serve.
 * Prefer GALMAIL_MCP_POLICY_JSON or GALMAIL_MCP_TOKEN; otherwise mint a
 * fixture client and print the token on stderr.
 */
export function loadStandaloneMcpPolicy(): {
  policy: McpPolicy;
  token: string;
  minted: boolean;
} {
  const fromJson = process.env.GALMAIL_MCP_POLICY_JSON;
  if (fromJson) {
    const policy = parseMcpPolicy(JSON.parse(fromJson) as unknown);
    policy.enabled = true;
    const token =
      process.env.GALMAIL_MCP_TOKEN ??
      policy.clients.find((client) => !client.revokedAt)?.token;
    if (!token) {
      throw new Error(
        "GALMAIL_MCP_POLICY_JSON has no client token; set GALMAIL_MCP_TOKEN.",
      );
    }
    return { policy, token, minted: false };
  }

  /** Stable default so Cursor/Claude configs work without fishing stderr. */
  const envToken = process.env.GALMAIL_MCP_TOKEN ?? "gmcp_fixture_dev_token";
  const client = createMcpClient({
    name: process.env.GALMAIL_MCP_CLIENT_NAME ?? "local-dev",
    scopes: DEFAULT_PHASE1_SCOPES,
    createToken: () => envToken,
  });
  const policy = createDefaultMcpPolicy();
  policy.enabled = true;
  policy.approvalMode =
    process.env.GALMAIL_MCP_APPROVAL_MODE === "ask"
      ? "ask"
      : process.env.GALMAIL_MCP_APPROVAL_MODE === "allowlisted"
        ? "allowlisted"
        : "ask_writes";
  policy.clients = [client];
  return {
    policy,
    token: envToken,
    minted: !process.env.GALMAIL_MCP_TOKEN,
  };
}
