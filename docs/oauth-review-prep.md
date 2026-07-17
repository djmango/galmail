# GalMail Provider Review Preparation

Repository collateral is ready to adapt for provider portals. Portal
registration, domain ownership, verification, assessments, and approvals are
external work and are not complete merely because this file exists.

## Google submission package

### Registration values

- Product: GalMail
- Application type for first release: Desktop app
- Platforms: macOS first; iOS is a later, separate client
- Requested scopes: `openid`, `email`,
  `https://www.googleapis.com/auth/gmail.modify`
- Redirect: ephemeral `http://127.0.0.1:{port}/...` loopback listener created by
  the desktop app
- Public client: yes; no client secret

### Scope justification

`gmail.modify` is the narrowest single Gmail scope supporting the promised core
workflow: synchronize message/thread data, create and update drafts, send mail,
and change read, archive, trash, star, and label state. GalMail does not request
the full-mail scope and does not permanently delete mail. `openid` and `email`
bind the provider account to the local profile without requesting broader
Google profile data.

In default mode, Gmail data and tokens are processed on the user's device.
Local data will use SQLCipher and Keychain-backed keys before live production
access. Blind notifications contain no sender, recipient, subject, body, or
token. Per-account remote processing is a separately consented mode and must be
described in the verification submission if enabled for the reviewed build.

### Demo script

1. Install the exact submitted build and show diagnostics/remote processing off.
2. Connect a named test user in the system browser and show the requested
   scopes.
3. Show inbox sync, open/search, label/archive, draft, send, and trash.
4. Show local token storage boundary and generic blind notification.
5. Enable remote processing and show fields, processor, region, retention, and
   zero-access warning; then revoke it and verify deletion.
6. Disconnect Gmail, revoke access, delete local/hosted GalMail data, and show
   that provider-hosted mail remains.

Record the build hash, app version, OAuth project/client ID, policy URLs, and
date in the submission record. Do not use fixture behavior in the review video.

### Repository-ready collateral

- `SECURITY.md`
- `docs/privacy-policy.md`
- `docs/retention-deletion-policy.md`
- `docs/threat-model.md`
- `docs/security-requirements.md`
- `docs/oauth-architecture.md`
- `docs/diagnostics-policy.md`
- scope justification and demo script above

### External Google actions

- [ ] Establish and verify the production legal entity, support email, homepage,
      privacy-policy URL, terms URL if required, and authorized domains.
- [ ] Create separate Google Cloud test and production projects; enable Gmail
      API and configure the OAuth consent screen.
- [ ] Create the Desktop app client manually, record its client ID in release
      secrets/configuration, and keep the project in testing with named users
      until review.
- [ ] Confirm the exact shipping endpoints against `gmail.modify`; remove any
      endpoint not covered or update the justification before submission.
- [ ] Publish the reviewed policies on verified HTTPS domains.
- [ ] Capture the demo using a live review build and submit brand/scope
      verification in Google Cloud.
- [ ] Ask Google whether the reviewed architecture and any opted-in
      third-party-server access require an annual empanelled security
      assessment; contract and complete one when required.
- [ ] Resolve reviewer questions and obtain written approval before stable
      access. Repository work cannot guarantee approval time or outcome.

## Microsoft preparation (later milestone)

Register separate development and production Mobile and desktop public clients.
The planned delegated permissions are `openid`, `email`, `offline_access`,
`User.Read`, `Mail.ReadWrite`, and `Mail.Send`. The macOS system-browser
redirect is `http://127.0.0.1` (path `/oauth/microsoft/callback`; Mobile and
desktop; public client flows on). iOS uses ASWebAuthenticationSession with
`msauth.com.galateacorp.mail://auth`. No application permission or client
secret belongs in a distributed client.

External Microsoft actions:

- [ ] Select and document supported account audiences (consumer, organizations,
      or both) and enterprise admin-consent behavior.
- [ ] Create Entra app registrations and exact platform redirect URIs.
- [ ] Verify the publisher domain and complete publisher verification.
- [ ] Configure delegated permissions and test consent/revocation in consumer
      and enterprise tenants.
- [ ] Publish support/privacy URLs and obtain any tenant/customer security
      review required for beta distribution.

## Launch rule

Fixture and named-provider-test-user builds may proceed within provider limits.
Beta follows the provider's permitted testing state. Stable Gmail release is
blocked until Google verification and any required assessment are complete.
Microsoft stable access is independently blocked on its registration and
publisher-review requirements.
