/** HTTP client for the GalMail desktop MCP bridge (live vault). */

export type BridgeToolCallResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

export class GalMailMcpBridgeClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
  ) {}

  async health(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/health`, {
        method: "GET",
      });
      if (!response.ok) return false;
      const body = (await response.json()) as { ok?: boolean; service?: string };
      return body.ok === true && body.service === "galmail-mcp-bridge";
    } catch {
      return false;
    }
  }

  async callTool(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<unknown> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/$/, "")}/v1/tools/call`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name,
          arguments: args,
        }),
      },
    );
    const payload = (await response.json()) as BridgeToolCallResult & {
      result?: unknown;
      error?: string;
    };
    if (!response.ok || !payload.ok) {
      throw new Error(
        payload.error ?? `MCP bridge call failed (${response.status})`,
      );
    }
    return payload.result;
  }
}

export async function resolveLiveBridgeUrl(
  explicit?: string | null,
): Promise<string | null> {
  const candidate =
    explicit?.trim() ||
    process.env.GALMAIL_MCP_BRIDGE_URL?.trim() ||
    "http://127.0.0.1:8675";
  const client = new GalMailMcpBridgeClient(
    candidate,
    process.env.GALMAIL_MCP_TOKEN ?? "probe",
  );
  if (await client.health()) return candidate.replace(/\/$/, "");
  return null;
}
