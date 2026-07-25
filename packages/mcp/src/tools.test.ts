import { describe, expect, test } from "bun:test";
import { AutoApproveGate, InMemoryApprovalGate } from "./approval.js";
import { createFixtureMcpHost } from "./fixture-host.js";
import {
  createDefaultMcpPolicy,
  createMcpClient,
} from "./policy.js";
import {
  executeGetMessage,
  executeListAccounts,
  executeSearchMail,
  McpToolError,
} from "./tools.js";

describe("mcp tools", () => {
  test("searches fixture mail across accounts", async () => {
    const host = await createFixtureMcpHost();
    const client = createMcpClient({
      name: "test",
      createToken: () => "token",
    });
    const policy = createDefaultMcpPolicy();
    policy.enabled = true;
    policy.approvalMode = "ask_writes";
    policy.clients = [client];
    const ctx = {
      policy,
      host,
      approval: new AutoApproveGate(),
      token: "token",
      autoApprove: true,
    };

    const accounts = await executeListAccounts(ctx);
    expect(accounts.accounts.length).toBeGreaterThanOrEqual(1);

    const search = await executeSearchMail(ctx, { query: "launch", limit: 10 });
    expect(search.hits.length).toBeGreaterThan(0);
    expect(search.hits[0]?.subject.toLowerCase()).toContain("launch");

    const message = await executeGetMessage(ctx, {
      accountId: search.hits[0]!.accountId,
      messageId: search.hits[0]!.messageId,
      includeBody: true,
    });
    expect(message.message.bodyText?.length).toBeGreaterThan(0);
  });

  test("denies tools without scope", async () => {
    const host = await createFixtureMcpHost();
    const client = createMcpClient({
      name: "search-only",
      scopes: ["accounts:list", "mail:search"],
      createToken: () => "token",
    });
    const policy = createDefaultMcpPolicy();
    policy.enabled = true;
    policy.clients = [client];
    const ctx = {
      policy,
      host,
      approval: new InMemoryApprovalGate(),
      token: "token",
      autoApprove: true,
    };

    await expect(
      executeGetMessage(ctx, {
        accountId: "gmail:demo",
        messageId: "m_launch_1",
        includeBody: true,
      }),
    ).rejects.toBeInstanceOf(McpToolError);
  });
});
