import type { McpApprovalGate } from "./approval.js";
import type { GalMailMcpBridgeClient } from "./bridge-client.js";
import type { GalMailMcpHost } from "./host.js";
import type { McpPolicy } from "./policy.js";
import {
  createProtocolServer,
  registerTool,
  type GalMailMcpProtocolServer,
} from "./protocol.js";
import { executeMcpTool, McpToolError } from "./tools.js";

export type CreateGalMailMcpServerOptions = {
  policy: McpPolicy;
  host: GalMailMcpHost;
  approval: McpApprovalGate;
  getToken: () => string | null;
  autoApprove?: boolean;
  serverName?: string;
  serverVersion?: string;
  bridge?: GalMailMcpBridgeClient;
};

function textResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(error: unknown) {
  const message =
    error instanceof McpToolError
      ? error.message
      : error instanceof Error
        ? error.message
        : "Tool failed.";
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: message }],
  };
}

const objectSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

export function createGalMailMcpServer(
  options: CreateGalMailMcpServerOptions,
): GalMailMcpProtocolServer {
  const server = createProtocolServer({
    name: options.serverName ?? "galmail",
    version: options.serverVersion ?? "0.1.0",
  });

  const run = async (name: string, args: Record<string, unknown> = {}) => {
    try {
      if (options.bridge) {
        return textResult(await options.bridge.callTool(name, args));
      }
      const result = await executeMcpTool(
        {
          policy: options.policy,
          host: options.host,
          approval: options.approval,
          token: options.getToken(),
          autoApprove: options.autoApprove,
        },
        name,
        args,
      );
      return textResult(result);
    } catch (error) {
      return errorResult(error);
    }
  };

  registerTool(
    server,
    {
      name: "list_accounts",
      description:
        "List GalMail accounts available to this MCP client (id, email, provider).",
      inputSchema: { ...objectSchema },
    },
    async () => run("list_accounts"),
  );

  registerTool(
    server,
    {
      name: "search_mail",
      description:
        "Search local mail with GalMail query syntax (from:, to:, after:, before:, subject:, label:/in:, has:attachment, is:unread|starred, free text). Returns snippets, not full bodies.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "GalMail search query" },
          accountIds: {
            type: "array",
            items: { type: "string" },
            description: "Limit to these account ids; omit for all allowlisted",
          },
          limit: { type: "integer", minimum: 1, maximum: 100 },
          cursor: { type: "string", description: "Opaque pagination cursor" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
    async (args) => run("search_mail", args),
  );

  registerTool(
    server,
    {
      name: "get_message",
      description:
        "Fetch one message by account and id. Use includeBody only when you need the full text (requires mail:read).",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          messageId: { type: "string" },
          includeBody: { type: "boolean" },
        },
        required: ["accountId", "messageId"],
        additionalProperties: false,
      },
    },
    async (args) => run("get_message", args),
  );

  registerTool(
    server,
    {
      name: "get_mcp_policy",
      description:
        "Return the effective MCP policy for this client (scopes, approval mode, account allowlist). Does not include secrets.",
      inputSchema: { ...objectSchema },
    },
    async () => run("get_mcp_policy"),
  );

  registerTool(
    server,
    {
      name: "save_draft",
      description:
        "Save a draft in GalMail (requires mail:draft). Does not send.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          to: { type: "array", items: { type: "string" }, minItems: 1 },
          cc: { type: "array", items: { type: "string" } },
          bcc: { type: "array", items: { type: "string" } },
          subject: { type: "string" },
          bodyText: { type: "string" },
          draftId: { type: "string" },
        },
        required: ["accountId", "to", "subject", "bodyText"],
        additionalProperties: false,
      },
    },
    async (args) => run("save_draft", args),
  );

  registerTool(
    server,
    {
      name: "send_draft",
      description:
        "Send mail via GalMail (requires mail:send). Always prompts for approval in the GalMail app.",
      inputSchema: {
        type: "object",
        properties: {
          accountId: { type: "string" },
          to: { type: "array", items: { type: "string" }, minItems: 1 },
          cc: { type: "array", items: { type: "string" } },
          bcc: { type: "array", items: { type: "string" } },
          subject: { type: "string" },
          bodyText: { type: "string" },
          draftId: { type: "string" },
        },
        required: ["accountId", "to", "subject", "bodyText"],
        additionalProperties: false,
      },
    },
    async (args) => run("send_draft", args),
  );

  registerTool(
    server,
    {
      name: "search_calendar",
      description:
        "Search calendar events across connected accounts (requires calendar:read).",
      inputSchema: {
        type: "object",
        properties: {
          accountIds: { type: "array", items: { type: "string" } },
          query: { type: "string" },
          start: { type: "string", description: "ISO start bound" },
          end: { type: "string", description: "ISO end bound" },
          limit: { type: "integer", minimum: 1, maximum: 200 },
        },
        additionalProperties: false,
      },
    },
    async (args) => run("search_calendar", args),
  );

  return server;
}
