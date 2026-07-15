# GalMail OAuth Review Preparation

Submit early — restricted scopes block production launch.

## Google (Gmail API)

| Item | Plan |
|------|------|
| App name | GalMail |
| Scopes | Gmail readonly/modify as minimally required; justify each |
| OAuth branding | Privacy policy URL, homepage, support email |
| Security assessment | Likely required for restricted scopes |
| Demo video | Show fixture→live sync, local encryption, blind relay, opt-in disclosure |
| Data handling | Tokens on device only (default); opt-in processor isolated |

Checklist:

- [ ] Cloud Console project + OAuth client (macOS, iOS, web)
- [ ] Privacy policy published
- [ ] Threat model linked
- [ ] Limited production test users
- [ ] Verification questionnaire drafted

## Microsoft (Graph)

| Item | Plan |
|------|------|
| App registration | Multitenant or consumer+org as needed |
| Publisher verification | Complete before broad distribution |
| Permissions | `Mail.ReadWrite`, `User.Read`, offline_access — minimize |
| Admin consent | Document enterprise path |

Checklist:

- [ ] App IDs for web + native redirect URIs
- [ ] Publisher domain verified
- [ ] Redirect URI exact match with Tauri / PWA
- [ ] Token storage description (Keychain / WebCrypto)

## Env templates

See repository `.env.example`. Never commit client secrets. Prefer PKCE + public clients where possible for native/web.
