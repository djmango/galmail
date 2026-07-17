const CELLS = Array.from({ length: 9 }, (_, i) => i);

const STATUS_TEXT = "Loading encrypted local graph…";

/**
 * GalMail branded, centered loading screen.
 * Uses the same class names as the inline fallback in index.html so the
 * pre-React cold-start paint and the React-rendered state stay in sync.
 * Indicator: 3x3 grid of accent blocks pulsing in a diagonal wave.
 */
export function LoadingScreen({ status = STATUS_TEXT }: { status?: string }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      <div className="loading-brand">
        <div className="loading-grid" aria-hidden="true">
          {CELLS.map((i) => (
            <span key={i} className="loading-cell" />
          ))}
        </div>
        <p className="loading-eyebrow">GalMail</p>
        <p className="loading-status">{status}</p>
      </div>
    </div>
  );
}
