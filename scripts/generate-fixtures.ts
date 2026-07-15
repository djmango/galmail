#!/usr/bin/env tsx
/**
 * Generate medium/large fixture mailboxes for performance harnesses.
 * Usage: pnpm exec tsx scripts/generate-fixtures.ts 10000
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const count = Number(process.argv[2] ?? 10_000);
const outDir = resolve("fixtures/mailboxes");
mkdirSync(outDir, { recursive: true });

const threads = [];
const messages = [];
for (let i = 0; i < count; i++) {
  const id = `t_${i}`;
  const mid = `m_${i}`;
  threads.push({
    id,
    subject: `Message ${i}`,
    snippet: `Snippet for generated fixture ${i}`,
    participants: [{ email: `sender${i % 50}@example.com`, name: `Sender ${i % 50}` }],
    messageIds: [mid],
    labelIds: ["INBOX"],
    unreadCount: i % 3 === 0 ? 1 : 0,
    lastMessageAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString(),
  });
  messages.push({
    id: mid,
    threadId: id,
    subject: `Message ${i}`,
    snippet: `Snippet for generated fixture ${i}`,
    from: { email: `sender${i % 50}@example.com`, name: `Sender ${i % 50}` },
    to: [{ email: "demo@galmail.local" }],
    date: threads[i]!.lastMessageAt,
    unread: i % 3 === 0,
    starred: false,
    labelIds: ["INBOX"],
    hasAttachments: false,
    bodyText: `Body ${i}`,
    bodyHtml: `<p>Body ${i}</p>`,
  });
}

const payload = {
  accountId: "gmail:perf",
  provider: "gmail",
  email: "demo@galmail.local",
  labels: [
    { id: "INBOX", name: "Inbox", kind: "system", providerNativeId: "INBOX" },
  ],
  threads,
  messages,
};

const name = count >= 100_000 ? `large-${count}.json` : `medium-${count}.json`;
const path = resolve(outDir, name);
writeFileSync(path, JSON.stringify(payload));
console.log(`Wrote ${count} messages to ${path}`);
