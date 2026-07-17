import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { DraftAttachment } from "@galmail/core-api";
import type { EditorMode } from "./StatusBar";
import { ActionButton } from "./ActionButton";
import { Icons } from "./Icons";

export interface ComposeDraft {
  id?: string;
  /** Sending account; required when multiple accounts are connected. */
  accountId?: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  alias?: string;
  signature?: string;
  attachments?: DraftAttachment[];
  requestReadReceipt?: boolean;
  inReplyTo?: string;
  references?: string[];
}

export type ComposeAccountOption = {
  accountId: string;
  email: string;
  provider: string;
};

type ComposeFieldId =
  | "to"
  | "cc"
  | "bcc"
  | "alias"
  | "subject"
  | "body"
  | "signature";

async function filesToAttachments(files: File[]): Promise<DraftAttachment[]> {
  return Promise.all(
    files.map(
      (file) =>
        new Promise<DraftAttachment>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error);
          reader.onload = () =>
            resolve({
              id: crypto.randomUUID(),
              filename: file.name,
              mimeType: file.type || "application/octet-stream",
              size: file.size,
              data: String(reader.result).split(",")[1] ?? "",
            });
          reader.readAsDataURL(file);
        }),
    ),
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export type ComposeSendOptions = {
  /** ISO timestamp; when set, message is held in outbox until then. */
  sendAt?: string;
};

function formatScheduleLabel(date: Date): string {
  return date.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function scheduleQuickPicks(now = new Date()): Array<{
  id: string;
  label: string;
  at: Date;
}> {
  const picks: Array<{ id: string; label: string; at: Date }> = [];
  const inOneHour = new Date(now.getTime() + 60 * 60 * 1000);
  picks.push({ id: "1h", label: "In 1 hour", at: inOneHour });

  if (now.getHours() < 21) {
    const laterToday = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    if (laterToday.getDate() === now.getDate()) {
      picks.push({ id: "later-today", label: "Later today", at: laterToday });
    }
  }

  const tomorrowMorning = new Date(now);
  tomorrowMorning.setDate(tomorrowMorning.getDate() + 1);
  tomorrowMorning.setHours(9, 0, 0, 0);
  picks.push({
    id: "tomorrow-morning",
    label: "Tomorrow morning",
    at: tomorrowMorning,
  });

  const tomorrowAfternoon = new Date(now);
  tomorrowAfternoon.setDate(tomorrowAfternoon.getDate() + 1);
  tomorrowAfternoon.setHours(14, 0, 0, 0);
  picks.push({
    id: "tomorrow-afternoon",
    label: "Tomorrow afternoon",
    at: tomorrowAfternoon,
  });

  return picks;
}

export function ComposeModal(props: {
  mode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  initialDraft?: ComposeDraft;
  /** Connected accounts for the From picker. */
  accounts?: ComposeAccountOption[];
  /** Default From account when opening compose. */
  defaultAccountId?: string;
  /** From settings; OFF by default. Passed through on send. */
  requestReadReceipt?: boolean;
  onClose: () => void;
  onMinimize?: (draft: ComposeDraft) => void;
  onSaveDraft?: (draft: ComposeDraft) => Promise<void>;
  onSend: (draft: ComposeDraft, options?: ComposeSendOptions) => Promise<void>;
}) {
  const accountOptions = props.accounts ?? [];
  const initialAccountId =
    props.initialDraft?.accountId ??
    props.defaultAccountId ??
    accountOptions[0]?.accountId ??
    "";
  const [accountId, setAccountId] = useState(initialAccountId);
  const [to, setTo] = useState(props.initialDraft?.to ?? "");
  const [subject, setSubject] = useState(props.initialDraft?.subject ?? "");
  const [body, setBody] = useState(props.initialDraft?.body ?? "");
  const [cc, setCc] = useState(props.initialDraft?.cc ?? "");
  const [bcc, setBcc] = useState(props.initialDraft?.bcc ?? "");
  const [alias, setAlias] = useState(props.initialDraft?.alias ?? "");
  const [signature, setSignature] = useState(
    props.initialDraft?.signature ?? "",
  );
  const [attachments, setAttachments] = useState<DraftAttachment[]>(
    props.initialDraft?.attachments ?? [],
  );
  const [busy, setBusy] = useState(false);
  const [draftStatus, setDraftStatus] = useState("Draft local");
  const [dragging, setDragging] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<Date | null>(null);
  const [customAt, setCustomAt] = useState("");
  const [showCcBcc, setShowCcBcc] = useState(
    Boolean(props.initialDraft?.cc || props.initialDraft?.bcc),
  );
  const [activeField, setActiveField] = useState<ComposeFieldId>("to");
  const initialized = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const scheduleRef = useRef<HTMLDivElement>(null);
  const toInputRef = useRef<HTMLInputElement>(null);
  const ccInputRef = useRef<HTMLInputElement>(null);
  const bccInputRef = useRef<HTMLInputElement>(null);
  const aliasInputRef = useRef<HTMLInputElement>(null);
  const subjectInputRef = useRef<HTMLInputElement>(null);
  const bodyInputRef = useRef<HTMLTextAreaElement>(null);
  const signatureInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const draftId = useRef(
    props.initialDraft?.id ?? `draft_${crypto.randomUUID()}`,
  );
  const requestReadReceipt = props.requestReadReceipt ?? false;
  const modeRef = useRef(props.mode);
  modeRef.current = props.mode;

  const fieldIds = useMemo((): ComposeFieldId[] => {
    const ids: ComposeFieldId[] = ["to"];
    if (showCcBcc) ids.push("cc", "bcc");
    ids.push("alias", "subject", "body", "signature");
    return ids;
  }, [showCcBcc]);

  const fieldRefs: Record<
    ComposeFieldId,
    RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  > = {
    to: toInputRef,
    cc: ccInputRef,
    bcc: bccInputRef,
    alias: aliasInputRef,
    subject: subjectInputRef,
    body: bodyInputRef,
    signature: signatureInputRef,
  };

  const onModeChangeRef = useRef(props.onModeChange);
  onModeChangeRef.current = props.onModeChange;

  const focusField = (id: ComposeFieldId) => {
    setActiveField(id);
    onModeChangeRef.current("insert");
    requestAnimationFrame(() => fieldRefs[id].current?.focus());
  };

  useEffect(() => {
    setActiveField("to");
    onModeChangeRef.current("insert");
    requestAnimationFrame(() => toInputRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!scheduleOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!scheduleRef.current?.contains(event.target as Node)) {
        setScheduleOpen(false);
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setScheduleOpen(false);
      }
    };
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [scheduleOpen]);

  useEffect(() => {
    if (!fieldIds.includes(activeField)) {
      setActiveField(fieldIds[0] ?? "to");
    }
  }, [fieldIds, activeField]);

  const quickPicks = useMemo(() => scheduleQuickPicks(), []);

  useEffect(() => {
    if (props.initialDraft) {
      if (props.initialDraft.accountId) {
        setAccountId(props.initialDraft.accountId);
      }
      setTo(props.initialDraft.to);
      setSubject(props.initialDraft.subject);
      setBody(props.initialDraft.body);
      setCc(props.initialDraft.cc ?? "");
      setBcc(props.initialDraft.bcc ?? "");
      setAlias(props.initialDraft.alias ?? "");
      setSignature(props.initialDraft.signature ?? "");
      setAttachments(props.initialDraft.attachments ?? []);
      if (props.initialDraft.cc || props.initialDraft.bcc) {
        setShowCcBcc(true);
      }
    }
  }, [props.initialDraft]);

  useEffect(() => {
    if (!accountId && props.defaultAccountId) {
      setAccountId(props.defaultAccountId);
    }
  }, [accountId, props.defaultAccountId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘⏎ / Ctrl+Enter sends while compose is mounted (including focused fields).
      if (
        e.key === "Enter" &&
        (e.metaKey || e.ctrlKey) &&
        !e.altKey &&
        !e.shiftKey
      ) {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) formRef.current?.requestSubmit();
        return;
      }

      if (modeRef.current !== "normal") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const idx = fieldIds.indexOf(activeField);
      const at = idx < 0 ? 0 : idx;

      if (e.key === "j") {
        e.preventDefault();
        e.stopPropagation();
        const next = fieldIds[Math.min(fieldIds.length - 1, at + 1)] ?? "to";
        setActiveField(next);
        return;
      }
      if (e.key === "k") {
        e.preventDefault();
        e.stopPropagation();
        const prev = fieldIds[Math.max(0, at - 1)] ?? "to";
        setActiveField(prev);
        return;
      }
      if (e.key === "i" || e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        focusField(fieldIds[at] ?? "to");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeField, fieldIds, busy]);

  const selectedAccount =
    accountOptions.find((account) => account.accountId === accountId) ??
    accountOptions[0];
  const current: ComposeDraft = {
    id: draftId.current,
    accountId: accountId || selectedAccount?.accountId,
    to,
    cc,
    bcc,
    subject,
    body,
    alias,
    signature,
    attachments,
    requestReadReceipt,
    inReplyTo: props.initialDraft?.inReplyTo,
    references: props.initialDraft?.references,
  };

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      return;
    }
    if (!props.onSaveDraft || (!to && !subject && !body)) return;
    setDraftStatus("Saving draft…");
    const timer = setTimeout(() => {
      void props
        .onSaveDraft?.(current)
        .then(() => setDraftStatus("Draft saved"))
        .catch((error: unknown) => {
          const message =
            error instanceof Error && error.message
              ? error.message
              : "Draft save failed";
          setDraftStatus(message);
        });
    }, 750);
    return () => clearTimeout(timer);
  }, [
    accountId,
    to,
    cc,
    bcc,
    subject,
    body,
    alias,
    signature,
    attachments,
    requestReadReceipt,
  ]);

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    const next = await filesToAttachments(files);
    setAttachments((value) => [...value, ...next]);
  };

  const fieldActive = (id: ComposeFieldId) =>
    props.mode === "normal" && activeField === id;

  const onFieldFocus = (id: ComposeFieldId) => {
    setActiveField(id);
    onModeChangeRef.current("insert");
  };

  return (
    <div className="compose" role="dialog" aria-label="Compose" aria-modal="true">
      <form
        ref={formRef}
        className={`compose-card${dragging ? " compose-card-dragging" : ""}`}
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await props.onSend(
              current,
              scheduledAt
                ? { sendAt: scheduledAt.toISOString() }
                : undefined,
            );
          } finally {
            setBusy(false);
          }
        }}
        onDragEnter={(event) => {
          if (![...event.dataTransfer.types].includes("Files")) return;
          event.preventDefault();
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (![...event.dataTransfer.types].includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={(event) => {
          if (![...event.dataTransfer.types].includes("Files")) return;
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(event) => {
          if (![...event.dataTransfer.types].includes("Files")) return;
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          void addFiles([...event.dataTransfer.files]);
        }}
      >
        <div className="compose-drop-veil" aria-hidden={!dragging}>
          Drop files to attach
        </div>

        <div className="compose-head">
          <strong className="compose-title">New message</strong>
          <div className="compose-head-actions">
            {props.onMinimize && (
              <ActionButton
                label="Minimize to drafts"
                tooltip="Keep this draft in a floating window while you browse mail"
                icon={<Icons.minimize />}
                iconOnly
                showShortcut={false}
                onClick={() => props.onMinimize?.(current)}
              />
            )}
            <ActionButton
              label="Close"
              icon={<Icons.close />}
              iconOnly
              command="back"
              onClick={props.onClose}
            />
          </div>
        </div>

        <div className="compose-fields">
          <label
            className={`compose-field${fieldActive("to") ? " compose-field-active" : ""}`}
            data-compose-field="to"
          >
            <span className="compose-field-label">To</span>
            <input
              ref={toInputRef}
              className="field-input"
              required
              placeholder="To"
              aria-label="To"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              onFocus={() => onFieldFocus("to")}
            />
            {!showCcBcc && (
              <button
                type="button"
                className="compose-cc-toggle"
                onClick={() => setShowCcBcc(true)}
              >
                Cc/Bcc
              </button>
            )}
          </label>

          {showCcBcc && (
            <>
              <label
                className={`compose-field${fieldActive("cc") ? " compose-field-active" : ""}`}
                data-compose-field="cc"
              >
                <span className="compose-field-label">Cc</span>
                <input
                  ref={ccInputRef}
                  className="field-input"
                  placeholder="Carbon copy"
                  aria-label="Cc"
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  onFocus={() => onFieldFocus("cc")}
                />
              </label>
              <label
                className={`compose-field${fieldActive("bcc") ? " compose-field-active" : ""}`}
                data-compose-field="bcc"
              >
                <span className="compose-field-label">Bcc</span>
                <input
                  ref={bccInputRef}
                  className="field-input"
                  placeholder="Blind carbon copy"
                  aria-label="Bcc"
                  value={bcc}
                  onChange={(e) => setBcc(e.target.value)}
                  onFocus={() => onFieldFocus("bcc")}
                />
              </label>
            </>
          )}

          <label
            className={`compose-field${fieldActive("alias") ? " compose-field-active" : ""}`}
            data-compose-field="alias"
          >
            <span className="compose-field-label">From</span>
            {accountOptions.length > 0 ? (
              <select
                className="field-input"
                aria-label="From account"
                value={accountId || selectedAccount?.accountId || ""}
                onChange={(e) => setAccountId(e.target.value)}
                onFocus={() => onFieldFocus("alias")}
              >
                {accountOptions.map((account) => (
                  <option key={account.accountId} value={account.accountId}>
                    {account.email}
                    {account.provider === "gmail"
                      ? " · Gmail"
                      : account.provider === "microsoft"
                        ? " · Microsoft"
                        : ""}
                  </option>
                ))}
              </select>
            ) : (
              <input
                ref={aliasInputRef}
                className="field-input"
                placeholder="Alias (optional)"
                aria-label="Send as alias"
                type="email"
                value={alias}
                onChange={(e) => setAlias(e.target.value)}
                onFocus={() => onFieldFocus("alias")}
              />
            )}
          </label>

          <label
            className={`compose-field${fieldActive("subject") ? " compose-field-active" : ""}`}
            data-compose-field="subject"
          >
            <span className="compose-field-label">Subject</span>
            <input
              ref={subjectInputRef}
              className="field-input"
              required
              placeholder="Subject"
              aria-label="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              onFocus={() => onFieldFocus("subject")}
            />
          </label>
        </div>

        <textarea
          ref={bodyInputRef}
          className={`field-textarea compose-body${fieldActive("body") ? " compose-field-active" : ""}`}
          data-compose-field="body"
          required
          placeholder="Message"
          aria-label="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onFocus={() => onFieldFocus("body")}
        />

        <label
          className={`compose-signature-field${fieldActive("signature") ? " compose-field-active" : ""}`}
          data-compose-field="signature"
        >
          <span className="compose-field-label">Signature</span>
          <textarea
            ref={signatureInputRef}
            className="field-textarea compose-signature"
            placeholder="Optional"
            aria-label="Signature"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            onFocus={() => onFieldFocus("signature")}
          />
        </label>

        {attachments.length > 0 && (
          <ul className="compose-attachments" aria-label="Attachments">
            {attachments.map((attachment) => (
              <li key={attachment.id}>
                <span className="compose-attachment-name">
                  {attachment.filename}
                  <span className="compose-attachment-size">
                    {formatBytes(attachment.size)}
                  </span>
                </span>
                <button
                  type="button"
                  className="compose-attachment-remove"
                  aria-label={`Remove ${attachment.filename}`}
                  onClick={() =>
                    setAttachments((items) =>
                      items.filter((item) => item.id !== attachment.id),
                    )
                  }
                >
                  <Icons.close />
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="compose-toolbar">
          <div className="compose-toolbar-start">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={async (event) => {
                await addFiles([...(event.target.files ?? [])]);
                event.target.value = "";
              }}
            />
            <ActionButton
              label="Attach files"
              icon={<Icons.paperclip />}
              iconOnly
              showShortcut={false}
              onClick={() => fileInputRef.current?.click()}
            />
            <span className="compose-draft-status" aria-live="polite">
              {draftStatus}
            </span>
            {scheduledAt && (
              <span className="compose-schedule-chip" title="Local schedule">
                <Icons.clock />
                <strong>{formatScheduleLabel(scheduledAt)}</strong>
                <button
                  type="button"
                  className="compose-schedule-chip-clear"
                  aria-label="Clear schedule"
                  onClick={() => setScheduledAt(null)}
                >
                  <Icons.close />
                </button>
              </span>
            )}
          </div>
          <div className="compose-toolbar-end">
            <div className="compose-schedule" ref={scheduleRef}>
              <ActionButton
                label="Schedule send"
                icon={<Icons.clock />}
                iconOnly
                showShortcut={false}
                aria-expanded={scheduleOpen}
                aria-haspopup="menu"
                onClick={() => setScheduleOpen((open) => !open)}
              />
              {scheduleOpen && (
                <div
                  className="compose-schedule-menu"
                  role="menu"
                  aria-label="Schedule send"
                >
                  <div className="compose-schedule-menu-title">
                    Send later
                  </div>
                  {quickPicks.map((pick) => (
                    <button
                      key={pick.id}
                      type="button"
                      role="menuitem"
                      className="compose-schedule-option"
                      onClick={() => {
                        setScheduledAt(pick.at);
                        setCustomAt(toDatetimeLocalValue(pick.at));
                        setScheduleOpen(false);
                      }}
                    >
                      <span>{pick.label}</span>
                      <span className="compose-schedule-option-when">
                        {formatScheduleLabel(pick.at)}
                      </span>
                    </button>
                  ))}
                  <div className="compose-schedule-custom">
                    <label>
                      Custom date and time
                      <input
                        type="datetime-local"
                        value={customAt}
                        min={toDatetimeLocalValue(new Date())}
                        onChange={(event) => setCustomAt(event.target.value)}
                      />
                    </label>
                    <ActionButton
                      label="Use custom time"
                      showShortcut={false}
                      disabled={!customAt}
                      onClick={() => {
                        const at = new Date(customAt);
                        if (Number.isNaN(at.getTime()) || at <= new Date()) {
                          return;
                        }
                        setScheduledAt(at);
                        setScheduleOpen(false);
                      }}
                    />
                    <p className="compose-schedule-hint">
                      Local schedule: sends when GalMail is open. Not a Gmail
                      server-side schedule.
                    </p>
                  </div>
                </div>
              )}
            </div>
            <ActionButton
              label={
                busy
                  ? scheduledAt
                    ? "Scheduling…"
                    : "Sending…"
                  : scheduledAt
                    ? "Schedule send"
                    : "Send"
              }
              icon={scheduledAt ? <Icons.clock /> : <Icons.send />}
              variant="primary"
              reveal={false}
              type="submit"
              disabled={busy}
              shortcutKeys={["meta+enter", "ctrl+enter"]}
            />
          </div>
        </div>
      </form>
    </div>
  );
}
