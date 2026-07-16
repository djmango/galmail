export type EditorMode = "normal" | "insert";

export function StatusBar(props: {
  mode: EditorMode;
  status: string;
  detail?: string;
  counts?: {
    label: string;
    unread: number;
    total: number;
  };
}) {
  return (
    <footer className="status-bar" role="status" aria-live="polite">
      <div className="status-bar-left">
        <span
          className={`mode-pill mode-${props.mode}`}
          title={
            props.mode === "normal"
              ? "Normal mode · j/k navigate · i or Enter to type · Esc closes overlays"
              : "Insert mode · Esc returns to Normal"
          }
        >
          <span className="mode-dot" aria-hidden />
          <span className="mode-label">
            {props.mode === "normal" ? "Normal" : "Insert"}
          </span>
        </span>
        {props.counts && (
          <span
            className="status-counts"
            title={`${props.counts.label}: ${props.counts.unread} unread of ${props.counts.total}`}
          >
            <span className="status-counts-label">{props.counts.label}</span>
            <span className="status-counts-sep" aria-hidden>
              ·
            </span>
            <span className="status-counts-unread">
              {props.counts.unread}
              <span className="status-counts-unit"> unread</span>
            </span>
            <span className="status-counts-sep" aria-hidden>
              ·
            </span>
            <span className="status-counts-total">{props.counts.total}</span>
          </span>
        )}
        {props.detail && <span className="status-detail">{props.detail}</span>}
      </div>
      <div className="status-bar-right">
        <span className="status-message">{props.status}</span>
      </div>
    </footer>
  );
}
