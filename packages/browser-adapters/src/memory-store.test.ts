import { describe, expect, it } from "vitest";
import { DevVaultCrypto, MemoryEncryptedStore } from "./memory-store.js";

describe("DevVaultCrypto + MemoryEncryptedStore", () => {
  it("round-trips sealed payloads", async () => {
    const crypto = new DevVaultCrypto();
    const store = new MemoryEncryptedStore();
    const key = await crypto.generateVaultKey();
    const plain = new TextEncoder().encode("galmail-secret");
    const sealed = await crypto.seal(plain, key);
    await store.put("vault/demo", sealed);
    const loaded = await store.get("vault/demo");
    expect(loaded).not.toBeNull();
    const opened = await crypto.open(loaded!, key);
    expect(new TextDecoder().decode(opened)).toBe("galmail-secret");
  });
});
