import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { MailMessage, MailThread, RemoteProcessingConsent } from "@galmail/core-api";
import { REMOTE_OPT_IN_DISCLOSURE_VERSION } from "@galmail/remote-opt-in";
import {
  isEditableTarget,
  keysForCommand,
  shortcutTooltip,
} from "@galmail/keyboard";
import { createGalMailRuntime, type GalMailRuntime } from "./lib/runtime";
import {
  DEFAULT_LAYOUT,
  DEFAULT_SIDEBAR,
  DEFAULT_THEME,
  type LayoutMode,
  type ThemeId,
} from "./lib/themes";
import { CommandPalette } from "./components/CommandPalette";
import { ComposeModal, type ComposeDraft } from "./components/ComposeModal";
import { ComposePiP, type PipDraft } from "./components/ComposePiP";
import { RemoteOptInModal } from "./components/RemoteOptInModal";
import { SettingsBar, type SettingsState } from "./components/SettingsBar";

const THEME_LABELS: Record<ThemeId, string> = {
  linear: "Linear · dark + dense",
  tesla: "Tesla · sparse + white",
  pocketcasts: "Pocket Casts · purple",
  readwise: "Readwise · paper + serif",
  robinhood: "Robinhood · black + green",
  airbnb: "Airbnb · warm + coral",
};

const LAYOUT_LABELS: Record<LayoutMode, string> = {
  fullscreen: "1-panel fullscreen",
  "two-panel": "2-panel auto sidebar",
  "three-panel": "3-panel traditional",
};

export function App() {
  const [runtime, setRuntime] = useState<GalMailRuntime | null>(null);
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeInitial, setComposeInitial] = useState<ComposeDraft | undefined>(undefined);
  const [pipDrafts, setPipDrafts] = useState<PipDraft[]>([]);
  const [optInOpen, setOptInOpen] = useState(false);
  const [status, setStatus] = useState("Hydrating local inbox…");
  const [consent, setConsent] = useState<RemoteProcessingConsent | null>(null);
  const [settings, setSettings] = useState<SettingsState>({
    theme: DEFAULT_THEME,
    layout: DEFAULT_LAYOUT,
    sidebar: DEFAULT_SIDEBAR,
  });
  const [, startTransition] = useTransition();
  const threadListRef = useRef<HTMLElement>(null);
  const overlayRef = useRef({ paletteOpen: false, composeOpen: false, optInOpen: false });
  overlayRef.current = { paletteOpen, composeOpen, optInOpen };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rt = await createGalMailRuntime();
      if (cancelled) return;
      setRuntime(rt);
      setThreads(rt.threads);
      setSelectedId(rt.threads[0]?.id ?? null);
      setStatus(`Local hydrate complete · ${rt.threads.length} threads · blind mode`);
      const c = await rt.remoteOptIn.getConsent(rt.gmailAccountId);
      if (!cancelled) setConsent(c);

      // Deltas after hydrate (Linear-style).
      await rt.sync.pullDeltas(rt.gmailAccountId);
      await rt.sync.pullDeltas(rt.microsoftAccountId);
      if (!cancelled) setStatus((s) => `${s} · deltas applied`);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!runtime || !selectedId) {
      setMessage(null);
      return;
    }
    const thread = threads.find((t) => t.id === selectedId);
    if (!thread) return;
    const account = runtime.accounts.find((a) => a.accountId === thread.accountId);
    if (!account) return;
    const mid = thread.messageIds[0];
    if (!mid) return;
    account.provider.getMessage(thread.accountId, mid).then(setMessage);
  }, [runtime, selectedId, threads]);

  const selectedIndex = useMemo(
    () => threads.findIndex((t) => t.id === selectedId),
    [threads, selectedId],
  );

  const focusThreadList = () => {
    threadListRef.current?.focus();
  };

  useEffect(() => {
    if (!runtime) return;
    const reg = runtime.commands;

    const archiveSelected = () => {
      const thread = threads[selectedIndex];
      if (!thread?.messageIds[0]) return;
      startTransition(() => {
        setThreads((prev) => prev.filter((t) => t.id !== thread.id));
        setSelectedId((id) => {
          const next = threads[selectedIndex + 1] ?? threads[selectedIndex - 1];
          return id === thread.id ? (next?.id ?? null) : id;
        });
      });
      void runtime.sync
        .enqueue({
          accountId: thread.accountId,
          kind: "archive",
          targetIds: [thread.messageIds[0]],
        })
        .then(() => runtime.sync.flushOutbox(thread.accountId))
        .then(() => setStatus("Archived (optimistic + outbox flushed)"));
    };

    const toggleReadSelected = () => {
      const thread = threads[selectedIndex];
      if (!thread?.messageIds[0]) return;
      const markingUnread = thread.unreadCount === 0;
      startTransition(() => {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === thread.id
              ? { ...t, unreadCount: markingUnread ? 1 : 0 }
              : t,
          ),
        );
      });
      setMessage((m) => (m ? { ...m, unread: markingUnread } : m));
      void runtime.sync
        .enqueue({
          accountId: thread.accountId,
          kind: markingUnread ? "mark_unread" : "mark_read",
          targetIds: [thread.messageIds[0]],
        })
        .then(() => runtime.sync.flushOutbox(thread.accountId))
        .then(() =>
          setStatus(markingUnread ? "Marked unread" : "Marked read"),
        );
    };

    const goToInbox = () => {
      setPaletteOpen(false);
      setComposeOpen(false);
      setOptInOpen(false);
      setSelectedId(threads[0]?.id ?? null);
      setStatus("Inbox");
      requestAnimationFrame(() => focusThreadList());
    };

    const handleBack = () => {
      const overlays = overlayRef.current;
      // Layered dismiss — most specific first (Superhuman "Back").
      if (overlays.paletteOpen) {
        setPaletteOpen(false);
        requestAnimationFrame(() => focusThreadList());
        return;
      }
      if (overlays.composeOpen) {
        setComposeOpen(false);
        requestAnimationFrame(() => focusThreadList());
        return;
      }
      if (overlays.optInOpen) {
        setOptInOpen(false);
        requestAnimationFrame(() => focusThreadList());
        return;
      }
      if (selectedId) {
        setSelectedId(null);
        setStatus("Selection cleared");
        requestAnimationFrame(() => focusThreadList());
        return;
      }
      focusThreadList();
    };

    reg.on("navigate_down", () => {
      const next = threads[Math.min(threads.length - 1, selectedIndex + 1)];
      if (next) setSelectedId(next.id);
    });
    reg.on("navigate_up", () => {
      const prev = threads[Math.max(0, selectedIndex - 1)];
      if (prev) setSelectedId(prev.id);
    });
    reg.on("archive", archiveSelected);
    reg.on("mark_read_toggle", toggleReadSelected);
    reg.on("compose", () => {
      setComposeInitial(undefined);
      setComposeOpen(true);
    });
    reg.on("command_palette", () => setPaletteOpen(true));
    reg.on("search", () => setPaletteOpen(true));
    reg.on("undo", () => setStatus("Undo stack scaffolded — last action reversible in v0.2"));
    reg.on("go_to_inbox", goToInbox);
    reg.on("back", handleBack);

    const onKey = (e: KeyboardEvent) => {
      const editable = isEditableTarget(e.target);

      // Escape always dismisses layered UI, including inside composer/palette inputs.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        handleBack();
        return;
      }

      // Don't steal typing in compose/search fields for other shortcuts.
      if (editable) return;

      const id = reg.match({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        shiftKey: e.shiftKey,
      });
      if (!id || id === "back") return;
      e.preventDefault();
      reg.dispatch(id);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      reg.clearPending();
    };
  }, [runtime, threads, selectedIndex, selectedId]);

  const layout = settings.layout;
  const fullscreenList = layout === "fullscreen" && !selectedId;

  const updateSettings = (next: Partial<SettingsState>) =>
    setSettings((cur) => ({ ...cur, ...next }));

  const openCompose = (initial?: ComposeDraft) => {
    setComposeInitial(initial);
    setComposeOpen(true);
  };

  const minimizeCompose = (draft: ComposeDraft) => {
    const id = `pip_${Date.now()}`;
    setPipDrafts((d) => [...d, { id, ...draft }]);
    setComposeOpen(false);
    setComposeInitial(undefined);
    setStatus(`Draft minimized to floating window (${pipDrafts.length + 1} PiP)`);
  };

  const expandPip = (id: string) => {
    const d = pipDrafts.find((x) => x.id === id);
    if (!d) return;
    openCompose({ to: d.to, subject: d.subject, body: d.body });
    setPipDrafts((d) => d.filter((x) => x.id !== id));
  };

  const closePip = (id: string) => setPipDrafts((d) => d.filter((x) => x.id !== id));

  const sendPip = async (id: string) => {
    const d = pipDrafts.find((x) => x.id === id);
    if (!d || !runtime) return;
    await runtime.sync.enqueue({
      accountId: runtime.gmailAccountId,
      kind: "send",
      targetIds: [],
      payload: { to: d.to, subject: d.subject, body: d.body } as unknown as Record<string, unknown>,
    });
    const provider = runtime.accounts[0]!.provider;
    await provider.sendDraft(runtime.gmailAccountId, {
      id: `draft_${Date.now()}`,
      accountId: runtime.gmailAccountId,
      to: [{ email: d.to }],
      subject: d.subject,
      bodyHtml: `<p>${d.body}</p>`,
      bodyText: d.body,
      updatedAt: new Date().toISOString(),
    });
    await runtime.sync.flushOutbox(runtime.gmailAccountId);
    setPipDrafts((x) => x.filter((p) => p.id !== id));
    setStatus("Sent PiP draft via fixture provider + outbox");
  };

  if (!runtime) {
    return (
      <div className="app">
        <header className="topbar">
          <div className="brand">
            <div className="brand-name">GalMail</div>
            <div className="brand-tag">Loading encrypted local graph…</div>
          </div>
        </header>
      </div>
    );
  }

  const tip = (id: Parameters<typeof keysForCommand>[0], title?: string) => {
    const def = runtime.commands.list().find((c) => c.id === id);
    return shortcutTooltip(title ?? def?.title ?? id, keysForCommand(id));
  };

  return (
    <div
      className="app"
      data-theme={settings.theme}
      data-layout={settings.layout}
      data-sidebar={settings.sidebar}
    >
      <header className="topbar">
        <div className="brand">
          <div className="brand-name">GalMail</div>
          <div className="brand-tag">
            {THEME_LABELS[settings.theme]} · {LAYOUT_LABELS[settings.layout]}
          </div>
        </div>
        <div className="top-actions">
          <SettingsBar state={settings} onChange={updateSettings} />
          <button
            className="btn"
            type="button"
            title={tip("command_palette")}
            aria-keyshortcuts="Meta+K Control+K"
            onClick={() => setPaletteOpen(true)}
          >
            Commands <span className="kbd">⌘K</span>
          </button>
          <button
            className="btn"
            type="button"
            title={tip("compose")}
            aria-keyshortcuts="C"
            onClick={() => openCompose()}
          >
            Compose <span className="kbd">C</span>
          </button>
          <button
            className="btn"
            type="button"
            title="Remote processing"
            onClick={() => setOptInOpen(true)}
          >
            Remote processing
          </button>
          <button
            className="btn btn-primary"
            type="button"
            title="Link device"
            onClick={async () => {
              const { inviteCode } = await runtime.devices.createInvite();
              setStatus(`Device invite: ${inviteCode} (expires in 15m)`);
            }}
          >
            Link device
          </button>
        </div>
      </header>

      <div className="shell">
        <aside
          className="sidebar panel"
          aria-label="Folders"
          data-hidden={layout === "fullscreen" ? "true" : undefined}
        >
          <button
            className="nav-item active"
            type="button"
            title={tip("go_to_inbox")}
            aria-keyshortcuts="I"
            onClick={() => runtime.commands.dispatch("go_to_inbox")}
          >
            <span className="nav-icon" aria-hidden>📥</span>
            <span className="nav-label">Unified inbox</span>
          </button>
          <button className="nav-item" type="button" title="Gmail labels">
            <span className="nav-icon" aria-hidden>🏷️</span>
            <span className="nav-label">Gmail labels</span>
          </button>
          <button className="nav-item" type="button" title="Outlook folders">
            <span className="nav-icon" aria-hidden>📁</span>
            <span className="nav-label">Outlook folders</span>
          </button>
          <button className="nav-item" type="button" title="Floating drafts">
            <span className="nav-icon" aria-hidden>🪟</span>
            <span className="nav-label">PiP drafts · {pipDrafts.length}</span>
          </button>
          <p className="warn warn-note" style={{ marginTop: "1.5rem", fontSize: "0.78rem" }}>
            Fixture mode — no OAuth secrets required. See .env.example for live providers.
          </p>
        </aside>

        <section
          className="thread-list panel"
          aria-label="Thread list"
          tabIndex={-1}
          ref={threadListRef}
          data-fullscreen={fullscreenList ? "true" : "false"}
        >
          {layout === "fullscreen" && selectedId && (
            <button
              className="btn back-btn"
              type="button"
              title="Back to list · Esc"
              onClick={() => setSelectedId(null)}
            >
              ← Back to inbox
            </button>
          )}
          {threads.map((t) => {
            const name = t.participants[0]?.name ?? t.participants[0]?.email ?? "Unknown";
            const initials = name.slice(0, 2).toUpperCase();
            const priority = t.unreadCount > 0 ? "high" : "low";
            return (
              <button
                key={`${t.accountId}:${t.id}`}
                type="button"
                className={`thread ${selectedId === t.id ? "selected" : ""} ${
                  t.unreadCount > 0 ? "unread" : ""
                }`}
                onClick={() => setSelectedId(t.id)}
              >
                <div className="thread-row">
                  <span className="avatar" aria-hidden>{initials}</span>
                  <div className="thread-main">
                    <div className="thread-top">
                      <span className="thread-from">
                        {name}
                        <span className="provider-pill">{t.provider}</span>
                      </span>
                      <span className="thread-meta">
                        {new Date(t.lastMessageAt).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </div>
                    <div className="thread-subject">{t.subject}</div>
                    <div className="thread-snippet">{t.snippet}</div>
                  </div>
                  <span className={`priority-spark ${priority}`} aria-hidden title="Priority">
                    <i style={{ height: "30%" }} />
                    <i style={{ height: "55%" }} />
                    <i style={{ height: "80%" }} />
                    <i style={{ height: "45%" }} />
                  </span>
                </div>
              </button>
            );
          })}
        </section>

        <section
          className="reading-pane panel reading"
          aria-label="Reading pane"
          data-fullscreen={layout === "fullscreen" && selectedId ? "true" : "false"}
        >
          {message ? (
            <>
              {layout === "fullscreen" && (
                <button
                  className="btn back-btn"
                  type="button"
                  title="Back to list · Esc"
                  onClick={() => setSelectedId(null)}
                >
                  ← Back to inbox
                </button>
              )}
              <div className="reading-toolbar">
                <button
                  className="btn"
                  type="button"
                  title={tip("archive")}
                  aria-keyshortcuts="E"
                  onClick={() => runtime.commands.dispatch("archive")}
                >
                  Archive <span className="kbd">E</span>
                </button>
                <button
                  className="btn"
                  type="button"
                  title={tip("mark_read_toggle")}
                  aria-keyshortcuts="U"
                  onClick={() => runtime.commands.dispatch("mark_read_toggle")}
                >
                  {message.unread ? "Mark read" : "Mark unread"}
                </button>
                <button
                  className="btn"
                  type="button"
                  title={tip("reply")}
                  aria-keyshortcuts="R"
                  onClick={() =>
                    openCompose({
                      to: message.from.email,
                      subject: message.subject.startsWith("Re:")
                        ? message.subject
                        : `Re: ${message.subject}`,
                      body: "",
                    })
                  }
                >
                  Reply <span className="kbd">R</span>
                </button>
              </div>
              <h1>{message.subject}</h1>
              <div className="meta">
                {message.from.name ?? message.from.email} · {message.date} ·{" "}
                {message.provider}
              </div>
              <div className="body">{message.bodyText ?? message.snippet}</div>
            </>
          ) : (
            <p className="meta">
              Select a thread. Keys: j/k navigate, e archive, i inbox, u read, Esc back, c
              compose.
            </p>
          )}
        </section>
      </div>

      <div className="status-bar">
        <span>{status}</span>
        <span>
          Remote opt-in (Gmail): {consent?.enabled ? "enabled" : "disabled"} · retention{" "}
          {consent?.retentionHours ?? 0}h
        </span>
        <span>
          OPFS {runtime.adapters.opfsAvailable ? "yes" : "n/a"} · WebCrypto{" "}
          {runtime.adapters.webCryptoAvailable ? "yes" : "no"}
        </span>
      </div>

      {paletteOpen && (
        <CommandPalette
          commands={runtime.commands.list()}
          onClose={() => setPaletteOpen(false)}
          onRun={(id) => {
            runtime.commands.dispatch(id);
            setPaletteOpen(false);
          }}
        />
      )}

      {composeOpen && (
        <ComposeModal
          initialDraft={composeInitial}
          onClose={() => {
            setComposeOpen(false);
            setComposeInitial(undefined);
          }}
          onMinimize={minimizeCompose}
          onSend={async (draft) => {
            await runtime.sync.enqueue({
              accountId: runtime.gmailAccountId,
              kind: "send",
              targetIds: [],
              payload: draft as unknown as Record<string, unknown>,
            });
            const provider = runtime.accounts[0]!.provider;
            await provider.sendDraft(runtime.gmailAccountId, {
              id: `draft_${Date.now()}`,
              accountId: runtime.gmailAccountId,
              to: [{ email: draft.to }],
              subject: draft.subject,
              bodyHtml: `<p>${draft.body}</p>`,
              bodyText: draft.body,
              updatedAt: new Date().toISOString(),
            });
            await runtime.sync.flushOutbox(runtime.gmailAccountId);
            setComposeOpen(false);
            setComposeInitial(undefined);
            setStatus("Sent via fixture provider + outbox");
          }}
        />
      )}

      <ComposePiP
        drafts={pipDrafts}
        onExpand={expandPip}
        onClose={closePip}
        onSend={sendPip}
      />

      {optInOpen && consent && (
        <RemoteOptInModal
          copy={runtime.copy}
          consent={consent}
          onClose={() => setOptInOpen(false)}
          onSave={async (next) => {
            const updated = {
              ...next,
              disclosureVersion: REMOTE_OPT_IN_DISCLOSURE_VERSION,
            };
            await runtime.remoteOptIn.setConsent(updated);
            setConsent(await runtime.remoteOptIn.getConsent(runtime.gmailAccountId));
            setOptInOpen(false);
            setStatus(
              updated.enabled
                ? "Remote processing enabled for Gmail demo account"
                : "Returned to zero-access for Gmail demo account",
            );
          }}
        />
      )}
    </div>
  );
}
