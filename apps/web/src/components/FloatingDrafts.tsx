import { useEffect, useRef, useState } from "react";
import { ActionButton } from "./ActionButton";
import { Icons } from "./Icons";

export interface FloatingDraft {
  id: string;
  to: string;
  subject: string;
  body: string;
}

export function FloatingDrafts(props: {
  drafts: FloatingDraft[];
  onExpand: (id: string) => void;
  onClose: (id: string) => void;
  onSend: (id: string) => void;
}) {
  return (
    <>
      {props.drafts.map((draft, index) => (
        <DraftWindow
          key={draft.id}
          draft={draft}
          index={index}
          onExpand={() => props.onExpand(draft.id)}
          onClose={() => props.onClose(draft.id)}
          onSend={() => props.onSend(draft.id)}
        />
      ))}
    </>
  );
}

function DraftWindow(props: {
  draft: FloatingDraft;
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
        x: Math.max(
          8,
          Math.min(window.innerWidth - 320, e.clientX - offset.current.x),
        ),
        y: Math.max(
          8,
          Math.min(window.innerHeight - 80, e.clientY - offset.current.y),
        ),
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
      className={`draft-float ${dragging ? "draft-float-dragging" : ""}`}
      style={{ left: pos.x, top: pos.y }}
      role="dialog"
      aria-label="Draft"
    >
      <div
        className="draft-float-header"
        onMouseDown={(e) => {
          offset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
          setDragging(true);
        }}
      >
        <span className="draft-float-icon" aria-hidden>
          <Icons.drafts />
        </span>
        <span className="draft-float-title">
          {props.draft.subject || "Untitled draft"}
        </span>
        <div className="draft-float-actions">
          <ActionButton
            label="Send now"
            icon={<Icons.send />}
            iconOnly
            variant="quiet"
            onClick={props.onSend}
          />
          <ActionButton
            label="Open full composer"
            icon={<Icons.expand />}
            iconOnly
            variant="quiet"
            onClick={props.onExpand}
          />
          <ActionButton
            label="Close draft"
            icon={<Icons.close />}
            iconOnly
            variant="quiet"
            onClick={props.onClose}
          />
        </div>
      </div>
      <div className="draft-float-body">
        <div className="draft-float-field">
          <strong>To:</strong> {props.draft.to || "No recipients"}
        </div>
        <div className="draft-float-field">
          <strong>Subject:</strong> {props.draft.subject || "No subject"}
        </div>
        <div className="draft-float-field">
          {props.draft.body || "Empty body"}
        </div>
      </div>
    </div>
  );
}
