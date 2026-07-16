export type HomelabConfig = {
  port: number;
  databaseUrl: string;
  accountAuthSecret: string;
  apiAdminToken: string;
  apnsTeamId: string;
  apnsKeyId: string;
  apnsPrivateKey: string;
  apnsTopic: string;
  apnsSandboxDefault: boolean;
  fcmEnabled: boolean;
  openaiApiBase: string;
  openaiApiKey: string;
  openaiModel: string;
  consentDisclosureVersion: string;
  processingRegion: string;
  retentionMaxHours: number;
};

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") {
    throw new Error(`Missing required env: ${name}`);
  }
  return value;
}

export function loadConfig(): HomelabConfig {
  return {
    port: Number(process.env.PORT ?? "8789"),
    databaseUrl: required(
      "DATABASE_URL",
      "postgres://galmail:galmail@127.0.0.1:5432/galmail",
    ),
    accountAuthSecret: required(
      "ACCOUNT_AUTH_SECRET",
      "replace-with-local-random-secret",
    ),
    apiAdminToken: required(
      "API_ADMIN_TOKEN",
      "replace-with-local-admin-token",
    ),
    apnsTeamId: process.env.APNS_TEAM_ID ?? "",
    apnsKeyId: process.env.APNS_KEY_ID ?? "",
    apnsPrivateKey: (process.env.APNS_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    apnsTopic: process.env.APNS_TOPIC ?? "com.galateacorp.mail",
    apnsSandboxDefault: (process.env.APNS_SANDBOX ?? "true") === "true",
    fcmEnabled: (process.env.FCM_ENABLED ?? "false") === "true",
    openaiApiBase: (
      process.env.OPENAI_API_BASE ?? "http://127.0.0.1:11434/v1"
    ).replace(/\/$/, ""),
    openaiApiKey: process.env.OPENAI_API_KEY ?? "",
    openaiModel: process.env.OPENAI_MODEL ?? "llama3.2",
    consentDisclosureVersion:
      process.env.CONSENT_DISCLOSURE_VERSION ?? "2026-07-15.v1",
    processingRegion: process.env.PROCESSING_REGION ?? "homelab",
    retentionMaxHours: Number(process.env.RETENTION_MAX_HOURS ?? "168"),
  };
}

export function apnsConfigured(config: HomelabConfig): boolean {
  return Boolean(
    config.apnsTeamId && config.apnsKeyId && config.apnsPrivateKey,
  );
}
