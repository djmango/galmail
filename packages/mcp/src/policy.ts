import {
  DEFAULT_PHASE1_SCOPES,
  isMcpScope,
  isWriteScope,
  type McpScope,
} from "./scopes.js";

export type McpApprovalMode = "allowlisted" | "ask" | "ask_writes";

export type McpClientCredential = {
  id: string;
  name: string;
  /** Bearer token presented by the AI client. Shown once at creation. */
  token: string;
  scopes: McpScope[];
  /** Empty = all accounts on the host. */
  accountAllowlist: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type McpPolicy = {
  version: 1;
  enabled: boolean;
  approvalMode: McpApprovalMode;
  /** Optional ISO date floor for search/read (e.g. last 4 years). */
  earliestAfter: string | null;
  clients: McpClientCredential[];
};

export const MCP_POLICY_STORAGE_KEY = "galmail.mcpPolicy";

export function createDefaultMcpPolicy(): McpPolicy {
  return {
    version: 1,
    enabled: false,
    approvalMode: "ask_writes",
    earliestAfter: null,
    clients: [],
  };
}

export function createMcpClient(input: {
  name: string;
  scopes?: readonly McpScope[];
  accountAllowlist?: string[];
  now?: () => Date;
  createId?: () => string;
  createToken?: () => string;
}): McpClientCredential {
  const now = input.now ?? (() => new Date());
  const createId =
    input.createId ?? (() => `mcp_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`);
  const createToken =
    input.createToken ??
    (() => `gmcp_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`);
  return {
    id: createId(),
    name: input.name.trim() || "AI client",
    token: createToken(),
    scopes: [...(input.scopes ?? DEFAULT_PHASE1_SCOPES)],
    accountAllowlist: [...(input.accountAllowlist ?? [])],
    createdAt: now().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };
}

export function parseMcpPolicy(raw: unknown): McpPolicy {
  const fallback = createDefaultMcpPolicy();
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as Partial<McpPolicy>;
  const approvalMode =
    value.approvalMode === "allowlisted" ||
    value.approvalMode === "ask" ||
    value.approvalMode === "ask_writes"
      ? value.approvalMode
      : fallback.approvalMode;
  const clients = Array.isArray(value.clients)
    ? value.clients.flatMap((client) => {
        if (!client || typeof client !== "object") return [];
        const item = client as Partial<McpClientCredential>;
        if (
          typeof item.id !== "string" ||
          typeof item.name !== "string" ||
          typeof item.token !== "string" ||
          !Array.isArray(item.scopes)
        ) {
          return [];
        }
        const scopes = item.scopes.filter(
          (scope): scope is McpScope =>
            typeof scope === "string" && isMcpScope(scope),
        );
        return [
          {
            id: item.id,
            name: item.name,
            token: item.token,
            scopes,
            accountAllowlist: Array.isArray(item.accountAllowlist)
              ? item.accountAllowlist.filter(
                  (account): account is string => typeof account === "string",
                )
              : [],
            createdAt:
              typeof item.createdAt === "string"
                ? item.createdAt
                : new Date(0).toISOString(),
            lastUsedAt:
              typeof item.lastUsedAt === "string" || item.lastUsedAt === null
                ? item.lastUsedAt
                : null,
            revokedAt:
              typeof item.revokedAt === "string" || item.revokedAt === null
                ? item.revokedAt
                : null,
          } satisfies McpClientCredential,
        ];
      })
    : [];
  return {
    version: 1,
    enabled: Boolean(value.enabled),
    approvalMode,
    earliestAfter:
      typeof value.earliestAfter === "string" || value.earliestAfter === null
        ? value.earliestAfter
        : null,
    clients,
  };
}

export function loadMcpPolicyFromLocalStorage(
  storage: Pick<Storage, "getItem"> = localStorage,
): McpPolicy {
  try {
    const raw = storage.getItem(MCP_POLICY_STORAGE_KEY);
    if (!raw) return createDefaultMcpPolicy();
    return parseMcpPolicy(JSON.parse(raw) as unknown);
  } catch {
    return createDefaultMcpPolicy();
  }
}

export function persistMcpPolicyToLocalStorage(
  policy: McpPolicy,
  storage: Pick<Storage, "setItem"> = localStorage,
): void {
  storage.setItem(MCP_POLICY_STORAGE_KEY, JSON.stringify(policy));
}

export type McpAuthResult =
  | { ok: true; client: McpClientCredential }
  | { ok: false; error: string };

export function authenticateMcpClient(
  policy: McpPolicy,
  token: string | null | undefined,
): McpAuthResult {
  if (!policy.enabled) {
    return { ok: false, error: "GalMail MCP is disabled in Settings." };
  }
  if (!token) {
    return { ok: false, error: "Missing MCP bearer token." };
  }
  const normalized = token.replace(/^Bearer\s+/i, "").trim();
  const client = policy.clients.find(
    (item) => item.token === normalized && !item.revokedAt,
  );
  if (!client) {
    return { ok: false, error: "Unknown or revoked MCP client token." };
  }
  return { ok: true, client };
}

export function clientHasScope(
  client: McpClientCredential,
  scope: McpScope,
): boolean {
  return client.scopes.includes(scope);
}

export function accountAllowed(
  client: McpClientCredential,
  accountId: string,
): boolean {
  if (client.accountAllowlist.length === 0) return true;
  return client.accountAllowlist.includes(accountId);
}

/** Whether this scope needs a human approval under the current mode. */
export function requiresApproval(
  mode: McpApprovalMode,
  scope: McpScope,
): boolean {
  if (mode === "allowlisted") return false;
  if (mode === "ask") return true;
  return isWriteScope(scope);
}
