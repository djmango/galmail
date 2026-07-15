import { useEffect, useState } from "react";

export interface ComposeDraft {
  to: string;
  subject: string;
  body: string;
}

export function ComposeModal(props: {
  initialDraft?: ComposeDraft;
  onClose: () => void;
  onMinimize?: (draft: ComposeDraft) => void;
  onSend: (draft: ComposeDraft) => Promise<void>;
}) {
  const [to, setTo] = useState(props.initialDraft?.to ?? "");
  const [subject, setSubject] = useState(props.initialDraft?.subject ?? "");
  const [body, setBody] = useState(props.initialDraft?.body ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (props.initialDraft) {
      setTo(props.initialDraft.to);
      setSubject(props.initialDraft.subject);
      setBody(props.initialDraft.body);
    }
  }, [props.initialDraft]);

  const current: ComposeDraft = { to, subject, body };

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
              <button
                className="btn"
                type="button"
                title="Minimize to floating window"
                onClick={() => props.onMinimize?.(current)}
              >
                Minimize ▁
              </button>
            )}
            <button
              className="btn"
              type="button"
              title="Cancel · Esc"
              onClick={props.onClose}
            >
              Cancel
            </button>
          </div>
        </div>
        <input
          required
          placeholder="To"
          value={to}
          onChange={(e) => setTo(e.target.value)}
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
        <div className="top-actions">
          <button className="btn btn-primary" type="submit" disabled={busy} title="Send">
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
