import type { McpApprovalGate } from "./approval.js";
import type { GalMailMcpHost, McpDraftInput } from "./host.js";
import {
  accountAllowed,
  authenticateMcpClient,
  clientHasScope,
  requiresApproval,
  type McpClientCredential,
  type McpPolicy,
} from "./policy.js";
import type { McpScope } from "./scopes.js";

export type McpToolName =
  | "list_accounts"
  | "search_mail"
  | "get_message"
  | "get_mcp_policy"
  | "save_draft"
  | "send_draft"
  | "search_calendar";

const TOOL_SCOPES: Record<McpToolName, McpScope> = {
  list_accounts: "accounts:list",
  search_mail: "mail:search",
  get_message: "mail:read",
  get_mcp_policy: "accounts:list",
  save_draft: "mail:draft",
  send_draft: "mail:send",
  search_calendar: "calendar:read",
};

export const MCP_TOOL_NAMES = Object.keys(TOOL_SCOPES) as McpToolName[];

export type ToolExecutionContext = {
  policy: McpPolicy;
  host: GalMailMcpHost;
  approval: McpApprovalGate;
  /** Bearer token from the connecting client (stdio may use env). */
  token: string | null;
  /** When true, skip waiting on approval (tests only). */
  autoApprove?: boolean;
};

export class McpToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpToolError";
  }
}

export function isMcpToolName(value: string): value is McpToolName {
  return value in TOOL_SCOPES;
}

async function authorize(
  ctx: ToolExecutionContext,
  toolName: McpToolName,
  accountIds: string[],
  summary: string,
): Promise<McpClientCredential> {
  const auth = authenticateMcpClient(ctx.policy, ctx.token);
  if (!auth.ok) throw new McpToolError(auth.error);
  const scope = TOOL_SCOPES[toolName];
  if (!clientHasScope(auth.client, scope)) {
    throw new McpToolError(`Client lacks scope ${scope}.`);
  }
  for (const accountId of accountIds) {
    if (!accountAllowed(auth.client, accountId)) {
      throw new McpToolError(`Account ${accountId} is not allowlisted.`);
    }
  }
  // Send always requires a human approval, even in allowlisted mode.
  const mustAsk =
    toolName === "send_draft" ||
    (requiresApproval(ctx.policy.approvalMode, scope) && !ctx.autoApprove);
  if (mustAsk && !ctx.autoApprove) {
    const request = await ctx.approval.request({
      clientId: auth.client.id,
      clientName: auth.client.name,
      toolName,
      scope,
      summary,
      accountIds,
    });
    const decision = await ctx.approval.waitForDecision(request.id);
    if (decision !== "approved") {
      throw new McpToolError("User denied the MCP request.");
    }
  }
  return auth.client;
}

function applyEarliestAfter(policy: McpPolicy, query: string): string {
  if (!policy.earliestAfter) return query;
  if (/\bafter:/i.test(query)) return query;
  return `${query} after:${policy.earliestAfter.slice(0, 10)}`.trim();
}

function asDraftInput(input: Record<string, unknown>): McpDraftInput {
  const accountId = String(input.accountId ?? "");
  const to = Array.isArray(input.to)
    ? input.to.map(String)
    : typeof input.to === "string"
      ? [input.to]
      : [];
  if (!accountId || to.length === 0) {
    throw new McpToolError("accountId and to are required");
  }
  return {
    accountId,
    to,
    cc: Array.isArray(input.cc) ? input.cc.map(String) : undefined,
    bcc: Array.isArray(input.bcc) ? input.bcc.map(String) : undefined,
    subject: String(input.subject ?? ""),
    bodyText: String(input.bodyText ?? ""),
    draftId:
      typeof input.draftId === "string" ? input.draftId : undefined,
  };
}

export async function executeListAccounts(ctx: ToolExecutionContext) {
  await authorize(ctx, "list_accounts", [], "List connected mail accounts");
  return { accounts: await ctx.host.listAccounts() };
}

export async function executeSearchMail(
  ctx: ToolExecutionContext,
  input: {
    query: string;
    accountIds?: string[];
    limit?: number;
    cursor?: string;
  },
) {
  const accountIds = input.accountIds ?? [];
  await authorize(
    ctx,
    "search_mail",
    accountIds,
    `Search mail (${accountIds.length || "all"} accounts)`,
  );
  const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
  const query = applyEarliestAfter(ctx.policy, input.query);
  return ctx.host.searchMail({
    accountIds,
    query,
    limit,
    cursor: input.cursor,
  });
}

export async function executeGetMessage(
  ctx: ToolExecutionContext,
  input: {
    accountId: string;
    messageId: string;
    includeBody?: boolean;
  },
) {
  const includeBody = Boolean(input.includeBody);
  await authorize(
    ctx,
    "get_message",
    [input.accountId],
    includeBody ? "Read one message body" : "Read one message metadata",
  );
  const message = await ctx.host.getMessage({
    accountId: input.accountId,
    messageId: input.messageId,
    includeBody,
  });
  if (!message) throw new McpToolError("Message not found.");
  return { message };
}

export async function executeGetMcpPolicy(ctx: ToolExecutionContext) {
  const client = await authorize(
    ctx,
    "get_mcp_policy",
    [],
    "Read MCP policy summary",
  );
  return {
    enabled: ctx.policy.enabled,
    approvalMode: ctx.policy.approvalMode,
    earliestAfter: ctx.policy.earliestAfter,
    scopes: client.scopes,
    accountAllowlist: client.accountAllowlist,
    clientName: client.name,
  };
}

export async function executeSaveDraft(
  ctx: ToolExecutionContext,
  input: Record<string, unknown>,
) {
  const draft = asDraftInput(input);
  await authorize(
    ctx,
    "save_draft",
    [draft.accountId],
    `Save draft to ${draft.to.length} recipient(s)`,
  );
  if (!ctx.host.saveDraft) {
    throw new McpToolError("save_draft is not available");
  }
  return ctx.host.saveDraft(draft);
}

export async function executeSendDraft(
  ctx: ToolExecutionContext,
  input: Record<string, unknown>,
) {
  const draft = asDraftInput(input);
  await authorize(
    ctx,
    "send_draft",
    [draft.accountId],
    `Send mail to ${draft.to.length} recipient(s)`,
  );
  if (!ctx.host.sendDraft) {
    throw new McpToolError("send_draft is not available");
  }
  return ctx.host.sendDraft(draft);
}

export async function executeSearchCalendar(
  ctx: ToolExecutionContext,
  input: {
    accountIds?: string[];
    query?: string;
    start?: string;
    end?: string;
    limit?: number;
  },
) {
  const accountIds = input.accountIds ?? [];
  await authorize(
    ctx,
    "search_calendar",
    accountIds,
    `Search calendar (${accountIds.length || "all"} accounts)`,
  );
  if (!ctx.host.searchCalendar) {
    throw new McpToolError("search_calendar is not available");
  }
  return ctx.host.searchCalendar({
    accountIds,
    query: input.query,
    start: input.start,
    end: input.end,
    limit: Math.min(Math.max(input.limit ?? 50, 1), 200),
  });
}

export async function executeMcpTool(
  ctx: ToolExecutionContext,
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  if (!isMcpToolName(name)) {
    throw new McpToolError(`Unknown MCP tool: ${name}`);
  }
  switch (name) {
    case "list_accounts":
      return executeListAccounts(ctx);
    case "search_mail":
      return executeSearchMail(ctx, {
        query: String(args.query ?? ""),
        accountIds: Array.isArray(args.accountIds)
          ? args.accountIds.map(String)
          : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
        cursor: typeof args.cursor === "string" ? args.cursor : undefined,
      });
    case "get_message":
      return executeGetMessage(ctx, {
        accountId: String(args.accountId ?? ""),
        messageId: String(args.messageId ?? ""),
        includeBody: Boolean(args.includeBody),
      });
    case "get_mcp_policy":
      return executeGetMcpPolicy(ctx);
    case "save_draft":
      return executeSaveDraft(ctx, args);
    case "send_draft":
      return executeSendDraft(ctx, args);
    case "search_calendar":
      return executeSearchCalendar(ctx, {
        accountIds: Array.isArray(args.accountIds)
          ? args.accountIds.map(String)
          : undefined,
        query: typeof args.query === "string" ? args.query : undefined,
        start: typeof args.start === "string" ? args.start : undefined,
        end: typeof args.end === "string" ? args.end : undefined,
        limit: typeof args.limit === "number" ? args.limit : undefined,
      });
  }
}

export function toolScope(toolName: McpToolName): McpScope {
  return TOOL_SCOPES[toolName];
}
