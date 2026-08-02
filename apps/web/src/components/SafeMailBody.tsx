import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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

function measureMailDocument(doc: Document): number {
  const body = doc.body;
  const root = doc.documentElement;
  if (!body) return 0;
  body.style.overflow = "hidden";
  body.style.height = "auto";
  root.style.overflow = "hidden";
  root.style.height = "auto";

  let bottom = 0;
  for (const child of Array.from(body.children)) {
    const rect = child.getBoundingClientRect();
    if (rect.bottom > bottom) bottom = rect.bottom;
  }
  return Math.max(
    bottom,
    body.scrollHeight,
    body.offsetHeight,
    root.scrollHeight,
    root.offsetHeight,
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
  const [frameHeight, setFrameHeight] = useState(160);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const documentHtml = useMemo(
    () =>
      props.html
        ? buildIsolatedMailDocument(props.html, {
            allowRemoteImages,
            stripTrackingParameters: true,
            colorScheme,
            cidMap: props.cidMap,
          })
        : "",
    [props.html, allowRemoteImages, colorScheme, props.cidMap],
  );

  // bodyHtml can arrive after the card mounts (hydrate); switch to HTML mode.
  useEffect(() => {
    if (props.html) setShowHtml(true);
  }, [props.html]);

  useEffect(() => {
    setFrameHeight(160);
  }, [documentHtml]);

  useLayoutEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !documentHtml) return;

    let cancelled = false;
    let observer: ResizeObserver | undefined;
    const cleanups: Array<() => void> = [];

    const syncHeight = () => {
      if (cancelled) return;
      try {
        const doc = iframe.contentDocument;
        if (!doc?.body) return;
        const next = Math.max(120, Math.ceil(measureMailDocument(doc)) + 8);
        setFrameHeight((prev) => (Math.abs(prev - next) < 2 ? prev : next));
      } catch {
        // Sandbox / access errors - leave prior height.
      }
    };

    const onLinkActivate = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || href === "#" || href.startsWith("javascript:")) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (!isSafeHttpUrl(href)) return;
      void openExternalUrl(href);
    };

    const bindDocument = () => {
      const doc = iframe.contentDocument;
      if (!doc?.body || cancelled) return;

      doc.addEventListener("click", onLinkActivate, true);
      cleanups.push(() =>
        doc.removeEventListener("click", onLinkActivate, true),
      );

      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => syncHeight());
        observer.observe(doc.body);
      }

      for (const img of Array.from(doc.images)) {
        const onImg = () => syncHeight();
        img.addEventListener("load", onImg);
        img.addEventListener("error", onImg);
        cleanups.push(() => {
          img.removeEventListener("load", onImg);
          img.removeEventListener("error", onImg);
        });
      }

      syncHeight();
      requestAnimationFrame(syncHeight);
      const t1 = window.setTimeout(syncHeight, 80);
      const t2 = window.setTimeout(syncHeight, 320);
      cleanups.push(() => {
        window.clearTimeout(t1);
        window.clearTimeout(t2);
      });
    };

    const onLoad = () => bindDocument();
    iframe.addEventListener("load", onLoad);
    // srcDoc may already be parsed before listeners attach.
    bindDocument();

    return () => {
      cancelled = true;
      iframe.removeEventListener("load", onLoad);
      observer?.disconnect();
      for (const cleanup of cleanups) cleanup();
    };
  }, [documentHtml]);

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
        // Same-origin so the parent can measure + intercept links.
        // Scripts stay disabled - CSP also sets script-src 'none'.
        sandbox="allow-same-origin"
        referrerPolicy="strict-origin-when-cross-origin"
        srcDoc={documentHtml}
        style={{ height: `${frameHeight}px` }}
      />
    </div>
  );
}
