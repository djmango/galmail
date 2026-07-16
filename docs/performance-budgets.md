# GalMail Performance Budgets

## Targets (supported laptop / recent iPhone)

| Metric                           | Budget         | Measurement                                 |
| -------------------------------- | -------------- | ------------------------------------------- |
| Cold launch to interactive shell | < 800 ms       | Time to first paint of local inbox skeleton |
| Warm launch                      | < 300 ms       | App resume with warm cache                  |
| Local inbox first results        | < 100 ms       | Query over encrypted local index            |
| Local search first results       | < 100 ms       | FTS / in-memory index                       |
| Keyboard action visual feedback  | < 50 ms        | Keydown → optimistic UI update              |
| Network work on launch           | None blocking  | Sync starts after hydrate                   |
| Main JavaScript bundle           | < 100 KiB gzip | Production Vite output                      |
| Main CSS bundle                  | < 20 KiB gzip  | Production Vite output                      |
| Total web distribution           | < 350 KiB raw  | All production web assets                   |

## Fixture mailboxes

| Fixture | Messages | Path                                         |
| ------- | -------- | -------------------------------------------- |
| small   | ~200     | `fixtures/mailboxes/small.json`              |
| medium  | 10k      | Generated via `scripts/generate-fixtures.ts` |
| large   | 100k     | Generated (CI optional)                      |
| huge    | 1M       | Local/nightly only                           |

## Automated harness

- JS microbench: `packages/core-api` (`bun run bench`)
- Browser keyboard-feedback proxy: `bun run e2e`
- Bundle gate: `bun run performance:check`
- Rust encrypted-store scale, restart, migration rollback, and property tests:
  `cargo test --workspace`
- CI-hard gates are deterministic and hardware-independent. Packaged cold/warm
  launch, 100k-message resident memory, and production search latency require a
  pinned reference Mac and remain release evidence rather than portable CI
  assertions.

## Engineering rules

1. Virtualize message lists
2. Lazy-load bodies and attachments
3. Batch DB writes
4. No network on critical launch path
5. Profile regressions in CI when budgets are wired to real hardware runners
