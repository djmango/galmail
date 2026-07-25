/**
 * Minimal MCP JSON-RPC helpers (no @modelcontextprotocol/sdk).
 * Stdio uses LSP-style Content-Length framing.
 */

export type JsonRpcId = string | number | null;

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type McpToolHandler = (
  args: Record<string, unknown>,
) => Promise<{
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}>;

export type GalMailMcpProtocolServer = {
  tools: Map<string, { def: McpToolDefinition; handler: McpToolHandler }>;
  name: string;
  version: string;
};

export function createProtocolServer(input: {
  name: string;
  version: string;
}): GalMailMcpProtocolServer {
  return {
    name: input.name,
    version: input.version,
    tools: new Map(),
  };
}

export function registerTool(
  server: GalMailMcpProtocolServer,
  def: McpToolDefinition,
  handler: McpToolHandler,
): void {
  server.tools.set(def.name, { def, handler });
}

export async function handleJsonRpc(
  server: GalMailMcpProtocolServer,
  message: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const id = message.id ?? null;
  if (message.id === undefined) {
    // Notification — no response.
    return null;
  }

  try {
    switch (message.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: server.name, version: server.version },
          },
        };
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          id,
          result: {
            tools: [...server.tools.values()].map((tool) => ({
              name: tool.def.name,
              description: tool.def.description,
              inputSchema: tool.def.inputSchema,
            })),
          },
        };
      case "tools/call": {
        const params = (message.params ?? {}) as {
          name?: string;
          arguments?: Record<string, unknown>;
        };
        const name = params.name ?? "";
        const tool = server.tools.get(name);
        if (!tool) {
          return {
            jsonrpc: "2.0",
            id,
            error: { code: -32601, message: `Unknown tool: ${name}` },
          };
        }
        const result = await tool.handler(params.arguments ?? {});
        return { jsonrpc: "2.0", id, result };
      }
      default:
        return {
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${message.method}` },
        };
    }
  } catch (error) {
    return {
      jsonrpc: "2.0",
      id,
      error: {
        code: -32000,
        message: error instanceof Error ? error.message : "Tool failed",
      },
    };
  }
}

export function encodeStdioMessage(message: unknown): Uint8Array {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(
    `Content-Length: ${body.byteLength}\r\n\r\n`,
    "utf8",
  );
  return Buffer.concat([header, body]);
}

/** Parse Content-Length framed messages from a growing buffer. */
export function consumeStdioBuffer(buffer: Buffer): {
  rest: Buffer;
  messages: JsonRpcRequest[];
} {
  const messages: JsonRpcRequest[] = [];
  let rest = buffer;
  while (true) {
    const headerEnd = rest.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const header = rest.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      rest = rest.subarray(headerEnd + 4);
      continue;
    }
    const length = Number.parseInt(match[1]!, 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (rest.byteLength < bodyEnd) break;
    const body = rest.subarray(bodyStart, bodyEnd).toString("utf8");
    rest = rest.subarray(bodyEnd);
    try {
      messages.push(JSON.parse(body) as JsonRpcRequest);
    } catch {
      // Ignore malformed frames.
    }
  }
  return { rest, messages };
}

export async function runStdioServer(
  server: GalMailMcpProtocolServer,
): Promise<void> {
  let buffer: Buffer = Buffer.alloc(0);
  const stdin = Bun.stdin.stream();
  const reader = stdin.getReader();

  // Keep process alive for stdio.
  process.stdin.resume();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    buffer = Buffer.concat([buffer, Buffer.from(value)]);
    const consumed = consumeStdioBuffer(buffer);
    buffer = Buffer.from(consumed.rest);
    for (const message of consumed.messages) {
      if (message.method === "notifications/initialized") continue;
      const response = await handleJsonRpc(server, message);
      if (response) {
        const encoded = encodeStdioMessage(response);
        await Bun.write(Bun.stdout, encoded);
      }
    }
  }
}
