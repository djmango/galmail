import type { MailProvider } from "@galmail/core-api";
import {
  asAccountId,
  type AccountId,
  type MailThread,
} from "@galmail/core-api";

export interface UnifiedAccount {
  accountId: AccountId;
  provider: MailProvider;
  email: string;
  displayName: string;
}

/** Merge threads across providers while preserving provider-native semantics. */
export async function listUnifiedInbox(
  accounts: UnifiedAccount[],
  limit = 100,
): Promise<MailThread[]> {
  const batches = await Promise.all(
    accounts.map(async (a) => {
      const { threads } = await a.provider.listThreads(a.accountId, { limit });
      return threads;
    }),
  );
  return batches
    .flat()
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
    .slice(0, limit);
}

export function demoAccounts(
  gmail: MailProvider,
  microsoft: MailProvider,
): UnifiedAccount[] {
  return [
    {
      accountId: asAccountId("gmail:demo"),
      provider: gmail,
      email: "demo@galmail.local",
      displayName: "Gmail Demo",
    },
    {
      accountId: asAccountId("microsoft:demo"),
      provider: microsoft,
      email: "demo@contoso.local",
      displayName: "Microsoft Demo",
    },
  ];
}
