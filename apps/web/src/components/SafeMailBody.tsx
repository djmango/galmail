import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildIsolatedMailDocument,
  isSafeHttpUrl,
  splitQuotedHistory,
  type MailColorScheme,
} from "@galmail/core-api";
import { invoke } from "@tauri-apps/api/core";
import { isNativeShell } from "../lib/account-session";
import { ActionButton } from "./ActionButton";
import { Icons } from "./Icons";

const OPEN_URL_MESSAGE = "galmail:open-url";

/** Click bridge: post safe link navigations to the parent (no same-origin). */
const LINK_BRIDGE_SCRIPT = `<script>(function(){
  function hrefFromEvent(event){
    var el=event.target;
    if(!el||!el.closest)return null;
    var a=el.closest("a");
    if(!a)return null;
    return a.getAttribute("href");
  }
  function onActivate(event){
    var href=hrefFromEvent(event);
    if(!href||href==="#"||href.indexOf("javascript:")===0)return;
    event.preventDefault();
    event.stopPropagation();
    window.parent.postMessage({type:${JSON.stringify(OPEN_URL_MESSAGE)},href:href},"*");
  }
  document.addEventListener("click",onActivate,true);
  document.addEventListener("auxclick",onActivate,true);
})();</script>`;

function withLinkBridge(htmlDocument: string): string {
  const withCsp = htmlDocument.replace(
    "style-src 'unsafe-inline'",
    "style-src 'unsafe-inline'; script-src 'unsafe-inline'",
  );
  if (withCsp.includes("</body>")) {
    return withCsp.replace("</body>", `${LINK_BRIDGE_SCRIPT}</body>`);
  }
  return `${withCsp}${LINK_BRIDGE_SCRIPT}`;
}

async function openExternalUrl(url: string): Promise<void> {
  if (isNativeShell()) {
    await invoke("open_external_url", { url });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function privacyNote(sender: string, allowRemoteImages: boolean): string {
  return allowRemoteImages
    ? `Remote images enabled for ${sender}; known tracking parameters removed.`
    : "Remote images blocked. This prevents common tracking pixels.";
}

function MailBodyOverflowMenu(props: {
  allowRemoteImages: boolean;
  showHtml: boolean;
  hasHtml: boolean;
  sender: string;
  onToggleRemoteImages: () => void;
  onTogglePlainText: () => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="mail-body-menu" ref={rootRef}>
      <ActionButton
        label="Message options"
        icon={<Icons.moreHorizontal />}
        iconOnly
        variant="quiet"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <div className="mail-body-menu-panel" role="menu">
          <button
            type="button"
            role="menuitem"
            className="mail-body-menu-item"
            onClick={() => {
              props.onToggleRemoteImages();
              setOpen(false);
            }}
          >
            {props.allowRemoteImages
              ? "Block remote images"
              : "Load remote images"}
          </button>
          {props.hasHtml && (
            <button
              type="button"
              role="menuitem"
              className="mail-body-menu-item"
              onClick={() => {
                props.onTogglePlainText();
                setOpen(false);
              }}
            >
              {props.showHtml ? "Show plain text" : "Show sanitized HTML"}
            </button>
          )}
          <div className="mail-body-menu-info" role="note">
            <span className="mail-body-menu-info-icon" aria-hidden>
              <Icons.info />
            </span>
            <span>{privacyNote(props.sender, props.allowRemoteImages)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function SafeMailBody(props: {
  html?: string;
  text?: string;
  sender: string;
  theme?: MailColorScheme;
  /** Initial remote-image policy from Settings; per-view toggle can override. */
  loadRemoteImages?: boolean;
}) {
  const colorScheme: MailColorScheme =
    props.theme === "light" ? "light" : "dark";
  const [showHtml, setShowHtml] = useState(Boolean(props.html));
  const [allowRemoteImages, setAllowRemoteImages] = useState(
    () => props.loadRemoteImages ?? true,
  );
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const document = useMemo(
    () =>
      props.html
        ? withLinkBridge(
            buildIsolatedMailDocument(props.html, {
              allowRemoteImages,
              stripTrackingParameters: true,
              colorScheme,
            }),
          )
        : "",
    [props.html, allowRemoteImages, colorScheme],
  );

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if ((data as { type?: unknown }).type !== OPEN_URL_MESSAGE) return;
      const href = (data as { href?: unknown }).href;
      if (typeof href !== "string" || !isSafeHttpUrl(href)) return;
      void openExternalUrl(href);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const overflowMenu = props.html ? (
    <div className="mail-body-chrome">
      <MailBodyOverflowMenu
        allowRemoteImages={allowRemoteImages}
        showHtml={showHtml}
        hasHtml={Boolean(props.html)}
        sender={props.sender}
        onToggleRemoteImages={() =>
          setAllowRemoteImages((value) => !value)
        }
        onTogglePlainText={() => setShowHtml((value) => !value)}
      />
    </div>
  ) : null;

  if (!props.html || !showHtml) {
    const plain = splitQuotedHistory(props.text || "No readable body.");
    return (
      <div className="safe-mail-body" data-mail-scheme={colorScheme}>
        {overflowMenu}
        <pre className="mail-plain-text">{plain.visible}</pre>
        {plain.quoted && (
          <details className="quoted-history">
            <summary>Show quoted history</summary>
            <pre className="mail-plain-text">{plain.quoted}</pre>
          </details>
        )}
      </div>
    );
  }

  return (
    <div className="safe-mail-body" data-mail-scheme={colorScheme}>
      {overflowMenu}
      <iframe
        ref={iframeRef}
        className="mail-html-frame"
        title="Sanitized message body"
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={document}
      />
    </div>
  );
}
