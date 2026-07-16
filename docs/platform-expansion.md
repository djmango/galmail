# Post-macOS platform expansion

## iOS repository scope

`apps/web/src-tauri/gen/apple` is a generated Tauri 2 Xcode project with these
targets:

- `galmail-tauri_iOS`: shared React/Tauri/Rust application.
- `GalMailNotificationService`: encrypted App Group notification enrichment
  with a fail-closed generic blind fallback.
- `GalMailShareExtension`: bounded share import encrypted before it enters the
  App Group inbox.
- `GalMailAppleTests`: privacy-policy tests for blind payload parsing.

The Swift implementation under `swift/GalMailApple` is intentionally thin. It
registers notification actions, queues opaque archive/delete/mark-read/reply
actions for Rust to reconcile, provisions extension-only random keys in the
shared Keychain group, schedules background refresh/processing wake markers, and
handles encrypted share inputs. Provider credentials, message stores, and the
product UI remain in Rust/Tauri/React.

The checked-in project has no Apple development team. Set a real team only in a
local/CI override after the App ID, App Group, Keychain group, APNs capability,
and both extension identifiers exist in that team's account. Regenerate with:

```sh
bun run --cwd apps/web tauri ios init --ci --skip-targets-install \
  --config '{"bundle":{"iOS":{"developmentTeam":"REAL_TEAM_ID"}}}'
```

Then reapply/generate `project.yml` using `xcodegen generate`; do not commit
personal signing profiles. A repository build can validate the extension targets
with code signing disabled, but that is not APNs or device evidence.

Required external validation:

1. Provision `app.galmail.client`, `.notification-service`, and `.share`, App
   Group `group.app.galmail.client`, and the shared Keychain access group.
2. Confirm APNs development and production token registration through the
   authenticated blind relay.
3. On physical devices, test locked/first-unlock states, extension timeout,
   force quit, token rotation, offline action replay, background expiration,
   share size/type rejection, and Keychain/App Group accessibility.
4. Verify archive/delete/reply idempotency against real Gmail and Microsoft
   accounts. A queued action is not success until provider reconciliation.
5. Keep generic blind fallback enabled unless the Notification Service
   Extension reads and authenticates an unexpired local encrypted index record.

## Microsoft 365 repository scope

The provider package implements:

- Public-client authorization code + S256 PKCE helpers. No client secret is
  accepted or embedded.
- Delegated `Mail.ReadWrite`, `Mail.Send`, and `offline_access` scopes.
- User-, admin-, conditional-access-, and reauthentication-required states.
- Graph pagination, folder-scoped message delta rounds, opaque complete
  `@odata.deltaLink` persistence, expired-cursor reconciliation, `Retry-After`,
  bounded exponential backoff, and trusted-origin continuation validation.
- Normalized folders, categories, conversations, messages, mutations, drafts,
  send, and attachment streaming behind `MailProvider`.
- Unified-inbox ordering by normalized received timestamp while preserving
  account/provider identity.

The TypeScript OAuth exchange remains a protocol/test surface. Production native
composition performs loopback callback handling, code exchange, refresh, and
Keychain persistence in Tauri's Rust process. The React webview receives only
normalized account state and native-authenticated Graph responses.

External release blockers:

- A Microsoft Entra application/client ID with registered loopback and iOS
  redirect URIs.
- Tenant/publisher verification and any administrator approval required by
  customer policy.
- Real consumer and enterprise tenants for conditional access, shared mailbox,
  category, folder move, throttling, delta expiration, attachment, draft, send,
  and conversation behavior.
- Microsoft approval/registration is not implied by mocked provider tests.

Protocol evidence:

- [Microsoft authorization code flow and public-client PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow)
- [Microsoft admin-consent protocol](https://learn.microsoft.com/en-us/entra/identity-platform/v2-admin-consent)
- [Graph message delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0)
- [Graph throttling guidance](https://learn.microsoft.com/en-us/graph/throttling)
- [Graph message conversation/category fields](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0)
