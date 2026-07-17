import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  addLiveAccount,
  persistDemoMailboxPreference,
  persistInboxAccountFilter,
  readInboxAccountFilter,
  readStoredAccountIds,
  reconcileAccountIdsFromKeychain,
  removeLiveAccount,
  resolveDefaultComposeAccountId,
  persistLastComposeAccountId,
  shouldPromptSignIn,
} from "./account-session";

const KEYS = [
  "galmail.providerMode",
  "galmail.accountIds",
  "galmail.gmailAccountId",
  "galmail.microsoftAccountId",
  "galmail.inboxAccountFilter",
  "galmail.lastComposeAccountId",
];

function installMemoryLocalStorage() {
  const map = new Map<string, string>();
  const storage = {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    removeItem(key: string) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
  });
}

beforeEach(() => {
  installMemoryLocalStorage();
});

afterEach(() => {
  for (const key of KEYS) localStorage.removeItem(key);
});

describe("account-session multi-account", () => {
  test("migrates legacy scalar keys into accountIds", () => {
    localStorage.setItem("galmail.gmailAccountId", "gmail:one@example.com");
    localStorage.setItem(
      "galmail.microsoftAccountId",
      "microsoft:two@example.com",
    );
    expect(readStoredAccountIds()).toEqual([
      "gmail:one@example.com",
      "microsoft:two@example.com",
    ]);
    expect(JSON.parse(localStorage.getItem("galmail.accountIds")!)).toEqual([
      "gmail:one@example.com",
      "microsoft:two@example.com",
    ]);
  });

  test("addLiveAccount appends and dedupes", () => {
    addLiveAccount("gmail:a@example.com");
    addLiveAccount("gmail:b@example.com");
    addLiveAccount("gmail:a@example.com");
    addLiveAccount("microsoft:c@example.com");
    expect(readStoredAccountIds()).toEqual([
      "gmail:a@example.com",
      "gmail:b@example.com",
      "microsoft:c@example.com",
    ]);
    expect(localStorage.getItem("galmail.providerMode")).toBe("live");
  });

  test("removeLiveAccount clears filter and provider mode when empty", () => {
    addLiveAccount("gmail:a@example.com");
    persistInboxAccountFilter("gmail:a@example.com");
    removeLiveAccount("gmail:a@example.com");
    expect(readStoredAccountIds()).toEqual([]);
    expect(readInboxAccountFilter()).toBe("all");
    expect(localStorage.getItem("galmail.providerMode")).toBeNull();
  });

  test("inbox filter persistence", () => {
    persistInboxAccountFilter("gmail:x@example.com");
    expect(readInboxAccountFilter()).toBe("gmail:x@example.com");
    persistInboxAccountFilter("all");
    expect(readInboxAccountFilter()).toBe("all");
  });

  test("compose default prefers filter then last-used then first", () => {
    const ids = ["gmail:a@example.com", "gmail:b@example.com"];
    persistLastComposeAccountId("gmail:b@example.com");
    expect(resolveDefaultComposeAccountId(ids, "all")).toBe(
      "gmail:b@example.com",
    );
    expect(
      resolveDefaultComposeAccountId(ids, "gmail:a@example.com"),
    ).toBe("gmail:a@example.com");
  });

  test("keychain reconcile unions orphans into session", () => {
    addLiveAccount("gmail:known@example.com");
    const merged = reconcileAccountIdsFromKeychain([
      "gmail:known@example.com",
      "microsoft:orphan@example.com",
    ]);
    expect(merged).toEqual([
      "gmail:known@example.com",
      "microsoft:orphan@example.com",
    ]);
  });

  test("shouldPromptSignIn defaults to true without accounts", () => {
    expect(shouldPromptSignIn()).toBe(true);
  });

  test("shouldPromptSignIn skips after explicit demo preference", () => {
    persistDemoMailboxPreference();
    expect(shouldPromptSignIn()).toBe(false);
  });

  test("shouldPromptSignIn skips when a live account exists", () => {
    addLiveAccount("gmail:a@example.com");
    expect(shouldPromptSignIn()).toBe(false);
  });
});
