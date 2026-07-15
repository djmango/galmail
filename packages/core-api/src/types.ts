/** Shared domain types for GalMail capability APIs. */

export type ProviderKind = "gmail" | "microsoft";

export type AccountId = string & { readonly __brand: "AccountId" };
export type ThreadId = string & { readonly __brand: "ThreadId" };
export type MessageId = string & { readonly __brand: "MessageId" };
export type LabelId = string & { readonly __brand: "LabelId" };

export function asAccountId(id: string): AccountId {
  return id as AccountId;
}
export function asThreadId(id: string): ThreadId {
  return id as ThreadId;
}
export function asMessageId(id: string): MessageId {
  return id as MessageId;
}
export function asLabelId(id: string): LabelId {
  return id as LabelId;
}

export interface MailAddress {
  name?: string;
  email: string;
}

export interface MailLabel {
  id: LabelId;
  name: string;
  /** Provider-native kind: Gmail label vs Outlook folder/category */
  kind: "label" | "folder" | "category" | "system";
  providerNativeId: string;
}

export interface MailMessage {
  id: MessageId;
  threadId: ThreadId;
  accountId: AccountId;
  provider: ProviderKind;
  subject: string;
  snippet: string;
  from: MailAddress;
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  date: string;
  unread: boolean;
  starred: boolean;
  labelIds: LabelId[];
  hasAttachments: boolean;
  /** Body may be lazily hydrated */
  bodyHtml?: string;
  bodyText?: string;
}

export interface MailThread {
  id: ThreadId;
  accountId: AccountId;
  provider: ProviderKind;
  subject: string;
  snippet: string;
  participants: MailAddress[];
  messageIds: MessageId[];
  labelIds: LabelId[];
  unreadCount: number;
  lastMessageAt: string;
}

export interface SyncCursor {
  accountId: AccountId;
  provider: ProviderKind;
  /** Opaque provider cursor (Gmail historyId / Graph deltaLink) */
  token: string;
  updatedAt: string;
}

export type MutationKind =
  | "archive"
  | "trash"
  | "mark_read"
  | "mark_unread"
  | "star"
  | "unstar"
  | "apply_label"
  | "remove_label"
  | "snooze"
  | "send"
  | "save_draft"
  | "move_folder";

export interface OutboxMutation {
  id: string;
  accountId: AccountId;
  kind: MutationKind;
  targetIds: string[];
  payload?: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  status: "pending" | "inflight" | "failed" | "done";
  lastError?: string;
}

export interface ComposeDraft {
  id: string;
  accountId: AccountId;
  to: MailAddress[];
  cc?: MailAddress[];
  bcc?: MailAddress[];
  subject: string;
  bodyHtml: string;
  bodyText: string;
  inReplyTo?: MessageId;
  updatedAt: string;
}

export type ReceiptStatus = "receipt_received" | "likely_opened" | "none";

export interface ClassificationResult {
  messageId: MessageId;
  priority: "urgent" | "normal" | "low" | "bulk";
  reasons: string[];
  source: "rules" | "on_device_model" | "remote_ai" | "user_correction";
}

export interface RemoteProcessingConsent {
  accountId: AccountId;
  enabled: boolean;
  allowAi: boolean;
  retentionHours: number;
  consentedAt?: string;
  disclosureVersion: string;
}
