import { describe, expect, test } from "bun:test";
import { InMemoryApprovalGate } from "./approval.js";
import { createFixtureMcpHost } from "./fixture-host.js";
import {
  createDefaultMcpPolicy,
  createMcpClient,
} from "./policy.js";
import { executeSearchMail, McpToolError } from "./tools.js";

describe("mcp approval flow", () => {
  test("ask mode waits for approve", async () => {
    const host = await createFixtureMcpHost();
    const client = createMcpClient({
      name: "Cursor",
      createToken: () => "token",
    });
    const policy = createDefaultMcpPolicy();
    policy.enabled = true;
    policy.approvalMode = "ask";
    policy.clients = [client];
    const approval = new InMemoryApprovalGate();
    const ctx = {
      policy,
      host,
      approval,
      token: "token",
      autoApprove: false,
    };

    const pendingSearch = executeSearchMail(ctx, { query: "launch" });
    await Bun.sleep(20);
    const pending = approval.listPending();
    expect(pending).toHaveLength(1);
    expect(pending[0]?.toolName).toBe("search_mail");
    expect(approval.decide(pending[0]!.id, "approved")).toBe(true);
    const result = await pendingSearch;
    expect(result.hits.length).toBeGreaterThan(0);
  });

  test("ask mode deny rejects the tool", async () => {
    const host = await createFixtureMcpHost();
    const client = createMcpClient({
      name: "Cursor",
      createToken: () => "token",
    });
    const policy = createDefaultMcpPolicy();
    policy.enabled = true;
    policy.approvalMode = "ask";
    policy.clients = [client];
    const approval = new InMemoryApprovalGate();
    const ctx = {
      policy,
      host,
      approval,
      token: "token",
      autoApprove: false,
    };

    const pendingSearch = executeSearchMail(ctx, { query: "launch" });
    await Bun.sleep(20);
    const pending = approval.listPending();
    approval.decide(pending[0]!.id, "denied");
    await expect(pendingSearch).rejects.toBeInstanceOf(McpToolError);
  });
});
