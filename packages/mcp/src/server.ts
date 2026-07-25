import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { McpApprovalGate } from "./approval.js";
import type { GalMailMcpBridgeClient } from "./bridge-client.js";
import type { GalMailMcpHost } from "./host.js";
import type { McpPolicy } from "./policy.js";
import { executeMcpTool, McpToolError } from "./tools.js";

export type CreateGalMailMcpServerOptions = {
  policy: McpPolicy;
  host: GalMailMcpHost;
  approval: McpApprovalGate;
  /** Resolves the active client token per request (HTTP) or once (stdio). */
  getToken: () => string | null;
  autoApprove?: boolean;
  serverName?: string;
  serverVersion?: string;
  /**
   * When set, tool handlers proxy to the live GalMail desktop bridge
   * (policy + approval run inside the app).
   */
  bridge?: GalMailMcpBridgeClient;
};

function textResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2),
      },
    ],
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

export function createGalMailMcpServer(
  options: CreateGalMailMcpServerOptions,
): McpServer {
  const server = new McpServer({
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

  server.registerTool(
    "list_accounts",
    {
      description:
        "List GalMail accounts available to this MCP client (id, email, provider).",
      inputSchema: {},
    },
    async () => run("list_accounts"),
  );

  server.registerTool(
    "search_mail",
    {
      description:
        "Search local mail with GalMail query syntax (from:, to:, after:, before:, subject:, label:/in:, has:attachment, is:unread|starred, free text). Returns snippets, not full bodies.",
      inputSchema: {
        query: z.string().describe("GalMail search query"),
        accountIds: z
          .array(z.string())
          .optional()
          .describe("Limit to these account ids; omit for all allowlisted"),
        limit: z.number().int().min(1).max(100).optional(),
        cursor: z.string().optional().describe("Opaque pagination cursor"),
      },
    },
    async (args) => run("search_mail", args),
  );

  server.registerTool(
    "get_message",
    {
      description:
        "Fetch one message by account and id. Use includeBody only when you need the full text (requires mail:read).",
      inputSchema: {
        accountId: z.string(),
        messageId: z.string(),
        includeBody: z.boolean().optional(),
      },
    },
    async (args) => run("get_message", args),
  );

  server.registerTool(
    "get_mcp_policy",
    {
      description:
        "Return the effective MCP policy for this client (scopes, approval mode, account allowlist). Does not include secrets.",
      inputSchema: {},
    },
    async () => run("get_mcp_policy"),
  );

  server.registerTool(
    "save_draft",
    {
      description:
        "Save a draft in GalMail (requires mail:draft). Does not send.",
      inputSchema: {
        accountId: z.string(),
        to: z.array(z.string()).min(1),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        subject: z.string(),
        bodyText: z.string(),
        draftId: z.string().optional(),
      },
    },
    async (args) => run("save_draft", args),
  );

  server.registerTool(
    "send_draft",
    {
      description:
        "Send mail via GalMail (requires mail:send). Always prompts for approval in the GalMail app.",
      inputSchema: {
        accountId: z.string(),
        to: z.array(z.string()).min(1),
        cc: z.array(z.string()).optional(),
        bcc: z.array(z.string()).optional(),
        subject: z.string(),
        bodyText: z.string(),
        draftId: z.string().optional(),
      },
    },
    async (args) => run("send_draft", args),
  );

  server.registerTool(
    "search_calendar",
    {
      description:
        "Search calendar events across connected accounts (requires calendar:read).",
      inputSchema: {
        accountIds: z.array(z.string()).optional(),
        query: z.string().optional(),
        start: z.string().optional().describe("ISO start bound"),
        end: z.string().optional().describe("ISO end bound"),
        limit: z.number().int().min(1).max(200).optional(),
      },
    },
    async (args) => run("search_calendar", args),
  );

  return server;
}
