import { describe, expect, it } from "bun:test";
import {
  asAccountId,
  type AccountId,
  type ComposeDraft,
  type MailProvider,
} from "@galmail/core-api";
import { createGmailFixtureProvider } from "./gmail/fixture.js";
import { createMicrosoftFixtureProvider } from "./microsoft/fixture.js";

function providerContract(
  name: string,
  accountId: AccountId,
  create: () => MailProvider,
) {
  describe(`${name} provider contract`, () => {
    it("returns normalized, internally consistent labels, threads, and messages", async () => {
      const provider = create();
      const labels = await provider.listLabels(accountId);
      const first = await provider.listThreads(accountId, { limit: 1 });
      expect(labels.length).toBeGreaterThan(0);
      expect(first.threads).toHaveLength(1);
      const thread = await provider.getThread(accountId, first.threads[0]!.id);
      expect(thread.accountId).toBe(accountId);
      expect(thread.provider).toBe(provider.kind);
      for (const messageId of thread.messageIds) {
        const message = await provider.getMessage(accountId, messageId);
        expect(message.accountId).toBe(accountId);
        expect(message.provider).toBe(provider.kind);
        expect(message.threadId).toBe(thread.id);
      }
    });

    it("provides stable cursor identity and idempotent normalized mutations", async () => {
      const provider = create();
      const { threads } = await provider.listThreads(accountId, { limit: 1 });
      const messageId = threads[0]!.messageIds[0]!;
      const mutation = {
        kind: "mark_read" as const,
        targetIds: [messageId, messageId],
        payload: { mutationId: "contract-idempotency" },
      };
      await provider.applyMutation(accountId, mutation);
      await provider.applyMutation(accountId, mutation);
      expect((await provider.getMessage(accountId, messageId)).unread).toBe(
        false,
      );

      const first = await provider.fetchDeltas(accountId, null);
      const second = await provider.fetchDeltas(accountId, first.nextCursor);
      expect(first.nextCursor).toMatchObject({
        accountId,
        provider: provider.kind,
      });
      expect(second.nextCursor).toMatchObject({
        accountId,
        provider: provider.kind,
      });
      expect(second.nextCursor.token).not.toBe(first.nextCursor.token);
    });

    it("implements the complete draft lifecycle", async () => {
      const provider = create();
      const draft: ComposeDraft = {
        id: "contract-draft",
        accountId,
        to: [{ email: "reader@example.com" }],
        subject: "Provider contract",
        bodyHtml: "<p>Body</p>",
        bodyText: "Body",
        updatedAt: "2026-07-15T12:00:00.000Z",
      };
      const providerDraftId = await provider.saveDraft(accountId, draft);
      expect(providerDraftId.length).toBeGreaterThan(0);
      await provider.deleteDraft(accountId, providerDraftId);
      expect(
        (await provider.sendDraft(accountId, draft)).length,
      ).toBeGreaterThan(0);
    });
  });
}

providerContract(
  "Gmail fixture",
  asAccountId("gmail:demo"),
  createGmailFixtureProvider,
);
providerContract(
  "Microsoft fixture",
  asAccountId("microsoft:demo"),
  createMicrosoftFixtureProvider,
);
