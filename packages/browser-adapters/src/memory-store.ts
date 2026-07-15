import type { EncryptedStore, VaultCrypto } from "@galmail/core-api";

/** In-memory encrypted store for tests and SSR-safe fallbacks. */
export class MemoryEncryptedStore implements EncryptedStore {
  private map = new Map<string, Uint8Array>();

  async get(key: string): Promise<Uint8Array | null> {
    return this.map.get(key) ?? null;
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async listKeys(prefix?: string): Promise<string[]> {
    return [...this.map.keys()].filter((k) =>
      prefix ? k.startsWith(prefix) : true,
    );
  }
}

/**
 * Dev/test vault crypto using XOR + random — NOT for production.
 * Production browser path must use WebCrypto AES-GCM + non-exportable keys.
 */
export class DevVaultCrypto implements VaultCrypto {
  async generateVaultKey(): Promise<Uint8Array> {
    const key = new Uint8Array(32);
    crypto.getRandomValues(key);
    return key;
  }

  async wrapKey(
    vaultKey: Uint8Array,
    devicePublicKey: Uint8Array,
  ): Promise<Uint8Array> {
    const out = new Uint8Array(vaultKey.length);
    for (let i = 0; i < vaultKey.length; i++) {
      out[i] = vaultKey[i]! ^ devicePublicKey[i % devicePublicKey.length]!;
    }
    return out;
  }

  async unwrapKey(
    wrapped: Uint8Array,
    devicePrivateKey: Uint8Array,
  ): Promise<Uint8Array> {
    return this.wrapKey(wrapped, devicePrivateKey);
  }

  async seal(plaintext: Uint8Array, vaultKey: Uint8Array): Promise<Uint8Array> {
    const out = new Uint8Array(plaintext.length + 4);
    out[0] = 0x47; // G
    out[1] = 0x4d; // M
    out[2] = 0x01; // version
    out[3] = 0x00;
    for (let i = 0; i < plaintext.length; i++) {
      out[i + 4] = plaintext[i]! ^ vaultKey[i % vaultKey.length]!;
    }
    return out;
  }

  async open(ciphertext: Uint8Array, vaultKey: Uint8Array): Promise<Uint8Array> {
    if (ciphertext[0] !== 0x47 || ciphertext[1] !== 0x4d) {
      throw new Error("invalid ciphertext header");
    }
    const out = new Uint8Array(ciphertext.length - 4);
    for (let i = 0; i < out.length; i++) {
      out[i] = ciphertext[i + 4]! ^ vaultKey[i % vaultKey.length]!;
    }
    return out;
  }
}

/** Browser adapter surface — IndexedDB/OPFS wiring is progressive enhancement. */
export interface BrowserCapabilityAdapters {
  store: EncryptedStore;
  crypto: VaultCrypto;
  /** true when OPFS available */
  opfsAvailable: boolean;
  /** true when WebCrypto subtle available */
  webCryptoAvailable: boolean;
}

export function createBrowserAdapters(): BrowserCapabilityAdapters {
  const webCryptoAvailable =
    typeof globalThis.crypto !== "undefined" &&
    typeof globalThis.crypto.subtle !== "undefined";
  const opfsAvailable =
    typeof navigator !== "undefined" &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === "function";

  return {
    store: new MemoryEncryptedStore(),
    crypto: new DevVaultCrypto(),
    opfsAvailable,
    webCryptoAvailable,
  };
}
