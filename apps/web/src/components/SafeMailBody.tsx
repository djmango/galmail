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
const FRAME_HEIGHT_MESSAGE = "galmail:frame-height";

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

/** Report content height so the parent can size the iframe (no inner scroll). */
const HEIGHT_BRIDGE_SCRIPT = `<script>(function(){
  var TYPE=${JSON.stringify(FRAME_HEIGHT_MESSAGE)};
  function measure(){
    var root=document.documentElement;
    var body=document.body;
    if(root){root.style.overflow="hidden";root.style.height="auto";}
    if(body){body.style.overflow="hidden";body.style.height="auto";}
    var bottom=0;
    if(body){
      var kids=body.children;
      for(var i=0;i<kids.length;i++){
        var r=kids[i].getBoundingClientRect();
        if(r.bottom>bottom)bottom=r.bottom;
      }
    }
    var h=Math.max(
      bottom,
      root?root.scrollHeight:0,
      root?root.offsetHeight:0,
      body?body.scrollHeight:0,
      body?body.offsetHeight:0
    );
    window.parent.postMessage({type:TYPE,height:h},"*");
  }
  function schedule(){
    if(window.requestAnimationFrame)requestAnimationFrame(function(){
      requestAnimationFrame(measure);
    });
    else setTimeout(measure,0);
  }
  window.addEventListener("load",schedule);
  document.addEventListener("DOMContentLoaded",schedule);
  if(window.ResizeObserver&&document.body){
    try{new ResizeObserver(schedule).observe(document.body);}catch(e){}
  }
  if(window.MutationObserver&&document.body){
    try{
      new MutationObserver(schedule).observe(document.body,{
        childList:true,subtree:true,attributes:true,characterData:true
      });
    }catch(e){}
  }
  var imgs=document.images||[];
  for(var i=0;i<imgs.length;i++){
    imgs[i].addEventListener("load",schedule);
    imgs[i].addEventListener("error",schedule);
  }
  schedule();
  setTimeout(schedule,80);
  setTimeout(schedule,240);
  setTimeout(schedule,800);
})();</script>`;

function withMailBridges(htmlDocument: string): string {
  const withCsp = htmlDocument.replace(
    "style-src 'unsafe-inline'",
    "style-src 'unsafe-inline'; script-src 'unsafe-inline'",
  );
  const inject = `${HEIGHT_BRIDGE_SCRIPT}${LINK_BRIDGE_SCRIPT}`;
  if (withCsp.includes("</body>")) {
    return withCsp.replace("</body>", `${inject}</body>`);
  }
  return `${withCsp}${inject}`;
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
  /** When true, start blocked and prompt once (Ask approval mode). */
  askRemoteImages?: boolean;
  /** Content-ID → data/blob URL map for inline images. */
  cidMap?: Record<string, string>;
}) {
  const colorScheme: MailColorScheme =
    props.theme === "light" ? "light" : "dark";
  const [showHtml, setShowHtml] = useState(Boolean(props.html));
  const [allowRemoteImages, setAllowRemoteImages] = useState(() =>
    props.askRemoteImages ? false : (props.loadRemoteImages ?? true),
  );
  const [asked, setAsked] = useState(false);
  const [frameHeight, setFrameHeight] = useState(240);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const document = useMemo(
    () =>
      props.html
        ? withMailBridges(
            buildIsolatedMailDocument(props.html, {
              allowRemoteImages,
              stripTrackingParameters: true,
              colorScheme,
              cidMap: props.cidMap,
            }),
          )
        : "",
    [props.html, allowRemoteImages, colorScheme, props.cidMap],
  );

  useEffect(() => {
    setFrameHeight(240);
  }, [document]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== "object") return;
      const type = (data as { type?: unknown }).type;
      if (type === OPEN_URL_MESSAGE) {
        const href = (data as { href?: unknown }).href;
        if (typeof href !== "string" || !isSafeHttpUrl(href)) return;
        void openExternalUrl(href);
        return;
      }
      if (type === FRAME_HEIGHT_MESSAGE) {
        const height = (data as { height?: unknown }).height;
        if (typeof height !== "number" || !Number.isFinite(height)) return;
        const next = Math.max(120, Math.ceil(height) + 8);
        setFrameHeight((prev) => (Math.abs(prev - next) < 2 ? prev : next));
      }
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
        onToggleRemoteImages={() => setAllowRemoteImages((value) => !value)}
        onTogglePlainText={() => setShowHtml((value) => !value)}
      />
    </div>
  ) : null;

  const askBanner =
    props.askRemoteImages && !allowRemoteImages && !asked ? (
      <div className="remote-image-ask" role="status">
        <span>Remote images are blocked until you approve them.</span>
        <ActionButton
          label="Allow images"
          variant="quiet"
          onClick={() => {
            setAllowRemoteImages(true);
            setAsked(true);
          }}
        />
      </div>
    ) : null;

  if (!props.html || !showHtml) {
    const plain = splitQuotedHistory(props.text || "No readable body.");
    return (
      <div className="safe-mail-body" data-mail-scheme={colorScheme}>
        {overflowMenu}
        {askBanner}
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
      {askBanner}
      <iframe
        ref={iframeRef}
        className="mail-html-frame"
        title="Sanitized message body"
        sandbox="allow-scripts"
        // Allow image hosts that require a referrer while still avoiding
        // leaking full path for most navigations.
        referrerPolicy="strict-origin-when-cross-origin"
        srcDoc={document}
        style={{ height: `${frameHeight}px` }}
      />
    </div>
  );
}
