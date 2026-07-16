import { useEffect, useRef, useState } from "react";
import { ActionButton } from "./ActionButton";

export interface PipDraft {
  id: string;
  to: string;
  subject: string;
  body: string;
}

export function ComposePiP(props: {
  drafts: PipDraft[];
  onExpand: (id: string) => void;
  onClose: (id: string) => void;
  onSend: (id: string) => void;
}) {
  return (
    <>
      {props.drafts.map((d, i) => (
        <PipWindow
          key={d.id}
          draft={d}
          index={i}
          onExpand={() => props.onExpand(d.id)}
          onClose={() => props.onClose(d.id)}
          onSend={() => props.onSend(d.id)}
        />
      ))}
    </>
  );
}

function PipWindow(props: {
  draft: PipDraft;
  index: number;
  onExpand: () => void;
  onClose: () => void;
  onSend: () => void;
}) {
  const [pos, setPos] = useState(() => ({
    x: window.innerWidth - 340 - props.index * 24,
    y: window.innerHeight - 220 - props.index * 24,
  }));
  const [dragging, setDragging] = useState(false);
  const offset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      setPos(() => ({
        x: Math.max(8, Math.min(window.innerWidth - 320, e.clientX - offset.current.x)),
        y: Math.max(8, Math.min(window.innerHeight - 80, e.clientY - offset.current.y)),
      }));
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  return (
    <div
      className={`pip ${dragging ? "pip-dragging" : ""}`}
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="Floating draft"
    >
      <div
        className="pip-header"
        onMouseDown={(e) => {
          offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
          setDragging(true);
        }}
      >
        <span aria-hidden>✉️</span>
        <span className="pip-title">{props.draft.subject || "Untitled draft"}</span>
        <div className="pip-actions">
          <ActionButton
            label="Send now"
            icon="➤"
            iconOnly
            variant="quiet"
            onClick={props.onSend}
          />
          <ActionButton
            label="Expand to full composer"
            icon="⤢"
            iconOnly
            variant="quiet"
            onClick={props.onExpand}
          />
          <ActionButton
            label="Close draft"
            icon="✕"
            iconOnly
            variant="quiet"
            onClick={props.onClose}
          />
        </div>
      </div>
      <div className="pip-body">
        <div className="pip-field">
          <strong>To:</strong> {props.draft.to || "—"}
        </div>
        <div className="pip-field">
          <strong>Subject:</strong> {props.draft.subject || "—"}
        </div>
        <div className="pip-field">{props.draft.body || "Empty body"}</div>
      </div>
    </div>
  );
}
