# GalMail MCP

Status: live desktop bridge. AI clients reach your **local vault** while GalMail
is open. See also [privacy-model.md](privacy-model.md).

## Goals

- Let clients (Cursor, Claude Desktop, etc.) call GalMail tools over MCP.
- Keep mail on-device; execution uses the live sync engine / encrypted DB.
- Scope what each client can do (accounts, read vs write, date bounds).
- Approve sensitive calls in the GalMail app (banner; notification can open the
  app later). Self-host Tunnel/Tailscale is optional later.

## How live access works

```
AI client --stdio--> bun @galmail/mcp
                         |
                         v
              http://127.0.0.1:8675  (Tauri MCP bridge)
                         |
                         v
              GalMail webview (policy, approvals, NativeGmailSyncEngine)
```

1. Open GalMail desktop, connect accounts, sync.
2. Settings → MCP → Enable → Create client (copy token).
3. Start bridge (auto-starts when enabled + client exists).
4. Point Cursor at the snippet (uses `GALMAIL_MCP_BRIDGE_URL`).

Fixture mode is opt-in only: `GALMAIL_MCP_ALLOW_FIXTURE=1`.

## Tools

| Tool | Scope | Notes |
| ---- | ----- | ----- |
| `list_accounts` | `accounts:list` | |
| `search_mail` | `mail:search` | GalMail query DSL; snippets |
| `get_message` | `mail:read` | Optional `includeBody` |
| `search_calendar` | `calendar:read` | Live Google/Microsoft calendars |
| `save_draft` | `mail:draft` | Durable outbox |
| `send_draft` | `mail:send` | **Always** requires in-app approval |
| `get_mcp_policy` | `accounts:list` | Effective scopes (no secrets) |

## Approval modes

- `ask_writes` (default) — reads auto; drafts/sends ask (`send` always asks)
- `ask` — every call waits for the in-app banner
- `allowlisted` — scoped calls auto; **send still asks**

## Cursor config

```json
{
  "mcpServers": {
    "galmail": {
      "command": "bun",
      "args": ["run", "--filter", "@galmail/mcp", "stdio"],
      "env": {
        "GALMAIL_MCP_TOKEN": "<token from Settings>",
        "GALMAIL_MCP_BRIDGE_URL": "http://127.0.0.1:8675"
      }
    }
  }
}
```

## Package / bridge

- `@galmail/mcp` - minimal MCP JSON-RPC (no upstream SDK), policy, tools, bridge client
- `apps/web/src-tauri/src/mcp_bridge.rs` - loopback HTTP bridge
- `apps/web/src/lib/mcp-live.ts` - live host + approval session

## Phases

| Phase | Status |
| ----- | ------ |
| 0 Policy + Settings | Done |
| 1 Live read tools + bridge | Done |
| 2 In-app approval banner | Done |
| 3 Draft/send + calendar | Done |
| 4 Self-host / Tunnel proxy | Later |
