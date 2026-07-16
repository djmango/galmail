import type { RemoteOptInService } from "@galmail/core-api";
import {
  type AccountId,
  type RemoteProcessingConsent,
} from "@galmail/core-api";
import { REMOTE_OPT_IN_DISCLOSURE_VERSION } from "./consent.js";

export type HttpRemoteOptInOptions = {
  /** Base URL of homelab API, e.g. https://galmail.example.com */
  baseUrl: string;
  /** Returns a short-lived Bearer token for the account (aud=galmail-homelab). */
  getAccessToken: (accountId: AccountId) => Promise<string>;
  fetchImpl?: typeof fetch;
};

/**
 * Syncs consent with the self-hosted homelab BFF
 * (`PUT/GET /v1/accounts/:accountId/consent`).
 */
export class HttpRemoteOptInService implements RemoteOptInService {
  readonly DISCLOSURE_VERSION = REMOTE_OPT_IN_DISCLOSURE_VERSION;
  private readonly baseUrl: string;
  private readonly getAccessToken: HttpRemoteOptInOptions["getAccessToken"];
  private readonly fetchImpl: typeof fetch;

  constructor(options: HttpRemoteOptInOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.getAccessToken = options.getAccessToken;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getConsent(accountId: AccountId): Promise<RemoteProcessingConsent> {
    const token = await this.getAccessToken(accountId);
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/accounts/${encodeURIComponent(accountId)}/consent`,
      {
        headers: { authorization: `Bearer ${token}` },
      },
    );
    if (!response.ok) {
      throw new Error(`consent get failed: ${response.status}`);
    }
    const body = (await response.json()) as {
      accountId: string;
      enabled: boolean;
      allowAi: boolean;
      retentionHours: number;
      disclosureVersion: string;
      consentedAt?: string | null;
    };
    return {
      accountId,
      enabled: Boolean(body.enabled),
      allowAi: Boolean(body.allowAi),
      retentionHours: Number(body.retentionHours ?? 0),
      disclosureVersion: body.disclosureVersion ?? this.DISCLOSURE_VERSION,
      consentedAt: body.consentedAt ?? undefined,
    };
  }

  async setConsent(consent: RemoteProcessingConsent): Promise<void> {
    if (
      consent.enabled &&
      consent.disclosureVersion !== this.DISCLOSURE_VERSION
    ) {
      throw new Error("Consent requires current disclosure version");
    }
    const token = await this.getAccessToken(consent.accountId);
    const response = await this.fetchImpl(
      `${this.baseUrl}/v1/accounts/${encodeURIComponent(consent.accountId)}/consent`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          enabled: consent.enabled,
          allowAi: consent.allowAi,
          retentionHours: consent.retentionHours,
          disclosureVersion: consent.disclosureVersion,
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`consent set failed: ${response.status}`);
    }
  }
}
