import { useState } from "react";
import type { RemoteProcessingConsent } from "@galmail/core-api";
import type { REMOTE_OPT_IN_COPY } from "@galmail/remote-opt-in";

export function RemoteOptInModal(props: {
  copy: typeof REMOTE_OPT_IN_COPY;
  consent: RemoteProcessingConsent;
  onClose: () => void;
  onSave: (consent: RemoteProcessingConsent) => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(props.consent.enabled);
  const [allowAi, setAllowAi] = useState(props.consent.allowAi);
  const [retentionHours, setRetentionHours] = useState(props.consent.retentionHours);
  const [acked, setAcked] = useState(false);

  return (
    <div className="modal" role="dialog" aria-label="Remote processing consent">
      <div className="modal-card">
        <h2 style={{ margin: 0 }}>{props.copy.title}</h2>
        <p>{props.copy.summary}</p>
        <p className="warn">{props.copy.consequence}</p>
        <p>{props.copy.retention}</p>
        <p>{props.copy.aiNote}</p>
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />{" "}
          Enable remote processing for this account
        </label>
        <label>
          <input
            type="checkbox"
            checked={allowAi}
            disabled={!enabled}
            onChange={(e) => setAllowAi(e.target.checked)}
          />{" "}
          Allow optional AI on this account
        </label>
        <label>
          Retention hours{" "}
          <input
            type="number"
            min={0}
            max={168}
            disabled={!enabled}
            value={retentionHours}
            onChange={(e) => setRetentionHours(Number(e.target.value))}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={acked}
            onChange={(e) => setAcked(e.target.checked)}
          />{" "}
          {props.copy.confirmLabel}
        </label>
        <div className="top-actions">
          <button
            className="btn btn-primary"
            type="button"
            disabled={enabled && !acked}
            onClick={() =>
              props.onSave({
                ...props.consent,
                enabled,
                allowAi: enabled ? allowAi : false,
                retentionHours: enabled ? retentionHours : 0,
              })
            }
          >
            Save
          </button>
          <button className="btn" type="button" onClick={props.onClose}>
            {props.copy.cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
