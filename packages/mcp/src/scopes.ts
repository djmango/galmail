/** MCP capability scopes. Write scopes always require stronger approval defaults. */
export const MCP_SCOPES = [
  "accounts:list",
  "mail:search",
  "mail:read",
  "mail:draft",
  "mail:send",
  "calendar:read",
  "calendar:write",
  "contacts:read",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export const READ_SCOPES: readonly McpScope[] = [
  "accounts:list",
  "mail:search",
  "mail:read",
  "calendar:read",
  "contacts:read",
];

export const WRITE_SCOPES: readonly McpScope[] = [
  "mail:draft",
  "mail:send",
  "calendar:write",
];

export const DEFAULT_PHASE1_SCOPES: readonly McpScope[] = [
  "accounts:list",
  "mail:search",
  "mail:read",
  "calendar:read",
  "mail:draft",
];

export function isMcpScope(value: string): value is McpScope {
  return (MCP_SCOPES as readonly string[]).includes(value);
}

export function isWriteScope(scope: McpScope): boolean {
  return (WRITE_SCOPES as readonly McpScope[]).includes(scope);
}
