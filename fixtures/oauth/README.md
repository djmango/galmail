# OAuth fixtures

GalMail defaults to fixture provider mode so local UI work never needs live OAuth.

When moving to live providers:

1. Put config in `secrets/dev.json` via sops (never create a `.env`)
2. Import the Google Desktop client JSON:
   `bun scripts/import-google-oauth-json.ts ~/Downloads/client_secret_*.json`
3. Use PKCE; the app only needs `VITE_GOOGLE_DESKTOP_CLIENT_ID`
4. Store tokens only in Keychain / non-exportable WebCrypto

`GOOGLE_DESKTOP_OAUTH_JSON` in sops is safekeeping for the Console download only.
Do not place real client secrets in this fixtures directory.
