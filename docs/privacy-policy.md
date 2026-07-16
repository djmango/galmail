# GalMail Privacy Policy

**Effective date:** July 15, 2026

This policy describes how GalMail processes information when you use the
GalMail application and hosted services. Contact `privacy@galmail.app` with
privacy questions or requests.

## Information GalMail processes

The app connects directly to an email provider you authorize. On your device it
processes account identifiers, email content and metadata, contacts, drafts,
attachments, labels, settings, search indexes, and OAuth tokens to provide the
mail client.

The default hosted path receives opaque device and account routing identifiers,
push tokens, event times, encrypted blobs, blob sizes, and limited operational
metadata. It is designed not to receive plaintext mail, search queries, or
provider OAuth tokens.

Remote processing is off by default. If you enable it for a specific account,
the consent screen identifies the fields, purpose, processor, region, and
retention period. That service may receive mail data and separately controlled
provider credentials for the selected purpose until you disable it.

Diagnostics and crash reporting are off by default. If enabled, the information
described in `diagnostics-policy.md` is collected. Mail content, subjects,
recipients, addresses, OAuth tokens, search queries, and decrypted blobs are
excluded from default diagnostics.

## Why information is processed

GalMail processes information to:

- authenticate accounts and perform requested mail operations;
- synchronize and secure local data across approved devices;
- deliver generic push hints;
- perform remote features you explicitly enable;
- prevent abuse and maintain service reliability; and
- respond to support, security, and legal requests.

GalMail does not sell personal information or use mail content for advertising.
It does not train shared models on mail content without a separate explicit
agreement.

## Sharing

Information is shared only with the email provider you select, infrastructure
providers needed to operate the selected service, remote processors named at
consent, or authorities when legally required. Service providers are limited by
contract and access controls to their operational purpose.

Apple Push Notification service or a web push provider receives a generic
notification and routing token, not a sender, subject, body, or provider token.

## Retention and deletion

The default periods, deletion behavior, backup limits, and exceptions are in
`retention-deletion-policy.md`. Removing an account deletes GalMail-controlled
local account data and requests deletion of associated hosted objects. It does
not delete provider-hosted mail or recipient copies unless the user separately
requests that mail operation.

## Your choices and rights

You can inspect connected devices and remote-processing consent, export
GalMail-controlled data, revoke provider access, disable diagnostics, remove an
account, and request deletion. Depending on where you live, you may also have
rights to access, correct, restrict, object, or appeal. Requests can be sent to
`privacy@galmail.app`; identity verification may be required.

## Security and international processing

GalMail uses encryption, access controls, data minimization, and documented
incident procedures. No system is completely secure. Hosted providers may
process information in countries other than your own; the consent screen names
the region for any content-bearing remote processor.

## Children

GalMail is not directed to children under 13, or the minimum age required in
their jurisdiction, and does not knowingly collect their information.

## Changes

Material changes are announced in-app or through the release channel before
they take effect. A new consent version is required before expanding
content-bearing remote processing.
