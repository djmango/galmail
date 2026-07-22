# OAuth Scope, PKCE, and Redirect Strategy

## Client boundary

GalMail native applications are OAuth public clients. They ship a provider
client ID but never a client secret. Authorization uses the system browser and
authorization-code flow with PKCE; tokens are exchanged on device and refresh
tokens are stored through platform secure storage.

Each authorization attempt generates:

- a cryptographically random PKCE verifier of 32 bytes (43 base64url
  characters), retained only until exchange;
- `code_challenge = BASE64URL(SHA256(verifier))` and
  `code_challenge_method=S256`; and
- an independent 32-byte random `state`, bound to provider, attempt, redirect,
  and expiry and consumed exactly once.

Callbacks reject mismatched/expired state, provider confusion, duplicate
delivery, missing code, and provider errors. Authorization codes, verifiers,
tokens, and callback query strings never enter logs or the webview.

## Gmail for the first macOS release

Register a Google **Desktop app** client. Bind an ephemeral listener on
`127.0.0.1` and construct the exact loopback redirect for that attempt. Do not
use a fixed port, `localhost`, an embedded browser, or a custom-scheme callback
for Google desktop OAuth. Close the listener after one valid callback or a
short timeout and return a minimal browser success page.

Request these scopes for the complete mail client:

- `openid`
- `email`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/calendar` (create, modify, and read calendar
  events; reconnect accounts that only granted `calendar.readonly`)

`gmail.modify` is restricted and supports reading, composing, sending, and
modifying mail without permanent deletion. GalMail does not request
`https://mail.google.com/`; permanent deletion is unavailable unless a later
feature and separate scope review justify it. Confirm granted scopes after
exchange and disable unsupported operations if the grant is partial. Calendar
reads and writes use the Google Calendar API with the stored Google token
(native HTTP broker); missing full `calendar` access surfaces a reconnect
prompt, same pattern as Microsoft `Calendars.ReadWrite`. Use
`access_type=offline`; use `prompt=consent` only when a refresh token is
actually needed, not on every sign-in.

Revocation calls Google's revocation endpoint, removes the Keychain token even
if the network call fails, and reports remote revocation as pending until
confirmed.

## Microsoft after Gmail/macOS stability

Register GalMail as a Mobile and desktop **public client** (no secret) supporting
the intended account audiences. For the macOS system-browser flow, register a
loopback redirect under **Mobile and desktop applications** (not SPA/Web) and
enable **Allow public client flows**. The native client binds an ephemeral port
and uses `http://127.0.0.1:{port}/oauth/microsoft/callback` (also allow
`http://localhost` in Entra if you prefer Microsoft's default guidance).

Set `VITE_MICROSOFT_CLIENT_ID` (and optionally `VITE_MICROSOFT_TENANT`, default
`common`) in sops the same way as `VITE_GOOGLE_DESKTOP_CLIENT_ID`.

Request delegated scopes:

- `openid`, `profile`, `email`, `offline_access`
- `Mail.ReadWrite`
- `Mail.Send`
- `Calendars.ReadWrite` (create, modify, and read calendar events; reconnect
  accounts that only granted `Calendars.Read`)

`Mail.Send` is separate from `Mail.ReadWrite`. Do not request application
permissions or admin-wide access for the consumer client. Enterprise tenant
consent is documented separately and never silently changes the account
audience.

## App deep links and mobile callbacks

The application identifier is `com.galateacorp.mail`. General product deep links
use an allowlisted `galmail://` route set and must never contain OAuth codes,
tokens, or PKCE material. On macOS, provider callbacks use loopback listeners,
not the general deep-link handler.

### iOS (ASWebAuthenticationSession)

iOS does **not** use localhost TCP. Rust builds a custom-scheme `redirect_uri`,
Swift presents `ASWebAuthenticationSession`, and the callback URL is delivered
back to Rust for PKCE token exchange (same `gmail_oauth_*` /
`microsoft_oauth_*` commands as desktop).

| Provider  | Redirect URI                                                   | Callback scheme (Info.plist / session)          |
| --------- | -------------------------------------------------------------- | ----------------------------------------------- |
| Google    | `com.googleusercontent.apps.{CLIENT_ID_PREFIX}:/oauthredirect` | `com.googleusercontent.apps.{CLIENT_ID_PREFIX}` |
| Microsoft | `msauth.com.galateacorp.mail://auth`                           | `msauth.com.galateacorp.mail`                   |

Current Google iOS client (`VITE_GOOGLE_IOS_CLIENT_ID`):

- Client ID:
  `966863975017-9jr34jv83g260dgs0nckqr4h2pm7q10c.apps.googleusercontent.com`
- Exact redirect URI (must match auth + token exchange):
  `com.googleusercontent.apps.966863975017-9jr34jv83g260dgs0nckqr4h2pm7q10c:/oauthredirect`
- Info.plist / ASWebAuthenticationSession scheme:
  `com.googleusercontent.apps.966863975017-9jr34jv83g260dgs0nckqr4h2pm7q10c`

Note the single slash after the colon (`:/oauthredirect`), not `://`. Do not
use the Desktop client ID on iOS; that produces Google’s generic post-consent
failure. ASWebAuthenticationSession must use a non-ephemeral session so Google
can complete the custom-scheme redirect.

Portal setup:

- **Google Cloud:** create an **iOS** OAuth client with bundle ID
  `com.galateacorp.mail`. Put that client ID in `VITE_GOOGLE_IOS_CLIENT_ID`
  (desktop keeps `VITE_GOOGLE_DESKTOP_CLIENT_ID` + `GOOGLE_DESKTOP_OAUTH_JSON`).
  Register the reverse-client-ID URL scheme in the iOS target
  (`com.googleusercontent.apps.<prefix>` from the Console client). Do not enable
  App Check enforcement unless the app ships App Attest tokens.
- **Entra (Azure):** on the same Mobile and desktop public client, add
  `msauth.com.galateacorp.mail://auth` in addition to the desktop loopback
  redirect (`http://127.0.0.1` / path `/oauth/microsoft/callback`). Keep
  “Allow public client flows” = Yes.

Associated-domain links may open ordinary product routes but do not replace
provider-required redirect registration.

## Environments and verification

Google development/test and production use separate Cloud projects and client
IDs. Only named test users access the test project. Microsoft development and
production use separate app registrations. Redirects, bundle identifiers,
support domains, consent copy, and requested scopes must exactly match each
provider registration.

References:

- <https://developers.google.com/identity/protocols/oauth2/native-app>
- <https://developers.google.com/identity/protocols/oauth2/resources/best-practices>
- <https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification>
- <https://learn.microsoft.com/en-us/entra/identity-platform/scenario-desktop-app-configuration>
- <https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow>
