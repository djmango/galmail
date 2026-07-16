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

`gmail.modify` is restricted and supports reading, composing, sending, and
modifying mail without permanent deletion. GalMail does not request
`https://mail.google.com/`; permanent deletion is unavailable unless a later
feature and separate scope review justify it. Confirm granted scopes after
exchange and disable unsupported operations if the grant is partial. Use
`access_type=offline`; use `prompt=consent` only when a refresh token is
actually needed, not on every sign-in.

Revocation calls Google's revocation endpoint, removes the Keychain token even
if the network call fails, and reports remote revocation as pending until
confirmed.

## Microsoft after Gmail/macOS stability

Register GalMail as a Mobile and desktop public client supporting the intended
account audiences. For the macOS system-browser flow, register and use
`http://localhost` as Microsoft recommends. Request:

- `openid`, `email`, `offline_access`
- `User.Read`
- `Mail.ReadWrite`
- `Mail.Send`

`Mail.Send` is separate from `Mail.ReadWrite`. Do not request application
permissions or admin-wide access for the consumer client. Enterprise tenant
consent is documented separately and never silently changes the account
audience.

## App deep links and mobile callbacks

The application identifier is `app.galmail.client`. General product deep links
use an allowlisted `galmail://` route set and must never contain OAuth codes,
tokens, or PKCE material. On macOS, provider callbacks use loopback listeners,
not the general deep-link handler.

iOS receives separate provider registrations. Google uses its iOS SDK/client
callback convention; Microsoft uses
`msauth.app.galmail.client://auth`. Associated-domain links may open ordinary
product routes but do not replace provider-required redirect registration.
Every incoming route is parsed natively against a fixed path/parameter schema
before any event reaches the webview.

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
