import { asAccountId, MemorySyncEngine } from "@galmail/core-api";
import {
  createGmailFixtureProvider,
  createMicrosoftFixtureProvider,
} from "@galmail/providers";
import { SyncEngineMcpHost, type GalMailMcpHost } from "./host.js";

export async function createFixtureMcpHost(): Promise<GalMailMcpHost> {
  const gmail = createGmailFixtureProvider();
  const microsoft = createMicrosoftFixtureProvider();
  const gmailAccountId = asAccountId("gmail:demo");
  const microsoftAccountId = asAccountId("microsoft:demo");
  const sync = new MemorySyncEngine([
    { accountId: gmailAccountId, provider: gmail },
    { accountId: microsoftAccountId, provider: microsoft },
  ]);
  await sync.pullDeltas(gmailAccountId);
  await sync.pullDeltas(microsoftAccountId);
  return new SyncEngineMcpHost(sync, [
    {
      accountId: String(gmailAccountId),
      email: "demo@galmail.local",
      provider: "gmail",
    },
    {
      accountId: String(microsoftAccountId),
      email: "demo@contoso.local",
      provider: "microsoft",
    },
  ]);
}
