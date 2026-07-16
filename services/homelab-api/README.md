# `@galmail/homelab-api`

Bun + Hono BFF for self-hosted GalMail: device push registration, APNs test
dispatch, remote opt-in consent, and optional OpenAI-compatible classify.

Operator docs, Compose file, and reverse-proxy notes live in
[`deploy/homelab/README.md`](../../deploy/homelab/README.md).

```bash
bun run dev      # PORT=8789, requires DATABASE_URL
bun test
bun run typecheck
```
