const DEFAULT_TENANT = "common";
/**
 * Delegated Graph scopes for the public desktop client.
 * Azure (Entra) app: Mobile and desktop + loopback redirect `http://127.0.0.1`
 * (native binds an ephemeral port and path `/oauth/microsoft/callback`).
 */
const GRAPH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://graph.microsoft.com/Mail.ReadWrite",
  "https://graph.microsoft.com/Mail.Send",
  "https://graph.microsoft.com/Calendars.ReadWrite",
];

export interface MicrosoftPkceAttempt {
  authorizationUrl: string;
  verifier: string;
  state: string;
  redirectUri: string;
  tenant: string;
}

export interface MicrosoftTokenResponse {
  token_type: string;
  scope: string;
  expires_in: number;
  access_token: string;
  refresh_token?: string;
  id_token?: string;
}

function base64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (value) => String.fromCharCode(value)).join(
    "",
  );
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function validTenant(value: string): boolean {
  return (
    ["common", "organizations", "consumers"].includes(value) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

/** Build a public-client authorization request. No client secret is accepted. */
export async function beginMicrosoftPkce(input: {
  clientId: string;
  redirectUri: string;
  tenant?: string;
  prompt?: "select_account" | "consent" | "login";
}): Promise<MicrosoftPkceAttempt> {
  const clientId = input.clientId.trim();
  const tenant = input.tenant?.trim() || DEFAULT_TENANT;
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
    throw new Error("a Microsoft application (client) ID is required");
  }
  if (!validTenant(tenant)) throw new Error("invalid Microsoft tenant");
  const redirect = new URL(input.redirectUri);
  if (
    redirect.protocol !== "https:" &&
    !(
      redirect.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(redirect.hostname)
    )
  ) {
    throw new Error("Microsoft redirect must be HTTPS or a loopback address");
  }
  const verifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const stateBytes = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64Url(verifierBytes);
  const state = base64Url(stateBytes);
  const challenge = base64Url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const url = new URL(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`,
  );
  url.search = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirect.toString(),
    response_mode: "query",
    scope: GRAPH_SCOPES.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: input.prompt ?? "select_account",
  }).toString();
  return {
    authorizationUrl: url.toString(),
    verifier,
    state,
    redirectUri: redirect.toString(),
    tenant,
  };
}

/** Exchange a code as a public client. Call this from the native token boundary. */
export async function exchangeMicrosoftCode(input: {
  clientId: string;
  code: string;
  attempt: Pick<MicrosoftPkceAttempt, "verifier" | "redirectUri" | "tenant">;
  fetch?: typeof fetch;
}): Promise<MicrosoftTokenResponse> {
  const request = input.fetch ?? fetch;
  const response = await request(
    `https://login.microsoftonline.com/${input.attempt.tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.clientId,
        grant_type: "authorization_code",
        code: input.code,
        redirect_uri: input.attempt.redirectUri,
        code_verifier: input.attempt.verifier,
        scope: GRAPH_SCOPES.join(" "),
      }),
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | MicrosoftTokenResponse
    | { error?: string; error_description?: string }
    | null;
  if (!response.ok || !payload || !("access_token" in payload)) {
    const code =
      payload && "error" in payload ? payload.error : "token_exchange_failed";
    throw new Error(`Microsoft public-client token exchange failed (${code})`);
  }
  return payload;
}

export function microsoftAdminConsentUrl(input: {
  clientId: string;
  redirectUri: string;
  tenant: string;
  state: string;
}): string {
  if (!validTenant(input.tenant) || input.tenant === "consumers") {
    throw new Error("admin consent requires an organizational tenant");
  }
  const url = new URL(
    `https://login.microsoftonline.com/${input.tenant}/v2.0/adminconsent`,
  );
  url.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: GRAPH_SCOPES.join(" "),
    state: input.state,
  }).toString();
  return url.toString();
}

export const MICROSOFT_GRAPH_SCOPES = [...GRAPH_SCOPES];
