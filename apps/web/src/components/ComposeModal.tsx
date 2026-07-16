import { useEffect, useRef, useState } from "react";
import type { DraftAttachment } from "@galmail/core-api";
import { ActionButton } from "./ActionButton";

export interface ComposeDraft {
  id?: string;
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

export function ComposeModal(props: {
  initialDraft?: ComposeDraft;
  onClose: () => void;
  onMinimize?: (draft: ComposeDraft) => void;
  onSaveDraft?: (draft: ComposeDraft) => Promise<void>;
  onSend: (draft: ComposeDraft) => Promise<void>;
}) {
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
  const [requestReadReceipt, setRequestReadReceipt] = useState(
    props.initialDraft?.requestReadReceipt ?? false,
  );
  const [busy, setBusy] = useState(false);
  const [draftStatus, setDraftStatus] = useState("Draft local");
  const initialized = useRef(false);
  const draftId = useRef(
    props.initialDraft?.id ?? `draft_${crypto.randomUUID()}`,
  );

  useEffect(() => {
    if (props.initialDraft) {
      setTo(props.initialDraft.to);
      setSubject(props.initialDraft.subject);
      setBody(props.initialDraft.body);
      setCc(props.initialDraft.cc ?? "");
      setBcc(props.initialDraft.bcc ?? "");
      setAlias(props.initialDraft.alias ?? "");
      setSignature(props.initialDraft.signature ?? "");
      setAttachments(props.initialDraft.attachments ?? []);
      setRequestReadReceipt(props.initialDraft.requestReadReceipt ?? false);
    }
  }, [props.initialDraft]);

  const current: ComposeDraft = {
    id: draftId.current,
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
        .catch(() => setDraftStatus("Draft queued offline"));
    }, 750);
    return () => clearTimeout(timer);
  }, [
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

  return (
    <div className="compose" role="dialog" aria-label="Compose">
      <form
        className="compose-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await props.onSend(current);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="compose-head">
          <strong>Compose</strong>
          <div className="top-actions">
            {props.onMinimize && (
              <ActionButton
                label="Minimize"
                icon="▁"
                onClick={() => props.onMinimize?.(current)}
              />
            )}
            <ActionButton
              label="Cancel"
              command="back"
              onClick={props.onClose}
            />
          </div>
        </div>
        <input
          required
          placeholder="To"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <div className="compose-recipient-row">
          <input
            placeholder="Cc"
            aria-label="Cc"
            value={cc}
            onChange={(e) => setCc(e.target.value)}
          />
          <input
            placeholder="Bcc"
            aria-label="Bcc"
            value={bcc}
            onChange={(e) => setBcc(e.target.value)}
          />
        </div>
        <input
          placeholder="Send as alias (optional)"
          aria-label="Send as alias"
          type="email"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
        />
        <input
          required
          placeholder="Subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
        <textarea
          required
          placeholder="Message"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <textarea
          className="compose-signature"
          placeholder="Signature (optional)"
          aria-label="Signature"
          value={signature}
          onChange={(e) => setSignature(e.target.value)}
        />
        <div className="compose-options">
          <label>
            <input
              type="checkbox"
              checked={requestReadReceipt}
              onChange={(event) => setRequestReadReceipt(event.target.checked)}
            />
            Request read receipt
          </label>
          <span className="meta">
            Receipts and pixels cannot prove a human read the message; Apple
            Mail Privacy Protection and image proxies can prefetch them.
          </span>
          <label className="attachment-picker">
            Attach files
            <input
              type="file"
              multiple
              onChange={async (event) => {
                const files = [...(event.target.files ?? [])];
                const next = await Promise.all(
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
                setAttachments((value) => [...value, ...next]);
              }}
            />
          </label>
        </div>
        {attachments.length > 0 && (
          <ul className="compose-attachments" aria-label="Attachments">
            {attachments.map((attachment) => (
              <li key={attachment.id}>
                {attachment.filename} · {attachment.size.toLocaleString()} bytes
                <button
                  type="button"
                  onClick={() =>
                    setAttachments((items) =>
                      items.filter((item) => item.id !== attachment.id),
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="top-actions">
          <span className="meta" aria-live="polite">
            {draftStatus}
          </span>
          <ActionButton
            label={busy ? "Sending…" : "Send"}
            variant="primary"
            type="submit"
            disabled={busy}
          />
        </div>
      </form>
    </div>
  );
}
