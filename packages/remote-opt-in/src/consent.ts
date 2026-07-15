import type { RemoteOptInService } from "@galmail/core-api";
import {
  type AccountId,
  type RemoteProcessingConsent,
} from "@galmail/core-api";

export const REMOTE_OPT_IN_DISCLOSURE_VERSION = "2026-07-15.v1";

export const REMOTE_OPT_IN_COPY = {
  title: "Enable remote processing for this account?",
  summary:
    "GalMail’s default mode is zero-access: our servers never receive your mail or OAuth tokens.",
  consequence:
    "If you enable remote processing for this account, that account is no longer zero-access. GalMail’s isolated processor will temporarily hold provider tokens and may read message content to power richer notifications or optional AI features.",
  retention:
    "You control retention. Zero hours means process-and-discard. Short retention windows may keep derived metadata only as configured — never marketed as subpoena-proof.",
  aiNote:
    "Optional AI uses the same classification contract as on-device rules. Content may leave your device for opted-in accounts only.",
  confirmLabel: "I understand — enable for this account",
  cancelLabel: "Keep zero-access",
} as const;

export class LocalRemoteOptInService implements RemoteOptInService {
  readonly DISCLOSURE_VERSION = REMOTE_OPT_IN_DISCLOSURE_VERSION;
  private consents = new Map<string, RemoteProcessingConsent>();

  async getConsent(accountId: AccountId): Promise<RemoteProcessingConsent> {
    return (
      this.consents.get(accountId) ?? {
        accountId,
        enabled: false,
        allowAi: false,
        retentionHours: 0,
        disclosureVersion: this.DISCLOSURE_VERSION,
      }
    );
  }

  async setConsent(consent: RemoteProcessingConsent): Promise<void> {
    if (consent.enabled && consent.disclosureVersion !== this.DISCLOSURE_VERSION) {
      throw new Error("Consent requires current disclosure version");
    }
    if (consent.enabled && consent.retentionHours < 0) {
      throw new Error("retentionHours must be >= 0");
    }
    this.consents.set(consent.accountId, {
      ...consent,
      consentedAt: consent.enabled
        ? new Date().toISOString()
        : consent.consentedAt,
    });
  }
}
