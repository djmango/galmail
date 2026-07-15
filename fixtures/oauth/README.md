# OAuth fixtures

GalMail defaults to `GALMAIL_PROVIDER_MODE=fixture` so local development never needs client secrets.

When moving to live providers:

1. Copy `../../.env.example` → `../../.env`
2. Create Google + Microsoft OAuth clients
3. Use PKCE where supported
4. Store tokens only in Keychain / non-exportable WebCrypto

Do not place real client secrets in this directory.
