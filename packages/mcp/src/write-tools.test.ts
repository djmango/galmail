import { describe, expect, test } from "bun:test";
import { AutoApproveGate, InMemoryApprovalGate } from "./approval.js";
import { createFixtureMcpHost } from "./fixture-host.js";
import { SyncEngineMcpHost, type McpDraftInput } from "./host.js";
import { MemorySyncEngine } from "@galmail/core-api";
import { createGmailFixtureProvider } from "@galmail/providers";
import {
  createDefaultMcpPolicy,
  createMcpClient,
} from "./policy.js";
import { executeSaveDraft, executeSendDraft, McpToolError } from "./tools.js";

describe("mcp write tools", () => {
  test("save_draft and send_draft use host adapters", async () => {
    const gmail = createGmailFixtureProvider();
    const sync = new MemorySyncEngine([
      { accountId: "gmail:demo" as never, provider: gmail },
    ]);
    const saved: McpDraftInput[] = [];
    const sent: McpDraftInput[] = [];
    const host = new SyncEngineMcpHost(
      sync,
      [{ accountId: "gmail:demo", email: "demo@galmail.local", provider: "gmail" }],
      {
        saveDraft: async (input) => {
          saved.push(input);
          return { draftId: input.draftId ?? "d1" };
        },
        sendDraft: async (input) => {
          sent.push(input);
          return { messageId: "m_sent" };
        },
      },
    );
    const client = createMcpClient({
      name: "writer",
      scopes: [
        "accounts:list",
        "mail:search",
        "mail:read",
        "mail:draft",
        "mail:send",
      ],
      createToken: () => "token",
    });
    const policy = createDefaultMcpPolicy();
    policy.enabled = true;
    policy.approvalMode = "ask_writes";
    policy.clients = [client];

    const saveCtx = {
      policy,
      host,
      approval: new AutoApproveGate(),
      token: "token",
      autoApprove: true,
    };
    await executeSaveDraft(saveCtx, {
      accountId: "gmail:demo",
      to: ["a@example.com"],
      subject: "Hi",
      bodyText: "Hello",
    });
    expect(saved).toHaveLength(1);

    const approval = new InMemoryApprovalGate();
    const sendPromise = executeSendDraft(
      {
        policy,
        host,
        approval,
        token: "token",
        autoApprove: false,
      },
      {
        accountId: "gmail:demo",
        to: ["a@example.com"],
        subject: "Hi",
        bodyText: "Hello",
      },
    );
    await Bun.sleep(20);
    const pending = approval.listPending();
    expect(pending[0]?.toolName).toBe("send_draft");
    approval.decide(pending[0]!.id, "approved");
    const sentResult = await sendPromise;
    expect(sentResult.messageId).toBe("m_sent");
    expect(sent).toHaveLength(1);
  });

  test("save_draft fails without host support", async () => {
    const host = await createFixtureMcpHost();
    const client = createMcpClient({
      name: "writer",
      scopes: ["mail:draft"],
      createToken: () => "token",
    });
    const policy = createDefaultMcpPolicy();
    policy.enabled = true;
    policy.clients = [client];
    await expect(
      executeSaveDraft(
        {
          policy,
          host,
          approval: new AutoApproveGate(),
          token: "token",
          autoApprove: true,
        },
        {
          accountId: "gmail:demo",
          to: ["a@example.com"],
          subject: "Hi",
          bodyText: "Hello",
        },
      ),
    ).rejects.toBeInstanceOf(McpToolError);
  });
});
