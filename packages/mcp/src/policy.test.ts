import { describe, expect, test } from "bun:test";
import {
  authenticateMcpClient,
  createDefaultMcpPolicy,
  createMcpClient,
  parseMcpPolicy,
  requiresApproval,
} from "./policy.js";

describe("mcp policy", () => {
  test("parses and authenticates clients", () => {
    const client = createMcpClient({
      name: "Cursor",
      createId: () => "mcp_test",
      createToken: () => "gmcp_test_token",
      now: () => new Date("2026-07-25T00:00:00.000Z"),
    });
    const policy = createDefaultMcpPolicy();
    policy.enabled = true;
    policy.clients = [client];

    expect(authenticateMcpClient(policy, "Bearer gmcp_test_token")).toEqual({
      ok: true,
      client,
    });
    expect(authenticateMcpClient(policy, "nope").ok).toBe(false);
  });

  test("ask_writes only gates write scopes", () => {
    expect(requiresApproval("ask_writes", "mail:search")).toBe(false);
    expect(requiresApproval("ask_writes", "mail:send")).toBe(true);
    expect(requiresApproval("ask", "mail:search")).toBe(true);
    expect(requiresApproval("allowlisted", "mail:send")).toBe(false);
  });

  test("parseMcpPolicy drops invalid clients", () => {
    const parsed = parseMcpPolicy({
      version: 1,
      enabled: true,
      approvalMode: "ask",
      earliestAfter: null,
      clients: [
        { id: "bad" },
        {
          id: "ok",
          name: "Ok",
          token: "t",
          scopes: ["mail:search", "nope"],
          accountAllowlist: ["gmail:a"],
          createdAt: "2026-01-01T00:00:00.000Z",
          lastUsedAt: null,
          revokedAt: null,
        },
      ],
    });
    expect(parsed.clients).toHaveLength(1);
    expect(parsed.clients[0]?.scopes).toEqual(["mail:search"]);
  });
});
