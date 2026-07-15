# GalMail Benchmarks

## Budgets

See [docs/performance-budgets.md](../docs/performance-budgets.md).

## Commands

```bash
# JS microbenches (warn-only)
pnpm bench

# Generate 10k fixture mailbox
pnpm exec tsx scripts/generate-fixtures.ts 10000

# Rust core tests (includes proptest)
pnpm core:test
```

CI runs unit/property tests always. Latency hard-gates require dedicated hardware runners (not yet enforced).
