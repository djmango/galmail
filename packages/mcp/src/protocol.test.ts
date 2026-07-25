import { describe, expect, test } from "bun:test";
import {
  consumeStdioBuffer,
  createProtocolServer,
  encodeStdioMessage,
  handleJsonRpc,
  registerTool,
} from "./protocol.js";

describe("mcp protocol", () => {
  test("tools/list and tools/call", async () => {
    const server = createProtocolServer({ name: "galmail", version: "0.1.0" });
    registerTool(
      server,
      {
        name: "ping_tool",
        description: "ping",
        inputSchema: { type: "object", properties: {} },
      },
      async () => ({ content: [{ type: "text", text: "pong" }] }),
    );

    const listed = await handleJsonRpc(server, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    expect(listed?.result).toMatchObject({
      tools: [{ name: "ping_tool" }],
    });

    const called = await handleJsonRpc(server, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "ping_tool", arguments: {} },
    });
    expect(called?.result).toMatchObject({
      content: [{ type: "text", text: "pong" }],
    });
  });

  test("stdio framing roundtrip", () => {
    const encoded = encodeStdioMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    const { messages, rest } = consumeStdioBuffer(Buffer.from(encoded));
    expect(rest.byteLength).toBe(0);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.method).toBe("initialize");
  });
});
