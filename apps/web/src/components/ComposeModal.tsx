import { useState } from "react";

export function ComposeModal(props: {
  onClose: () => void;
  onSend: (draft: { to: string; subject: string; body: string }) => Promise<void>;
}) {
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="compose" role="dialog" aria-label="Compose">
      <form
        className="compose-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await props.onSend({ to, subject, body });
          } finally {
            setBusy(false);
          }
        }}
      >
        <strong>Compose</strong>
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
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send"}
          </button>
          <button className="btn" type="button" onClick={props.onClose}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
