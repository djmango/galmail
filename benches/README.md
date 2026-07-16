# GalMail Benchmarks

## Budgets

See [docs/performance-budgets.md](../docs/performance-budgets.md).

## Commands

```bash
# JS microbenches (warn-only)
bun run bench

# Generate 10k fixture mailbox
bunx tsx scripts/generate-fixtures.ts 10000

# Rust core tests (includes proptest)
bun run core:test
```

CI runs unit/property tests always. Latency hard-gates require dedicated hardware runners (not yet enforced).
