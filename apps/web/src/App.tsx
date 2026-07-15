import { useEffect, useMemo, useState, useTransition } from "react";
import type { MailMessage, MailThread, RemoteProcessingConsent } from "@galmail/core-api";
import { REMOTE_OPT_IN_DISCLOSURE_VERSION } from "@galmail/remote-opt-in";
import { createGalMailRuntime, type GalMailRuntime } from "./lib/runtime";
import { CommandPalette } from "./components/CommandPalette";
import { ComposeModal } from "./components/ComposeModal";
import { RemoteOptInModal } from "./components/RemoteOptInModal";

export function App() {
  const [runtime, setRuntime] = useState<GalMailRuntime | null>(null);
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [optInOpen, setOptInOpen] = useState(false);
  const [status, setStatus] = useState("Hydrating local inbox…");
  const [consent, setConsent] = useState<RemoteProcessingConsent | null>(null);
  const [, startTransition] = useTransition();

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
      setConsent(c);

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

    reg.on("navigate_down", () => {
      const next = threads[Math.min(threads.length - 1, selectedIndex + 1)];
      if (next) setSelectedId(next.id);
    });
    reg.on("navigate_up", () => {
      const prev = threads[Math.max(0, selectedIndex - 1)];
      if (prev) setSelectedId(prev.id);
    });
    reg.on("archive", archiveSelected);
    reg.on("compose", () => setComposeOpen(true));
    reg.on("command_palette", () => setPaletteOpen(true));
    reg.on("search", () => setPaletteOpen(true));
    reg.on("undo", () => setStatus("Undo stack scaffolded — last action reversible in v0.2"));

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      const id = reg.match({
        key: e.key,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
      });
      if (!id) return;
      e.preventDefault();
      reg.dispatch(id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runtime, threads, selectedIndex]);

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

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-name">GalMail</div>
          <div className="brand-tag">Privacy-first · keyboard-first · local-first</div>
        </div>
        <div className="top-actions">
          <button className="btn" type="button" onClick={() => setPaletteOpen(true)}>
            Commands ⌘K
          </button>
          <button className="btn" type="button" onClick={() => setComposeOpen(true)}>
            Compose
          </button>
          <button className="btn" type="button" onClick={() => setOptInOpen(true)}>
            Remote processing
          </button>
          <button
            className="btn btn-primary"
            type="button"
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
        <aside className="sidebar panel">
          <button className="nav-item active" type="button">
            Unified inbox
          </button>
          <button className="nav-item" type="button">
            Gmail labels
          </button>
          <button className="nav-item" type="button">
            Outlook folders
          </button>
          <p className="warn" style={{ marginTop: "1.5rem", fontSize: "0.78rem" }}>
            Fixture mode — no OAuth secrets required. See .env.example for live providers.
          </p>
        </aside>

        <section className="thread-list panel" aria-label="Thread list">
          {threads.map((t) => (
            <button
              key={`${t.accountId}:${t.id}`}
              type="button"
              className={`thread ${selectedId === t.id ? "selected" : ""} ${
                t.unreadCount > 0 ? "unread" : ""
              }`}
              onClick={() => setSelectedId(t.id)}
            >
              <div className="thread-top">
                <span className="thread-from">
                  {t.participants[0]?.name ?? t.participants[0]?.email ?? "Unknown"}
                  <span className="provider-pill">{t.provider}</span>
                </span>
                <span className="thread-meta">
                  {new Date(t.lastMessageAt).toLocaleString()}
                </span>
              </div>
              <div className="thread-subject">{t.subject}</div>
              <div className="thread-snippet">{t.snippet}</div>
            </button>
          ))}
        </section>

        <section className="reading-pane panel reading" aria-label="Reading pane">
          {message ? (
            <>
              <h1>{message.subject}</h1>
              <div className="meta">
                {message.from.name ?? message.from.email} · {message.date} ·{" "}
                {message.provider}
              </div>
              <div className="body">{message.bodyText ?? message.snippet}</div>
            </>
          ) : (
            <p className="meta">Select a thread. Keys: j/k navigate, e archive, c compose.</p>
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
          onClose={() => setComposeOpen(false)}
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
            setStatus("Sent via fixture provider + outbox");
          }}
        />
      )}

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
