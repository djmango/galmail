import { asAccountId, type AccountId, type SyncEngine } from "@galmail/core-api";
import {
  draftInputToComposeDraft,
  executeMcpTool,
  InMemoryApprovalGate,
  SyncEngineMcpHost,
  type McpAccountInfo,
  type McpApprovalRequest,
  type McpCalendarEventView,
  type McpDraftInput,
  type McpPolicy,
  type ToolExecutionContext,
} from "@galmail/mcp";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { GalMailRuntime } from "./runtime";
import { loadGoogleCalendarEvents } from "./google-calendar";
import { loadMicrosoftCalendarEvents } from "./microsoft-calendar";
import { NativeGmailSyncEngine } from "./native-sync";

export type McpBridgeStatus = {
  running: boolean;
  port: number;
  url: string | null;
};

export type McpBridgeRequestEvent = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  token: string;
};

function accountInfoFromRuntime(runtime: GalMailRuntime): McpAccountInfo[] {
  return runtime.accounts.map((account) => ({
    accountId: account.accountId,
    email: account.email,
    provider: account.accountId.startsWith("gmail:")
      ? "gmail"
      : account.accountId.startsWith("microsoft:")
        ? "microsoft"
        : "fixture",
  }));
}

async function searchCalendarForRuntime(
  runtime: GalMailRuntime,
  input: {
    accountIds: string[];
    query?: string;
    start?: string;
    end?: string;
    limit: number;
  },
): Promise<{ events: McpCalendarEventView[] }> {
  const accountIds =
    input.accountIds.length > 0
      ? input.accountIds
      : runtime.accounts.map((account) => account.accountId);
  const start = input.start ? new Date(input.start) : undefined;
  const end = input.end ? new Date(input.end) : undefined;
  const query = input.query?.trim().toLowerCase() ?? "";
  const events: McpCalendarEventView[] = [];

  for (const accountId of accountIds) {
    try {
      const loaded = accountId.startsWith("microsoft:")
        ? await loadMicrosoftCalendarEvents({
            accountId,
            start,
            end,
            limit: input.limit,
          })
        : await loadGoogleCalendarEvents({
            accountId,
            start,
            end,
            limit: input.limit,
          });
      for (const event of loaded) {
        const haystack = [
          event.title,
          event.location ?? "",
          ...(event.attendees ?? []).map(
            (attendee) => `${attendee.email} ${attendee.name ?? ""}`,
          ),
        ]
          .join(" ")
          .toLowerCase();
        if (query && !haystack.includes(query)) continue;
        events.push({
          id: event.id,
          accountId: event.accountId,
          provider: event.provider,
          title: event.title,
          start: event.start,
          end: event.end,
          location: event.location,
          attendees: (event.attendees ?? []).map((attendee) => attendee.email),
        });
      }
    } catch {
      // Skip accounts without calendar access.
    }
  }

  events.sort((a, b) => a.start.localeCompare(b.start));
  return { events: events.slice(0, input.limit) };
}

function createLiveHost(
  runtime: GalMailRuntime,
): SyncEngineMcpHost {
  const sync = runtime.sync as SyncEngine;
  const native = runtime.sync as NativeGmailSyncEngine;

  const saveDraft = async (input: McpDraftInput) => {
    const draft = draftInputToComposeDraft(input);
    await native.enqueue({
      accountId: draft.accountId,
      kind: "save_draft",
      targetIds: [draft.id],
      payload: { draft },
    });
    await native.flushOutbox(draft.accountId);
    return { draftId: draft.id };
  };

  const sendDraft = async (input: McpDraftInput) => {
    const draft = draftInputToComposeDraft(input);
    await native.enqueue({
      accountId: draft.accountId,
      kind: "save_draft",
      targetIds: [draft.id],
      payload: { draft },
    });
    const mutation = await native.enqueue({
      accountId: draft.accountId,
      kind: "send",
      targetIds: [draft.id],
      payload: { draft },
    });
    await native.flushOutbox(draft.accountId);
    return { messageId: mutation.id };
  };

  return new SyncEngineMcpHost(sync, accountInfoFromRuntime(runtime), {
    saveDraft,
    sendDraft,
    searchCalendar: (input) => searchCalendarForRuntime(runtime, input),
  });
}

export class LiveMcpSession {
  readonly approval = new InMemoryApprovalGate({
    onChange: (pending) => this.onPendingChange?.(pending),
  });
  private unlisten: UnlistenFn | null = null;
  private host: SyncEngineMcpHost | null = null;
  onPendingChange: ((pending: McpApprovalRequest[]) => void) | null = null;

  constructor(
    private runtime: GalMailRuntime | null,
    private policy: McpPolicy,
  ) {
    if (runtime) this.host = createLiveHost(runtime);
  }

  setRuntime(runtime: GalMailRuntime | null): void {
    this.runtime = runtime;
    this.host = runtime ? createLiveHost(runtime) : null;
  }

  setPolicy(policy: McpPolicy): void {
    this.policy = policy;
  }

  pending(): McpApprovalRequest[] {
    return this.approval.listPending();
  }

  decide(requestId: string, decision: "approved" | "denied"): boolean {
    return this.approval.decide(requestId, decision);
  }

  activeTokens(): string[] {
    return this.policy.clients
      .filter((client) => !client.revokedAt)
      .map((client) => client.token);
  }

  async startBridge(): Promise<McpBridgeStatus> {
    if (!this.policy.enabled) {
      throw new Error("Enable MCP in Settings first");
    }
    const tokens = this.activeTokens();
    if (tokens.length === 0) {
      throw new Error("Create an MCP client token first");
    }
    await this.ensureListener();
    return invoke<McpBridgeStatus>("mcp_bridge_start", {
      request: { tokens, port: 8675 },
    });
  }

  async stopBridge(): Promise<McpBridgeStatus> {
    return invoke<McpBridgeStatus>("mcp_bridge_stop");
  }

  async syncTokens(): Promise<void> {
    await invoke("mcp_bridge_update_tokens", {
      request: { tokens: this.activeTokens() },
    });
  }

  async status(): Promise<McpBridgeStatus> {
    return invoke<McpBridgeStatus>("mcp_bridge_status");
  }

  async ensureListener(): Promise<void> {
    if (this.unlisten) return;
    this.unlisten = await listen<McpBridgeRequestEvent>(
      "mcp-bridge-request",
      (event) => {
        void this.handleBridgeRequest(event.payload);
      },
    );
  }

  dispose(): void {
    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }
  }

  private context(token: string): ToolExecutionContext {
    if (!this.host) {
      throw new Error("GalMail runtime is not ready for MCP");
    }
    return {
      policy: this.policy,
      host: this.host,
      approval: this.approval,
      token,
      autoApprove: false,
    };
  }

  private async handleBridgeRequest(
    request: McpBridgeRequestEvent,
  ): Promise<void> {
    try {
      if (!this.policy.enabled) {
        throw new Error("MCP is disabled");
      }
      if (!this.host || !this.runtime) {
        throw new Error("Open and sync GalMail before using MCP");
      }
      const args =
        request.arguments && typeof request.arguments === "object"
          ? request.arguments
          : {};
      const result = await executeMcpTool(
        this.context(request.token),
        request.name,
        args,
      );
      await invoke("mcp_bridge_respond", {
        request: {
          id: request.id,
          ok: true,
          result,
          error: null,
        },
      });
    } catch (error) {
      await invoke("mcp_bridge_respond", {
        request: {
          id: request.id,
          ok: false,
          result: null,
          error: error instanceof Error ? error.message : "Tool failed",
        },
      });
    }
  }
}

export function cursorLiveMcpConfig(input: {
  token: string;
  repoRootHint?: string;
}): string {
  return JSON.stringify(
    {
      mcpServers: {
        galmail: {
          command: "bun",
          args: ["run", "--filter", "@galmail/mcp", "stdio"],
          env: {
            GALMAIL_MCP_TOKEN: input.token,
            GALMAIL_MCP_BRIDGE_URL: "http://127.0.0.1:8675",
          },
        },
      },
    },
    null,
    2,
  );
}

/** Test helper: run a tool against a provided sync engine without Tauri. */
export async function executeLiveToolForTests(input: {
  sync: SyncEngine;
  accounts: McpAccountInfo[];
  policy: McpPolicy;
  token: string;
  name: string;
  args?: Record<string, unknown>;
  autoApprove?: boolean;
}): Promise<unknown> {
  const host = new SyncEngineMcpHost(input.sync, input.accounts);
  return executeMcpTool(
    {
      policy: input.policy,
      host,
      approval: new InMemoryApprovalGate(),
      token: input.token,
      autoApprove: input.autoApprove ?? true,
    },
    input.name,
    input.args ?? {},
  );
}

export function asLiveAccountId(value: string): AccountId {
  return asAccountId(value);
}
