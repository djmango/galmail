# OAuth fixtures

Local dev defaults to live provider mode (SignInScreen on cold start). Use the
**Browse demo mailbox** CTA, `bun run dev:fixture`, or `VITE_GALMAIL_PROVIDER_MODE=fixture`
only for UI demos and Playwright e2e.

When connecting live providers:

1. Put config in `secrets/dev.yaml` via sops (never create a `.env`)
2. Import the Google Desktop client JSON:
   `bun scripts/import-google-oauth-json.ts ~/Downloads/client_secret_*.json`
3. Use PKCE; the app only needs `VITE_GOOGLE_DESKTOP_CLIENT_ID`
4. Store tokens only in Keychain / non-exportable WebCrypto

`GOOGLE_DESKTOP_OAUTH_JSON` in sops is safekeeping for the Console download only.
Do not place real client secrets in this fixtures directory.
