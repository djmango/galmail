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

const ENVELOPE_HEADER = new Uint8Array([
  0x47, 0x4d, 0x41, 0x45, 0x01, 0x02, 0x0c, 0x00,
]);
const BROWSER_AAD = new TextEncoder().encode("galmail/browser-envelope/v1");
const NONCE_LENGTH = 12;

/** Authenticated browser crypto. Native production uses the matching v1 envelope
 * framing with XChaCha20-Poly1305 (algorithm 1); WebCrypto uses AES-256-GCM
 * (algorithm 2). The Wasm adapter is the cross-platform XChaCha implementation.
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
    return this.seal(vaultKey, devicePublicKey);
  }

  async unwrapKey(
    wrapped: Uint8Array,
    devicePrivateKey: Uint8Array,
  ): Promise<Uint8Array> {
    return this.open(wrapped, devicePrivateKey);
  }

  async seal(plaintext: Uint8Array, vaultKey: Uint8Array): Promise<Uint8Array> {
    const key = await importAesKey(vaultKey, ["encrypt"]);
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: BROWSER_AAD },
      key,
      toArrayBuffer(plaintext),
    );
    return concat(ENVELOPE_HEADER, nonce, new Uint8Array(ciphertext));
  }

  async open(
    ciphertext: Uint8Array,
    vaultKey: Uint8Array,
  ): Promise<Uint8Array> {
    if (
      ciphertext.length < ENVELOPE_HEADER.length + NONCE_LENGTH + 16 ||
      !ENVELOPE_HEADER.every((byte, index) => ciphertext[index] === byte)
    ) {
      throw new Error("unsupported ciphertext envelope");
    }
    const key = await importAesKey(vaultKey, ["decrypt"]);
    const nonce = ciphertext.slice(
      ENVELOPE_HEADER.length,
      ENVELOPE_HEADER.length + NONCE_LENGTH,
    );
    const payload = ciphertext.slice(ENVELOPE_HEADER.length + NONCE_LENGTH);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, additionalData: BROWSER_AAD },
      key,
      payload,
    );
    return new Uint8Array(plaintext);
  }
}

async function importAesKey(
  raw: Uint8Array,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  if (raw.length !== 32) {
    throw new Error("vault keys must be 256 bits");
  }
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(raw),
    "AES-GCM",
    false,
    usages,
  );
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    parts.reduce((length, part) => length + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
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
