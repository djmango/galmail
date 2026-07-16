import { useMemo, useState } from "react";
import {
  buildIsolatedMailDocument,
  splitQuotedHistory,
} from "@galmail/core-api";
import { ActionButton } from "./ActionButton";

export function SafeMailBody(props: {
  html?: string;
  text?: string;
  sender: string;
}) {
  const [showHtml, setShowHtml] = useState(Boolean(props.html));
  const [allowRemoteImages, setAllowRemoteImages] = useState(false);
  const document = useMemo(
    () =>
      props.html
        ? buildIsolatedMailDocument(props.html, {
            allowRemoteImages,
            stripTrackingParameters: true,
          })
        : "",
    [props.html, allowRemoteImages],
  );

  if (!props.html || !showHtml) {
    const plain = splitQuotedHistory(props.text || "No readable body.");
    return (
      <div className="safe-mail-body">
        <pre className="mail-plain-text">{plain.visible}</pre>
        {plain.quoted && (
          <details className="quoted-history">
            <summary>Show quoted history</summary>
            <pre className="mail-plain-text">{plain.quoted}</pre>
          </details>
        )}
        {props.html && (
          <ActionButton
            label="Show sanitized HTML"
            onClick={() => setShowHtml(true)}
          />
        )}
      </div>
    );
  }

  return (
    <div className="safe-mail-body">
      <div className="mail-security-controls" role="status">
        <span>
          {allowRemoteImages
            ? `Remote images enabled for ${props.sender}; known tracking parameters removed.`
            : "Remote images blocked. This prevents common tracking pixels."}
        </span>
        <ActionButton
          label={
            allowRemoteImages ? "Block remote images" : "Load remote images"
          }
          onClick={() => setAllowRemoteImages((value) => !value)}
        />
        <ActionButton label="Plain text" onClick={() => setShowHtml(false)} />
      </div>
      <iframe
        className="mail-html-frame"
        title="Sanitized message body"
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={document}
      />
    </div>
  );
}
