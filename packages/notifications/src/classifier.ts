import type { Classifier, NotificationPolicy } from "@galmail/core-api";
import {
  asMessageId,
  type ClassificationResult,
  type MailMessage,
  type MessageId,
  type ReceiptStatus,
} from "@galmail/core-api";

/** Deterministic rules + user corrections first; remote AI plugs into same contract. */
export class LocalClassifier implements Classifier {
  private corrections = new Map<string, ClassificationResult["priority"]>();

  async classify(message: MailMessage): Promise<ClassificationResult> {
    const corrected = this.corrections.get(message.id);
    if (corrected) {
      return {
        messageId: message.id,
        priority: corrected,
        reasons: ["user_correction"],
        source: "user_correction",
      };
    }

    const from = message.from.email.toLowerCase();
    if (/noreply|newsletter|marketing/.test(from) || /unsubscribe/i.test(message.snippet)) {
      return {
        messageId: message.id,
        priority: "bulk",
        reasons: ["bulk_sender_heuristic"],
        source: "rules",
      };
    }
    if (/security|urgent|payroll|2fa|verification/.test(message.subject.toLowerCase())) {
      return {
        messageId: message.id,
        priority: "urgent",
        reasons: ["subject_keyword"],
        source: "rules",
      };
    }
    return {
      messageId: message.id,
      priority: "normal",
      reasons: ["default"],
      source: "rules",
    };
  }

  async recordCorrection(
    messageId: MessageId,
    correction: ClassificationResult["priority"],
  ): Promise<void> {
    this.corrections.set(messageId, correction);
  }
}

export class BlindAwareNotificationPolicy implements NotificationPolicy {
  constructor(private readonly blindMode = true) {}

  async shouldNotify(
    result: ClassificationResult,
    message: MailMessage,
  ): Promise<{
    notify: boolean;
    blindHintOnly: boolean;
    title?: string;
    body?: string;
  }> {
    if (result.priority === "bulk") {
      return { notify: false, blindHintOnly: true };
    }
    if (this.blindMode) {
      return {
        notify: true,
        blindHintOnly: true,
        title: "New mail",
        body: "Open GalMail to read (blind mode — no preview).",
      };
    }
    return {
      notify: true,
      blindHintOnly: false,
      title: message.from.name ?? message.from.email,
      body: message.subject,
    };
  }
}

export class LocalReceiptService {
  private statuses = new Map<string, ReceiptStatus>();

  async requestReceipt(
    messageId: MessageId,
    _mode: "standard" | "pixel",
  ): Promise<void> {
    // Token→message mapping would be encrypted server-side; no IP/UA stored.
    this.statuses.set(messageId, "none");
  }

  async status(messageId: MessageId): Promise<ReceiptStatus> {
    return this.statuses.get(messageId) ?? "none";
  }

  /** Simulate receipt callback with privacy-safe labels only. */
  mark(messageId: string, status: Exclude<ReceiptStatus, "none">): void {
    this.statuses.set(asMessageId(messageId), status);
  }
}

export const ACTIONABLE_NOTIFICATION_ACTIONS = [
  "archive",
  "mark_read",
  "delete",
  "reply",
] as const;
