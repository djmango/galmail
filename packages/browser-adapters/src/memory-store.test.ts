import { describe, expect, it } from "bun:test";
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

  it("rejects tampering and wrong keys", async () => {
    const crypto = new DevVaultCrypto();
    const key = await crypto.generateVaultKey();
    const wrongKey = await crypto.generateVaultKey();
    const sealed = await crypto.seal(new Uint8Array([1, 2, 3]), key);
    const tampered = sealed.slice();
    tampered[tampered.length - 1]! ^= 1;

    await expect(crypto.open(tampered, key)).rejects.toThrow();
    await expect(crypto.open(sealed, wrongKey)).rejects.toThrow();
  });

  it("uses a fresh nonce for each envelope", async () => {
    const crypto = new DevVaultCrypto();
    const key = await crypto.generateVaultKey();
    const first = await crypto.seal(new Uint8Array([1]), key);
    const second = await crypto.seal(new Uint8Array([1]), key);

    expect(first).not.toEqual(second);
  });
});
