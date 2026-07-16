export type EditorMode = "normal" | "insert";

export function StatusBar(props: {
  mode: EditorMode;
  status: string;
  detail?: string;
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
        {props.detail && <span className="status-detail">{props.detail}</span>}
      </div>
      <div className="status-bar-right">
        <span className="status-message">{props.status}</span>
      </div>
    </footer>
  );
}
