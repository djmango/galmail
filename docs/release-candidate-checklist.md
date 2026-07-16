# Release Candidate Checklist

This checklist separates machine-verifiable repository gates from evidence that
requires credentials, external reviewers, production infrastructure, or real
beta users. A local pass is necessary but is not approval to publish a stable
release.

## Local gate

- [ ] `bun install --frozen-lockfile`
- [ ] `bun run quality:local`
- [ ] `bunx playwright install chromium && bun run e2e`
- [ ] `bun run bench`
- [ ] `bun run sbom` produces `artifacts/galmail.cdx.json`
- [ ] `cargo audit` reports no unaccepted Rust advisories
- [ ] `bun audit --production` reports no production advisories
- [ ] `bun run --filter @galmail/blind-relay deploy:dry-run`
- [ ] `bun run --filter @galmail/opt-in-processor deploy:dry-run`
- [ ] `CI=true bun run tauri:build` creates unsigned local app and DMG bundles
- [ ] No open P0/P1 security, privacy, or data-loss issue is recorded

The browser gate covers keyboard navigation, reading, compose/send queueing,
settings persistence, offline local navigation, axe WCAG 2 A/AA checks, and the
50 ms keyboard-feedback proxy. Bundle limits are checked by
`scripts/check-budgets.ts`. Launch and memory targets that depend on a packaged
app or pinned hardware are not inferred from browser tests.

## Credentialed integration

- [ ] Register the Google Desktop OAuth client and test-user environment
- [ ] Exercise connect, refresh, revoke, delete, stale-history recovery, draft,
      send, attachment, and mutation flows against a dedicated Gmail account
- [ ] Complete Google restricted-scope verification and any required assessment
- [ ] Provision Cloudflare D1/R2/Queue resources in staging and production
- [ ] Validate abuse controls, deletion, restore, and regional retention in the
      deployed service plane
- [ ] Configure APNs/Web Push credentials and validate generic blind delivery on
      supported devices
- [ ] Supply Developer ID, notarization, and updater keys only through CI secrets
- [ ] Verify `codesign`, Gatekeeper, notarization stapling, update, and rollback
      using the release workflow artifacts

## Independent review and rollout

- [ ] Resolve findings from an independent cryptographic design/implementation review
- [ ] Resolve findings from an application penetration test
- [ ] Obtain privacy-policy and restricted-scope legal/compliance review
- [ ] Complete restore and disaster-recovery exercises with retained evidence
- [ ] Dogfood, private alpha, and external beta exit criteria are met
- [ ] Measured crash-free sessions and sync-success rates meet `docs/release-policy.md`
- [ ] Pinned reference Macs meet cold/warm launch, search, 100k-message memory,
      sleep/wake, low-disk, migration, and no-full-list-rerender budgets
- [ ] Stable release has zero open P0/P1 security or data-loss defects

Credential values, reviewer approvals, notarization results, and staged-beta
metrics must never be replaced with fixtures or manually asserted placeholders.
