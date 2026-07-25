import type { McpScope } from "./scopes.js";

export type McpApprovalStatus = "pending" | "approved" | "denied" | "expired";

export type McpApprovalRequest = {
  id: string;
  clientId: string;
  clientName: string;
  toolName: string;
  scope: McpScope;
  /** Content-free summary suitable for notifications (no subjects/bodies). */
  summary: string;
  accountIds: string[];
  createdAt: string;
  expiresAt: string;
  status: McpApprovalStatus;
  decidedAt: string | null;
};

export type McpApprovalDecision = "approved" | "denied";

export interface McpApprovalGate {
  request(input: {
    clientId: string;
    clientName: string;
    toolName: string;
    scope: McpScope;
    summary: string;
    accountIds: string[];
    ttlMs?: number;
  }): Promise<McpApprovalRequest>;
  waitForDecision(
    requestId: string,
    options?: { timeoutMs?: number; pollMs?: number },
  ): Promise<McpApprovalDecision>;
  decide(requestId: string, decision: McpApprovalDecision): boolean;
  listPending(): McpApprovalRequest[];
}

const DEFAULT_TTL_MS = 5 * 60 * 1000;

/** In-process gate for the app UI and local MCP server. */
export class InMemoryApprovalGate implements McpApprovalGate {
  private readonly requests = new Map<string, McpApprovalRequest>();
  private readonly waiters = new Map<
    string,
    Set<(decision: McpApprovalDecision) => void>
  >();

  constructor(
    private readonly options: {
      now?: () => Date;
      createId?: () => string;
      onChange?: (pending: McpApprovalRequest[]) => void;
    } = {},
  ) {}

  private now(): Date {
    return (this.options.now ?? (() => new Date()))();
  }

  private emit(): void {
    this.options.onChange?.(this.listPending());
  }

  async request(input: {
    clientId: string;
    clientName: string;
    toolName: string;
    scope: McpScope;
    summary: string;
    accountIds: string[];
    ttlMs?: number;
  }): Promise<McpApprovalRequest> {
    const created = this.now();
    const ttl = input.ttlMs ?? DEFAULT_TTL_MS;
    const id =
      this.options.createId?.() ??
      `appr_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const request: McpApprovalRequest = {
      id,
      clientId: input.clientId,
      clientName: input.clientName,
      toolName: input.toolName,
      scope: input.scope,
      summary: input.summary,
      accountIds: [...input.accountIds],
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + ttl).toISOString(),
      status: "pending",
      decidedAt: null,
    };
    this.requests.set(id, request);
    this.emit();
    return request;
  }

  decide(requestId: string, decision: McpApprovalDecision): boolean {
    const request = this.requests.get(requestId);
    if (!request || request.status !== "pending") return false;
    if (new Date(request.expiresAt).getTime() <= this.now().getTime()) {
      request.status = "expired";
      this.emit();
      return false;
    }
    request.status = decision;
    request.decidedAt = this.now().toISOString();
    const waiters = this.waiters.get(requestId);
    if (waiters) {
      for (const resolve of waiters) resolve(decision);
      this.waiters.delete(requestId);
    }
    this.emit();
    return true;
  }

  listPending(): McpApprovalRequest[] {
    const now = this.now().getTime();
    for (const request of this.requests.values()) {
      if (
        request.status === "pending" &&
        new Date(request.expiresAt).getTime() <= now
      ) {
        request.status = "expired";
      }
    }
    return [...this.requests.values()].filter(
      (request) => request.status === "pending",
    );
  }

  waitForDecision(
    requestId: string,
    options: { timeoutMs?: number; pollMs?: number } = {},
  ): Promise<McpApprovalDecision> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TTL_MS;
    return new Promise((resolve, reject) => {
      const existing = this.requests.get(requestId);
      if (!existing) {
        reject(new Error("Unknown approval request."));
        return;
      }
      if (existing.status === "approved" || existing.status === "denied") {
        resolve(existing.status);
        return;
      }

      const waiters = this.waiters.get(requestId) ?? new Set();
      const onDecision = (decision: McpApprovalDecision) => {
        clearTimeout(timer);
        waiters.delete(onDecision);
        resolve(decision);
      };
      waiters.add(onDecision);
      this.waiters.set(requestId, waiters);

      const timer = setTimeout(() => {
        waiters.delete(onDecision);
        const request = this.requests.get(requestId);
        if (request && request.status === "pending") {
          request.status = "expired";
          this.emit();
        }
        reject(new Error("Approval timed out."));
      }, timeoutMs);
    });
  }
}

/** Dev/fixture gate that always approves (never use for production send). */
export class AutoApproveGate implements McpApprovalGate {
  private readonly inner = new InMemoryApprovalGate();

  async request(
    input: Parameters<McpApprovalGate["request"]>[0],
  ): Promise<McpApprovalRequest> {
    const request = await this.inner.request(input);
    this.inner.decide(request.id, "approved");
    return { ...request, status: "approved", decidedAt: request.createdAt };
  }

  waitForDecision(requestId: string): Promise<McpApprovalDecision> {
    return this.inner.waitForDecision(requestId, { timeoutMs: 1_000 });
  }

  decide(requestId: string, decision: McpApprovalDecision): boolean {
    return this.inner.decide(requestId, decision);
  }

  listPending(): McpApprovalRequest[] {
    return this.inner.listPending();
  }
}
