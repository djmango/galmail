const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

export function fromBase64Url(value: string): ArrayBuffer {
  const padded = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

function pemToBytes(pem: string): ArrayBuffer {
  return fromBase64Url(pem.replace(/-----[^-]+-----/g, "").replace(/\s/g, ""));
}

export async function createEs256Jwt(
  privateKeyPem: string,
  header: Record<string, string>,
  claims: Record<string, string | number>,
): Promise<string> {
  const encodedHeader = toBase64Url(encoder.encode(JSON.stringify(header)));
  const encodedClaims = toBase64Url(encoder.encode(JSON.stringify(claims)));
  const unsigned = `${encodedHeader}.${encodedClaims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    encoder.encode(unsigned),
  );
  return `${unsigned}.${toBase64Url(signature)}`;
}

async function importHmac(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function signAccountToken(
  secret: string,
  accountId: string,
  expiresAtSeconds = Math.floor(Date.now() / 1000) + 3600,
): Promise<string> {
  const header = toBase64Url(
    encoder.encode(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  );
  const payload = toBase64Url(
    encoder.encode(
      JSON.stringify({
        sub: accountId,
        aud: "galmail-homelab",
        exp: expiresAtSeconds,
        jti: crypto.randomUUID(),
      }),
    ),
  );
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "HMAC",
    await importHmac(secret),
    encoder.encode(unsigned),
  );
  return `${unsigned}.${toBase64Url(signature)}`;
}

export async function verifyAccountToken(
  token: string,
  secret: string,
): Promise<string> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("invalid token");
  const [header, payload, signature] = parts;
  const valid = await crypto.subtle.verify(
    "HMAC",
    await importHmac(secret),
    fromBase64Url(signature),
    encoder.encode(`${header}.${payload}`),
  );
  if (!valid) throw new Error("invalid token");
  let claims: { sub?: string; aud?: string; exp?: number };
  try {
    claims = JSON.parse(decoder.decode(fromBase64Url(payload))) as typeof claims;
  } catch {
    throw new Error("invalid token");
  }
  if (
    !claims.sub ||
    claims.aud !== "galmail-homelab" ||
    !claims.exp ||
    claims.exp <= Math.floor(Date.now() / 1000)
  ) {
    throw new Error("expired or invalid token");
  }
  return claims.sub;
}
