import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type {
  ComposeDraft as DomainComposeDraft,
  MailLabel,
  MailMessage,
  MailThread,
  OutboxMutation,
  RemoteProcessingConsent,
} from "@galmail/core-api";
import {
  attachmentQuarantineReason,
  matchesMailSearch,
  parseMailSearch,
  toFts5Query,
} from "@galmail/core-api";
import { REMOTE_OPT_IN_DISCLOSURE_VERSION } from "@galmail/remote-opt-in";
import { isEditableTarget, resolveEscapeAction } from "@galmail/keyboard";
import {
  clearLiveGmailAccount,
  persistDemoMailboxPreference,
  shouldPromptGmailSignIn,
} from "./lib/account-session";
import {
  connectGmailWithPkce,
  disconnectGmailAccount,
  googleDesktopClientId,
  invokeErrorMessage,
} from "./lib/gmail-connect";
import { createGalMailRuntime, type GalMailRuntime } from "./lib/runtime";
import {
  DEFAULT_LAYOUT,
  loadPersistedSidebarCollapsed,
  loadPersistedTheme,
  persistSidebarCollapsed,
  persistTheme,
} from "./lib/themes";
import {
  capabilityForMessage,
  performUnsubscribe,
  unsubscribeButtonVisible,
  unsubscribeTooltip,
} from "./lib/unsubscribe";
import { CommandPalette } from "./components/CommandPalette";
import { ComposeModal, type ComposeDraft } from "./components/ComposeModal";
import {
  FloatingDrafts,
  type FloatingDraft,
} from "./components/FloatingDrafts";
import { Icons } from "./components/Icons";
import { RemoteOptInModal } from "./components/RemoteOptInModal";
import { type SettingsState } from "./components/SettingsBar";
import { ActionButton } from "./components/ActionButton";
import { SettingsPanel } from "./components/SettingsPanel";
import { SafeMailBody } from "./components/SafeMailBody";
import { SignInScreen } from "./components/SignInScreen";
import { StatusBar, type EditorMode } from "./components/StatusBar";

function formatMessageDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAddress(address: MailMessage["from"]): string {
  return address.name ? `${address.name} <${address.email}>` : address.email;
}

function MessageCard(props: {
  message: MailMessage;
  defaultExpanded: boolean;
  developerMode: boolean;
  theme: SettingsState["theme"];
  onDownloadAttachment: (
    message: MailMessage,
    attachment: NonNullable<MailMessage["attachments"]>[number],
  ) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(props.defaultExpanded);
  const detailsId = `message-details-${props.message.id}`;
  const sender = props.message.from.name ?? props.message.from.email;

  return (
    <article className="message-card">
      <button
        type="button"
        className="message-summary"
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="message-summary-main">
          <strong>{sender}</strong>
          <span>{props.message.snippet}</span>
        </span>
        <time dateTime={props.message.date}>
          {formatMessageDate(props.message.date)}
        </time>
        <span className="message-chevron" aria-hidden>
          {expanded ? <Icons.chevronUp /> : <Icons.chevronDown />}
        </span>
      </button>
      {expanded && (
        <div className="message-content" id={detailsId}>
          <dl className="participant-details">
            <div>
              <dt>From</dt>
              <dd>{formatAddress(props.message.from)}</dd>
            </div>
            <div>
              <dt>To</dt>
              <dd>{props.message.to.map(formatAddress).join(", ")}</dd>
            </div>
            {props.message.cc && props.message.cc.length > 0 && (
              <div>
                <dt>Cc</dt>
                <dd>{props.message.cc.map(formatAddress).join(", ")}</dd>
              </div>
            )}
            {props.message.bcc && props.message.bcc.length > 0 && (
              <div>
                <dt>Bcc</dt>
                <dd>{props.message.bcc.map(formatAddress).join(", ")}</dd>
              </div>
            )}
            <div>
              <dt>Date</dt>
              <dd>
                <time dateTime={props.message.date}>
                  {formatMessageDate(props.message.date)}
                </time>
              </dd>
            </div>
          </dl>
          <SafeMailBody
            html={props.message.bodyHtml}
            text={props.message.bodyText ?? props.message.snippet}
            sender={props.message.from.email}
            theme={props.theme}
          />
          {props.message.attachments &&
            props.message.attachments.length > 0 && (
              <ul className="message-attachments" aria-label="Attachments">
                {props.message.attachments.map((attachment) => {
                  const quarantine =
                    attachment.quarantineReason ??
                    attachmentQuarantineReason(attachment);
                  return (
                    <li key={attachment.id}>
                      <strong>
                        {attachment.filename || "Unnamed attachment"}
                      </strong>
                      <span>
                        {attachment.mimeType} ·{" "}
                        {attachment.size.toLocaleString()} bytes
                      </span>
                      {quarantine ? (
                        <span className="quarantine">
                          Quarantined: {quarantine}
                        </span>
                      ) : (
                        <ActionButton
                          label="Download to encrypted quarantine"
                          onClick={() =>
                            void props.onDownloadAttachment(
                              props.message,
                              attachment,
                            )
                          }
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          {props.developerMode && props.message.headers && (
            <details className="raw-headers">
              <summary>Raw headers</summary>
              <pre>
                {Object.entries(props.message.headers)
                  .map(([name, value]) => `${name}: ${value}`)
                  .join("\n")}
              </pre>
            </details>
          )}
        </div>
      )}
    </article>
  );
}

export function App() {
  const [runtime, setRuntime] = useState<GalMailRuntime | null>(null);
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [labels, setLabels] = useState<MailLabel[]>([]);
  const [outbox, setOutbox] = useState<OutboxMutation[]>([]);
  const [activeLabel, setActiveLabel] = useState<string>("INBOX");
  const [customLabelsOpen, setCustomLabelsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const [message, setMessage] = useState<MailMessage | null>(null);
  const [threadMessages, setThreadMessages] = useState<MailMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMessageIds, setSearchMessageIds] = useState<Set<string> | null>(
    null,
  );
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(new Set());
  const [listScrollTop, setListScrollTop] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeInitial, setComposeInitial] = useState<
    ComposeDraft | undefined
  >(undefined);
  const [drafts, setDrafts] = useState<FloatingDraft[]>([]);
  const [optInOpen, setOptInOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [gmailConnecting, setGmailConnecting] = useState(false);
  const [gmailConnectError, setGmailConnectError] = useState<string | null>(
    null,
  );
  const [awaitingSignIn, setAwaitingSignIn] = useState(() =>
    shouldPromptGmailSignIn(Boolean(googleDesktopClientId())),
  );
  const [status, setStatus] = useState(
    awaitingSignIn ? "Sign in to sync your inbox" : "Hydrating local inbox…",
  );
  const [inputMode, setInputMode] = useState<EditorMode>("normal");
  const [consent, setConsent] = useState<RemoteProcessingConsent | null>(null);
  const [settings, setSettings] = useState<SettingsState>(() => ({
    theme: loadPersistedTheme(),
    layout: DEFAULT_LAYOUT,
    developerMode: false,
    requestReadReceipt: false,
  }));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() =>
    loadPersistedSidebarCollapsed(),
  );
  const [, startTransition] = useTransition();
  const threadListRef = useRef<HTMLElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const undoRef = useRef<null | (() => Promise<void>)>(null);
  const inputModeRef = useRef<EditorMode>("normal");
  const selectedIdRef = useRef<string | null>(null);
  const filteredThreadsRef = useRef<MailThread[]>([]);
  const bulkAnchorIdRef = useRef<string | null>(null);
  const overlayRef = useRef({
    paletteOpen: false,
    composeOpen: false,
    optInOpen: false,
    settingsOpen: false,
  });
  inputModeRef.current = inputMode;
  selectedIdRef.current = selectedId;
  overlayRef.current = { paletteOpen, composeOpen, optInOpen, settingsOpen };

  useEffect(() => {
    if (bulkSelection.size === 0) bulkAnchorIdRef.current = null;
  }, [bulkSelection]);

  // Persist theme choice whenever it changes.
  useEffect(() => {
    persistTheme(settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    persistSidebarCollapsed(sidebarCollapsed);
  }, [sidebarCollapsed]);

  const hydrateRuntime = async (rt: GalMailRuntime) => {
    setRuntime(rt);
    setThreads(rt.threads);
    const accountLabels = await Promise.all(
      rt.accounts.map((account) =>
        account.provider.listLabels(account.accountId),
      ),
    );
    setLabels(accountLabels.flat());
    setSelectedId(rt.threads[0]?.id ?? null);
    setOpenedId(null);
    setBulkSelection(new Set());
    setStatus(
      rt.providerMode === "live"
        ? `Live hydrate complete · ${rt.threads.length} threads · syncing…`
        : `Local hydrate complete · ${rt.threads.length} threads · fixture`,
    );
    const c = await rt.remoteOptIn.getConsent(rt.gmailAccountId);
    setConsent(c);
    try {
      await rt.sync.pullDeltas(rt.gmailAccountId);
      if (rt.microsoftAccountId) {
        await rt.sync.pullDeltas(rt.microsoftAccountId);
      }
      await rt.sync.flushOutbox();
      // Prefer in-memory threads from the sync engine (avoids empty store races).
      const syncWithLocal = rt.sync as typeof rt.sync & {
        localThreads?: (accountId: (typeof rt.accounts)[number]["accountId"]) => MailThread[];
      };
      let nextThreads: MailThread[];
      if (typeof syncWithLocal.localThreads === "function") {
        nextThreads = rt.accounts
          .flatMap((account) => syncWithLocal.localThreads!(account.accountId))
          .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
      } else {
        const locals = await Promise.all(
          rt.accounts.map((account) => rt.sync.hydrateLocal(account.accountId)),
        );
        nextThreads = locals
          .flatMap((local) => local.threads)
          .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
      }
      setThreads(nextThreads);
      setSelectedId((current) => current ?? nextThreads[0]?.id ?? null);
      const refreshedLabels = await Promise.all(
        rt.accounts.map((account) =>
          account.provider.listLabels(account.accountId),
        ),
      );
      setLabels(refreshedLabels.flat());
      setStatus(
        rt.providerMode === "live"
          ? `Live sync complete · ${nextThreads.length} threads`
          : `Local hydrate complete · ${nextThreads.length} threads · fixture · deltas applied`,
      );
    } catch (error) {
      setStatus(invokeErrorMessage(error, "Inbox sync failed"));
    }
  };

  useEffect(() => {
    if (awaitingSignIn) return;
    let cancelled = false;
    (async () => {
      const rt = await createGalMailRuntime();
      if (cancelled) return;
      await hydrateRuntime(rt);
    })();
    return () => {
      cancelled = true;
    };
  }, [awaitingSignIn]);

  useEffect(() => {
    if (!runtime) return;
    const flush = () => void runtime.sync.flushOutbox();
    const interval = setInterval(flush, 15_000);
    window.addEventListener("online", flush);
    return () => {
      clearInterval(interval);
      window.removeEventListener("online", flush);
    };
  }, [runtime]);

  useEffect(() => {
    if (!runtime) return;
    const refresh = () =>
      void runtime.sync.listOutbox().then((items) => setOutbox(items));
    refresh();
    return runtime.sync.observe((event) => {
      if (event.type === "outbox") refresh();
    });
  }, [runtime]);

  useEffect(() => {
    if (!runtime || !openedId) {
      setMessage(null);
      setThreadMessages([]);
      return;
    }
    const thread = threads.find((t) => t.id === openedId);
    if (!thread) return;
    const account = runtime.accounts.find(
      (a) => a.accountId === thread.accountId,
    );
    if (!account) return;
    if (thread.messageIds.length === 0) return;
    Promise.all(
      thread.messageIds.map((id) =>
        account.provider.getMessage(thread.accountId, id),
      ),
    ).then((messages) => {
      const ordered = messages.sort((a, b) => a.date.localeCompare(b.date));
      setThreadMessages(ordered);
      setMessage(ordered.at(-1) ?? null);
    });
  }, [runtime, openedId, threads]);

  const selectedIndex = useMemo(
    () => threads.findIndex((t) => t.id === selectedId),
    [threads, selectedId],
  );

  const focusThreadList = () => {
    threadListRef.current?.focus();
  };

  const enterInsertMode = () => {
    setInputMode("insert");
    requestAnimationFrame(() => searchInputRef.current?.focus());
  };

  const enterNormalMode = () => {
    setInputMode("normal");
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
    searchInputRef.current?.blur();
    const overlays = overlayRef.current;
    if (
      overlays.composeOpen ||
      overlays.paletteOpen ||
      overlays.settingsOpen ||
      overlays.optInOpen
    ) {
      return;
    }
    requestAnimationFrame(() => focusThreadList());
  };

  useEffect(() => {
    if (!runtime) return;
    const reg = runtime.commands;

    const selectedThread = () => {
      const id = selectedIdRef.current;
      if (!id) return undefined;
      return (
        filteredThreadsRef.current.find((thread) => thread.id === id) ??
        threads.find((thread) => thread.id === id)
      );
    };

    const archiveSelected = () => {
      const thread = selectedThread();
      if (!thread?.messageIds[0]) return;
      startTransition(() => {
        setThreads((prev) =>
          prev.map((item) =>
            item.id === thread.id
              ? {
                  ...item,
                  labelIds: item.labelIds.filter((label) => label !== "INBOX"),
                }
              : item,
          ),
        );
        setSelectedId((id) => {
          const list = filteredThreadsRef.current;
          const idx = list.findIndex((item) => item.id === thread.id);
          const next = list[idx + 1] ?? list[idx - 1];
          return id === thread.id ? (next?.id ?? null) : id;
        });
        setOpenedId((id) => (id === thread.id ? null : id));
      });
      void runtime.sync
        .enqueue({
          accountId: thread.accountId,
          kind: "archive",
          targetIds: [thread.messageIds[0]],
          availableAt: new Date(Date.now() + 5_000).toISOString(),
          undoUntil: new Date(Date.now() + 5_000).toISOString(),
        })
        .then((mutation) => {
          undoRef.current = async () => {
            await runtime.sync.cancelOutbox(mutation.id);
            setThreads((items) =>
              items.map((item) => (item.id === thread.id ? thread : item)),
            );
            setStatus("Archive undone");
          };
          setTimeout(
            () => void runtime.sync.flushOutbox(thread.accountId),
            5_000,
          );
          setStatus("Archived · Undo available for 5 seconds");
        });
    };

    const toggleReadSelected = () => {
      const thread = selectedThread();
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
        .then(() => setStatus(markingUnread ? "Marked unread" : "Marked read"));
    };

    const goToInbox = () => {
      setPaletteOpen(false);
      setComposeOpen(false);
      setOptInOpen(false);
      setSettingsOpen(false);
      setSelectedId(threads[0]?.id ?? null);
      setActiveLabel("INBOX");
      setOpenedId(null);
      setStatus("Inbox");
      requestAnimationFrame(() => focusThreadList());
    };

    const handleBack = () => {
      const overlays = overlayRef.current;
      if (overlays.paletteOpen) {
        setPaletteOpen(false);
        requestAnimationFrame(() => focusThreadList());
        return;
      }
      if (overlays.composeOpen) {
        setComposeOpen(false);
        setInputMode("normal");
        requestAnimationFrame(() => focusThreadList());
        return;
      }
      if (overlays.optInOpen) {
        setOptInOpen(false);
        requestAnimationFrame(() => focusThreadList());
        return;
      }
      if (overlays.settingsOpen) {
        setSettingsOpen(false);
        requestAnimationFrame(() => focusThreadList());
        return;
      }
      if (openedId) {
        setOpenedId(null);
        setStatus("Back to inbox");
        requestAnimationFrame(() => focusThreadList());
        return;
      }
      focusThreadList();
    };

    reg.on("navigate_down", () => {
      const list = filteredThreadsRef.current;
      const idx = list.findIndex((thread) => thread.id === selectedIdRef.current);
      const next = list[Math.min(list.length - 1, Math.max(0, idx) + 1)];
      if (next) {
        setSelectedId(next.id);
        if (openedId) setOpenedId(next.id);
      }
    });
    reg.on("navigate_up", () => {
      const list = filteredThreadsRef.current;
      const idx = list.findIndex((thread) => thread.id === selectedIdRef.current);
      const prev = list[Math.max(0, (idx < 0 ? 0 : idx) - 1)];
      if (prev) {
        setSelectedId(prev.id);
        if (openedId) setOpenedId(prev.id);
      }
    });
    reg.on("open_thread", () => {
      const thread = selectedThread();
      if (!thread) return;
      setOpenedId(thread.id);
      setStatus(`Opened ${thread.subject}`);
    });
    reg.on("archive", archiveSelected);
    reg.on("trash", () => {
      const current = selectedThread();
      const targets = bulkSelection.size
        ? threads.filter((thread) => bulkSelection.has(thread.id))
        : current
          ? [current]
          : [];
      if (!targets.length) return;
      setThreads((items) =>
        items.map((item) =>
          targets.some((target) => target.id === item.id)
            ? { ...item, labelIds: ["TRASH" as never] }
            : item,
        ),
      );
      void Promise.all(
        targets.map((thread) =>
          runtime.sync.enqueue({
            accountId: thread.accountId,
            kind: "trash",
            targetIds: thread.messageIds,
            availableAt: new Date(Date.now() + 5_000).toISOString(),
            undoUntil: new Date(Date.now() + 5_000).toISOString(),
          }),
        ),
      ).then((mutations) => {
        undoRef.current = async () => {
          await Promise.all(
            mutations.map((mutation) => runtime.sync.cancelOutbox(mutation.id)),
          );
          setThreads((items) =>
            items.map((item) => {
              const original = targets.find((target) => target.id === item.id);
              return original ?? item;
            }),
          );
          setStatus("Trash undone");
        };
        setTimeout(() => void runtime.sync.flushOutbox(), 5_000);
        setBulkSelection(new Set());
        setStatus(
          `Moved ${targets.length} thread(s) to Trash · Undo available`,
        );
      });
    });
    reg.on("mark_read_toggle", toggleReadSelected);
    reg.on("compose", () => {
      setComposeInitial(undefined);
      setComposeOpen(true);
      setInputMode("insert");
    });
    reg.on("reply", () => {
      if (!message) return;
      openCompose({
        to: message.from.email,
        subject: message.subject.startsWith("Re:")
          ? message.subject
          : `Re: ${message.subject}`,
        body: "",
        inReplyTo: message.id,
        references: [...(message.references ?? []), message.id],
      });
      setInputMode("insert");
    });
    reg.on("command_palette", () => setPaletteOpen(true));
    reg.on("search", () => enterInsertMode());
    reg.on("enter_insert", () => enterInsertMode());
    reg.on("enter_normal", () => enterNormalMode());
    reg.on("undo", () => {
      const undo = undoRef.current;
      if (!undo) return setStatus("Nothing to undo");
      undoRef.current = null;
      void undo();
    });
    reg.on("go_to_inbox", goToInbox);
    reg.on("toggle_sidebar", () => {
      setSidebarCollapsed((value) => !value);
    });
    reg.on("back", handleBack);

    const onKey = (e: KeyboardEvent) => {
      const editable = isEditableTarget(e.target);
      const overlays = overlayRef.current;

      // Escape: Insert → Normal first; only Normal dismisses overlays / back.
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        const action = resolveEscapeAction({
          mode: inputModeRef.current,
          editableFocused: editable,
        });
        if (action === "enter_normal") {
          enterNormalMode();
          return;
        }
        handleBack();
        return;
      }

      // Don't steal typing in compose/search fields for other shortcuts.
      if (editable) return;

      // Insert mode: only meta/ctrl chords (e.g. ⌘K) still run until Esc.
      if (
        inputModeRef.current === "insert" &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        return;
      }

      // Compose owns Normal-mode j/k/i/Enter field navigation.
      if (overlays.composeOpen && !e.metaKey && !e.ctrlKey) {
        return;
      }

      // Other overlays: don't run inbox list shortcuts underneath.
      if (
        (overlays.paletteOpen ||
          overlays.settingsOpen ||
          overlays.optInOpen) &&
        !e.metaKey &&
        !e.ctrlKey
      ) {
        return;
      }

      // Enter opens a thread from the list; when already reading, it replies.
      const id = reg.match(
        {
          key: e.key,
          metaKey: e.metaKey,
          ctrlKey: e.ctrlKey,
          altKey: e.altKey,
          shiftKey: e.shiftKey,
        },
        { activeScope: openedId ? "thread" : "list" },
      );
      if (!id || id === "back") return;
      if (
        (id === "open_thread" || id === "reply") &&
        e.target instanceof Element &&
        e.target.closest("button, a, [role='button']")
      ) {
        return;
      }
      e.preventDefault();
      reg.dispatch(id);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      reg.clearPending();
    };
  }, [
    runtime,
    threads,
    selectedIndex,
    selectedId,
    openedId,
    message,
    bulkSelection,
  ]);

  const layout = settings.layout;
  const fullscreenList = layout === "fullscreen" && !openedId;
  const unsubscribeCapability = useMemo(
    () => (message ? capabilityForMessage(message) : null),
    [message],
  );

  const updateSettings = (next: Partial<SettingsState>) =>
    setSettings((cur) => ({ ...cur, ...next }));

  const customLabels = useMemo(
    () =>
      labels
        .filter(
          (label) => label.kind === "label" || label.kind === "category",
        )
        .slice(0, 12),
    [labels],
  );

  const filteredThreads = useMemo(() => {
    const scoped =
      activeLabel === "ALL"
        ? threads
        : activeLabel === "ARCHIVE"
          ? threads.filter(
              (thread) =>
                !thread.labelIds.includes("INBOX" as never) &&
                !thread.labelIds.includes("TRASH" as never) &&
                !thread.labelIds.includes("SPAM" as never),
            )
          : threads.filter((thread) =>
              thread.labelIds.includes(activeLabel as never),
            );
    if (!searchQuery.trim()) return scoped;
    const query = parseMailSearch(searchQuery);
    return scoped.filter((thread) => {
      if (
        searchMessageIds &&
        !thread.messageIds.some((id) => searchMessageIds.has(id))
      ) {
        return false;
      }
      const synthetic: MailMessage = {
        id: thread.messageIds[0]!,
        threadId: thread.id,
        accountId: thread.accountId,
        provider: thread.provider,
        subject: thread.subject,
        snippet: thread.snippet,
        from: thread.participants[0] ?? { email: "unknown@invalid" },
        to: thread.participants.slice(1),
        date: thread.lastMessageAt,
        unread: thread.unreadCount > 0,
        starred: thread.labelIds.includes("STARRED" as never),
        labelIds: thread.labelIds,
        hasAttachments: false,
      };
      return matchesMailSearch(synthetic, thread, query);
    });
  }, [threads, searchQuery, searchMessageIds, activeLabel]);
  filteredThreadsRef.current = filteredThreads;
  const bulkSelecting = bulkSelection.size > 0;

  const applyBulkRangeSelect = (threadId: string) => {
    const list = filteredThreads;
    const toIdx = list.findIndex((thread) => thread.id === threadId);
    if (toIdx < 0) return;
    const anchorId = bulkAnchorIdRef.current ?? selectedId ?? threadId;
    let fromIdx = list.findIndex((thread) => thread.id === anchorId);
    if (fromIdx < 0) fromIdx = toIdx;
    if (!bulkAnchorIdRef.current) {
      bulkAnchorIdRef.current = list[fromIdx]?.id ?? threadId;
    }
    const start = Math.min(fromIdx, toIdx);
    const end = Math.max(fromIdx, toIdx);
    setBulkSelection(
      new Set(list.slice(start, end + 1).map((thread) => thread.id)),
    );
  };

  const virtualStart = Math.max(0, Math.floor(listScrollTop / 92) - 8);
  const virtualThreads = filteredThreads.slice(virtualStart, virtualStart + 60);

  useEffect(() => {
    if (!runtime || !searchQuery.trim()) {
      setSearchMessageIds(null);
      return;
    }
    const parsed = parseMailSearch(searchQuery);
    if (!toFts5Query(parsed)) {
      setSearchMessageIds(null);
      return;
    }
    let cancelled = false;
    Promise.all(
      runtime.accounts.map((account) =>
        runtime.sync.searchLocal(account.accountId, searchQuery),
      ),
    ).then((ids) => {
      if (!cancelled) setSearchMessageIds(new Set(ids.flat()));
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, searchQuery]);

  const openCompose = (initial?: ComposeDraft) => {
    setComposeInitial(initial);
    setComposeOpen(true);
    setInputMode("insert");
  };

  const minimizeCompose = (draft: ComposeDraft) => {
    const id = `draft_${Date.now()}`;
    setDrafts((items) => [
      ...items,
      { id, to: draft.to, subject: draft.subject, body: draft.body },
    ]);
    setComposeOpen(false);
    setComposeInitial(undefined);
    setInputMode("normal");
    setStatus(
      `Draft minimized (${drafts.length + 1} floating draft${drafts.length ? "s" : ""})`,
    );
  };

  const expandDraft = (id: string) => {
    const d = drafts.find((x) => x.id === id);
    if (!d) return;
    openCompose({ to: d.to, subject: d.subject, body: d.body });
    setDrafts((items) => items.filter((x) => x.id !== id));
  };

  const closeDraft = (id: string) =>
    setDrafts((items) => items.filter((x) => x.id !== id));

  const connectGmail = async () => {
    setGmailConnectError(null);
    setGmailConnecting(true);
    setStatus("Opening Google sign-in…");
    try {
      const connected = await connectGmailWithPkce();
      setAwaitingSignIn(false);
      setStatus(`Connected ${connected.email} · syncing…`);
      const next = await createGalMailRuntime();
      await hydrateRuntime(next);
      setSettingsOpen(false);
    } catch (error) {
      const message = invokeErrorMessage(error, "Google sign-in failed");
      setGmailConnectError(message);
      setStatus(message);
    } finally {
      setGmailConnecting(false);
    }
  };

  const useDemoMailbox = async () => {
    persistDemoMailboxPreference();
    setAwaitingSignIn(false);
    setGmailConnectError(null);
    setStatus("Loading demo mailbox…");
  };

  const domainDraft = (draft: ComposeDraft): DomainComposeDraft => {
    const addresses = (value?: string) =>
      (value ?? "")
        .split(",")
        .map((email) => email.trim())
        .filter(Boolean)
        .map((email) => ({ email }));
    const accountEmail =
      runtime!.accounts.find(
        (account) => account.accountId === runtime!.gmailAccountId,
      )?.email ?? "me";
    // Empty alias input is "" — must not win over the connected account via ??.
    const fromEmail = draft.alias?.trim() || accountEmail;
    return {
      id: draft.id ?? `draft_${crypto.randomUUID()}`,
      accountId: runtime!.gmailAccountId,
      to: addresses(draft.to),
      cc: addresses(draft.cc),
      bcc: addresses(draft.bcc),
      subject: draft.subject,
      bodyHtml: `<p>${draft.body.replace(/\n/g, "<br>")}</p>`,
      bodyText: draft.body,
      alias: { email: fromEmail },
      signature: draft.signature,
      attachments: draft.attachments,
      requestReadReceipt: draft.requestReadReceipt,
      inReplyTo: draft.inReplyTo as DomainComposeDraft["inReplyTo"],
      references: draft.references,
      updatedAt: new Date().toISOString(),
    };
  };

  const mutateOpened = async (
    kind: "star" | "unstar" | "spam" | "snooze" | "apply_label",
    payload?: Record<string, unknown>,
  ) => {
    if (!runtime || !message) return;
    const undoUntil = new Date(Date.now() + 5_000).toISOString();
    const mutation = await runtime.sync.enqueue({
      accountId: message.accountId,
      kind,
      targetIds: threadMessages.map((item) => item.id),
      payload,
      availableAt: undoUntil,
      undoUntil,
    });
    const wakeMutation =
      kind === "snooze" && typeof payload?.until === "string"
        ? await runtime.sync.enqueue({
            accountId: message.accountId,
            kind: "apply_label",
            targetIds: threadMessages.map((item) => item.id),
            payload: { labelId: "INBOX", snoozeWake: true },
            availableAt: payload.until,
          })
        : undefined;
    if (kind === "star" || kind === "unstar") {
      setMessage((current) =>
        current ? { ...current, starred: kind === "star" } : current,
      );
    }
    if (kind === "snooze") {
      setThreads((items) =>
        items.map((item) =>
          item.id === message.threadId
            ? {
                ...item,
                labelIds: item.labelIds.filter((id) => id !== "INBOX"),
              }
            : item,
        ),
      );
    }
    undoRef.current = async () => {
      await runtime.sync.cancelOutbox(mutation.id);
      if (wakeMutation) await runtime.sync.cancelOutbox(wakeMutation.id);
      setMessage((current) =>
        current && (kind === "star" || kind === "unstar")
          ? { ...current, starred: kind !== "star" }
          : current,
      );
      if (kind === "snooze") {
        setThreads((items) =>
          items.map((item) =>
            item.id === message.threadId
              ? {
                  ...item,
                  labelIds: [...new Set([...item.labelIds, "INBOX" as never])],
                }
              : item,
          ),
        );
      }
      setStatus("Action undone");
    };
    setTimeout(() => void runtime.sync.flushOutbox(message.accountId), 5_000);
    setStatus(`${kind.replace("_", " ")} queued · Undo available`);
  };

  const bulkMutate = async (
    kind:
      "archive" | "mark_read" | "mark_unread" | "apply_label" | "move_folder",
    payload?: Record<string, unknown>,
  ) => {
    if (!runtime || bulkSelection.size === 0) return;
    const targets = threads.filter((thread) => bulkSelection.has(thread.id));
    await Promise.all(
      targets.map((thread) =>
        runtime.sync.enqueue({
          accountId: thread.accountId,
          kind,
          targetIds: thread.messageIds,
          payload,
        }),
      ),
    );
    setThreads((items) =>
      items.map((item) => {
        if (!bulkSelection.has(item.id)) return item;
        if (kind === "archive") {
          return {
            ...item,
            labelIds: item.labelIds.filter((id) => id !== "INBOX"),
          };
        }
        if (kind === "mark_read" || kind === "mark_unread") {
          return { ...item, unreadCount: kind === "mark_read" ? 0 : 1 };
        }
        const labelId = String(payload?.labelId ?? "");
        return kind === "move_folder"
          ? { ...item, labelIds: [labelId as never] }
          : {
              ...item,
              labelIds: [...new Set([...item.labelIds, labelId as never])],
            };
      }),
    );
    await runtime.sync.flushOutbox();
    setStatus(
      `${kind.replace("_", " ")} applied to ${targets.length} thread(s)`,
    );
    setBulkSelection(new Set());
  };

  const handleUnsubscribe = async () => {
    if (!runtime || !message) return;
    const result = await performUnsubscribe(message);
    if (result.status === "cancelled") return;
    if (result.status === "error") {
      setStatus(result.detail);
      return;
    }
    if (result.status === "mailto") {
      const draft = {
        ...domainDraft({
          to: result.draft.to,
          subject: result.draft.subject,
          body: result.draft.body,
        }),
        accountId: message.accountId,
      };
      const undoUntil = new Date(Date.now() + 5_000).toISOString();
      const mutation = await runtime.sync.enqueue({
        accountId: message.accountId,
        kind: "send",
        targetIds: [],
        payload: { draft } as unknown as Record<string, unknown>,
        availableAt: undoUntil,
        undoUntil,
      });
      undoRef.current = async () => {
        await runtime.sync.cancelOutbox(mutation.id);
        setStatus("Unsubscribe send cancelled");
      };
      setTimeout(
        () => void runtime.sync.flushOutbox(message.accountId),
        5_000,
      );
      setStatus(`${result.detail} · Undo available for 5 seconds`);
      return;
    }
    setStatus(result.detail);
  };

  const sendDraft = async (id: string) => {
    const d = drafts.find((x) => x.id === id);
    if (!d || !runtime) return;
    const draft = domainDraft(d);
    const undoUntil = new Date(Date.now() + 5_000).toISOString();
    const mutation = await runtime.sync.enqueue({
      accountId: runtime.gmailAccountId,
      kind: "send",
      targetIds: [],
      payload: { draft } as unknown as Record<string, unknown>,
      availableAt: undoUntil,
      undoUntil,
    });
    setDrafts((x) => x.filter((p) => p.id !== id));
    undoRef.current = async () => {
      await runtime.sync.cancelOutbox(mutation.id);
      setDrafts((items) => [...items, d]);
      setStatus("Send cancelled");
    };
    setTimeout(
      () => void runtime.sync.flushOutbox(runtime.gmailAccountId),
      5_000,
    );
    setStatus("Send queued · Undo available for 5 seconds");
  };

  if (awaitingSignIn) {
    return (
      <div className="app" data-theme={settings.theme}>
        <SignInScreen
          connecting={gmailConnecting}
          error={gmailConnectError}
          canConnectGmail={Boolean(googleDesktopClientId())}
          showDemoOption
          onConnectGmail={() => void connectGmail()}
          onUseDemo={() => void useDemoMailbox()}
        />
      </div>
    );
  }

  if (!runtime) {
    return (
      <div className="app" data-theme={settings.theme}>
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
    <div
      className="app"
      data-theme={settings.theme}
      data-layout={settings.layout}
      data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
    >
      <header className="topbar">
        <div className="brand">
          <div className="brand-name">GalMail</div>
          <div className="brand-tag">Unified inbox</div>
        </div>
        <div className="top-actions">
          <ActionButton
            label="Commands"
            icon={<Icons.command />}
            command="command_palette"
            onClick={() => setPaletteOpen(true)}
          />
          <ActionButton
            label="Compose"
            icon={<Icons.compose />}
            command="compose"
            onClick={() => openCompose()}
          />
          <ActionButton
            className="settings-top-trigger"
            label="Settings and account"
            icon={<Icons.settings />}
            iconOnly
            onClick={() => setSettingsOpen(true)}
          />
        </div>
      </header>

      <div className="shell">
        <aside className="sidebar panel" aria-label="Folders">
          <div className="sidebar-main">
            <ActionButton
              className={`nav-item ${activeLabel === "INBOX" ? "active" : ""}`}
              variant="quiet"
              label="Unified inbox"
              icon={<Icons.inbox />}
              command="go_to_inbox"
              onClick={() => runtime.commands.dispatch("go_to_inbox")}
            />
            <ActionButton
              className={`nav-item ${activeLabel === "ARCHIVE" ? "active" : ""}`}
              variant="quiet"
              label="Archive"
              icon={<Icons.archive />}
              onClick={() => setActiveLabel("ARCHIVE")}
            />
            <ActionButton
              className={`nav-item ${activeLabel === "STARRED" ? "active" : ""}`}
              variant="quiet"
              label="Starred"
              icon={<Icons.star />}
              onClick={() => setActiveLabel("STARRED")}
            />
            <ActionButton
              className={`nav-item ${activeLabel === "TRASH" ? "active" : ""}`}
              variant="quiet"
              label="Trash"
              icon={<Icons.trash />}
              onClick={() => setActiveLabel("TRASH")}
            />
            <ActionButton
              className={`nav-item ${activeLabel === "SPAM" ? "active" : ""}`}
              variant="quiet"
              label="Spam"
              icon={<Icons.warning />}
              onClick={() => setActiveLabel("SPAM")}
            />
            {customLabels.length > 0 && (
              <div className="sidebar-labels">
                <button
                  type="button"
                  className="sidebar-labels-toggle"
                  aria-expanded={customLabelsOpen}
                  onClick={() => setCustomLabelsOpen((value) => !value)}
                >
                  <span className="sidebar-labels-toggle-icon" aria-hidden>
                    <Icons.chevronDown />
                  </span>
                  <span className="sidebar-labels-toggle-label">Labels</span>
                  <span className="sidebar-labels-toggle-count">
                    {customLabels.length}
                  </span>
                </button>
                {customLabelsOpen ? (
                  <div className="sidebar-labels-list">
                    {customLabels.map((label) => (
                      <ActionButton
                        key={`${label.providerNativeId}:${label.id}`}
                        className={`nav-item ${activeLabel === label.id ? "active" : ""}`}
                        variant="quiet"
                        label={label.name}
                        icon={<Icons.tag />}
                        showShortcut={false}
                        onClick={() => setActiveLabel(label.id)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            )}
            {drafts.length > 0 && (
              <ActionButton
                className="nav-item"
                variant="quiet"
                label={`Drafts · ${drafts.length}`}
                icon={<Icons.drafts />}
                tooltip="Floating drafts from minimized compose windows"
                showShortcut={false}
              />
            )}
            {outbox
              .filter(
                (item) => item.status === "pending" || item.status === "failed",
              )
              .slice(0, 5)
              .map((item) => (
                <div className="outbox-item" key={item.id}>
                  <span>
                    {item.kind.replace("_", " ")} · {item.status}
                    {item.attempts ? ` · attempt ${item.attempts}` : ""}
                    {item.lastError ? ` · ${item.lastError}` : ""}
                  </span>
                  {item.status === "failed" ? (
                    <ActionButton
                      label="Retry"
                      onClick={async () => {
                        await runtime.sync.retryOutbox(item.id);
                        await runtime.sync.flushOutbox(item.accountId);
                      }}
                    />
                  ) : (
                    <ActionButton
                      label="Cancel"
                      onClick={() => void runtime.sync.cancelOutbox(item.id)}
                    />
                  )}
                </div>
              ))}
          </div>
          <div className="sidebar-footer">
            <ActionButton
              className="nav-item settings-entry"
              variant="quiet"
              label="Settings"
              icon={<Icons.settings />}
              showShortcut={false}
              onClick={() => setSettingsOpen(true)}
            />
            <ActionButton
              className="sidebar-collapse-toggle"
              variant="quiet"
              label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              icon={
                sidebarCollapsed ? (
                  <Icons.chevronRight />
                ) : (
                  <Icons.chevronLeft />
                )
              }
              iconOnly
              command="toggle_sidebar"
              aria-expanded={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed((value) => !value)}
            />
          </div>
        </aside>

        <section
          className="thread-list panel"
          aria-label="Thread list"
          tabIndex={-1}
          ref={threadListRef}
          onScroll={(event) => setListScrollTop(event.currentTarget.scrollTop)}
          data-fullscreen={fullscreenList ? "true" : "false"}
        >
          {!(layout === "fullscreen" && openedId) && (
            <div className="thread-list-head">
              <label className="thread-search">
                <span className="sr-only">Search mail</span>
                <span className="thread-search-icon" aria-hidden="true">
                  <Icons.search />
                </span>
                <input
                  ref={searchInputRef}
                  className="field-input"
                  type="search"
                  placeholder="Search · from: subject: label:"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onFocus={() => setInputMode("insert")}
                />
              </label>
              <div className="thread-list-meta">
                <span className="thread-list-title">{activeLabel}</span>
                <span className="thread-list-count">
                  {filteredThreads.filter((t) => t.unreadCount > 0).length}{" "}
                  unread · {filteredThreads.length}
                </span>
              </div>
            </div>
          )}
          <div
            className={`bulk-toolbar ${bulkSelection.size > 0 ? "is-active" : ""}`}
            aria-label="Bulk actions"
            aria-hidden={bulkSelection.size === 0}
          >
            <span className="bulk-toolbar-count">
              {bulkSelection.size > 0
                ? `${bulkSelection.size} selected`
                : "Select threads"}
            </span>
            <div className="bulk-toolbar-actions">
              <ActionButton
                label="Archive selected"
                icon={<Icons.archive />}
                disabled={bulkSelection.size === 0}
                onClick={() => void bulkMutate("archive")}
              />
              <ActionButton
                label="Mark selected read"
                icon={<Icons.mailOpen />}
                disabled={bulkSelection.size === 0}
                onClick={() => void bulkMutate("mark_read")}
              />
              {labels.find((label) => label.kind === "label") && (
                <ActionButton
                  label={`Apply ${labels.find((label) => label.kind === "label")!.name}`}
                  icon={<Icons.tag />}
                  disabled={bulkSelection.size === 0}
                  onClick={() =>
                    void bulkMutate("apply_label", {
                      labelId: labels.find((label) => label.kind === "label")!
                        .id,
                    })
                  }
                />
              )}
            </div>
          </div>
          <div aria-hidden style={{ height: virtualStart * 92 }} />
          {virtualThreads.map((t) => {
            const name =
              t.participants[0]?.name ?? t.participants[0]?.email ?? "Unknown";
            return (
              <div
                className={`thread-shell${bulkSelecting ? " is-selecting" : ""}`}
                key={`${t.accountId}:${t.id}`}
              >
                <label className="bulk-select" aria-hidden={!bulkSelecting}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.subject}`}
                    checked={bulkSelection.has(t.id)}
                    tabIndex={bulkSelecting ? 0 : -1}
                    disabled={!bulkSelecting}
                    onChange={(event) =>
                      setBulkSelection((current) => {
                        const next = new Set(current);
                        if (event.target.checked) {
                          next.add(t.id);
                          bulkAnchorIdRef.current = t.id;
                        } else {
                          next.delete(t.id);
                        }
                        return next;
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className={`thread ${selectedId === t.id ? "selected" : ""} ${
                    t.unreadCount > 0 ? "unread" : ""
                  }`}
                  aria-current={selectedId === t.id ? "true" : undefined}
                  title={`Open ${t.subject} · Enter`}
                  onClick={(event) => {
                    if (event.shiftKey) {
                      event.preventDefault();
                      applyBulkRangeSelect(t.id);
                      setSelectedId(t.id);
                      return;
                    }
                    setSelectedId(t.id);
                    setOpenedId(t.id);
                  }}
                >
                  <div className="thread-row">
                    <div className="thread-main">
                      <div className="thread-top">
                        <span className="thread-from">
                          {name}
                          <span className="provider-pill">{t.provider}</span>
                        </span>
                        <span className="thread-meta">
                          {new Date(t.lastMessageAt).toLocaleDateString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                            },
                          )}
                        </span>
                      </div>
                      <div className="thread-subject">{t.subject}</div>
                      <div className="thread-snippet">{t.snippet}</div>
                    </div>
                  </div>
                </button>
              </div>
            );
          })}
          <div
            aria-hidden
            style={{
              height:
                Math.max(
                  0,
                  filteredThreads.length - virtualStart - virtualThreads.length,
                ) * 92,
            }}
          />
        </section>

        <section
          className="reading-pane panel reading"
          aria-label="Reading pane"
          data-fullscreen={
            layout === "fullscreen" && openedId ? "true" : "false"
          }
        >
          {message ? (
            <>
              {layout === "fullscreen" && (
                <ActionButton
                  className="back-btn"
                  label="Back to inbox"
                  icon={<Icons.back />}
                  command="back"
                  onClick={() => setOpenedId(null)}
                />
              )}
              <div className="reading-toolbar">
                <ActionButton
                  label="Archive"
                  icon={<Icons.archive />}
                  command="archive"
                  onClick={() => runtime.commands.dispatch("archive")}
                />
                <ActionButton
                  label={message.unread ? "Mark read" : "Mark unread"}
                  icon={
                    message.unread ? <Icons.mailOpen /> : <Icons.mail />
                  }
                  command="mark_read_toggle"
                  onClick={() => runtime.commands.dispatch("mark_read_toggle")}
                />
                <ActionButton
                  label="Reply"
                  icon={<Icons.reply />}
                  command="reply"
                  onClick={() => runtime.commands.dispatch("reply")}
                />
                <ActionButton
                  label="Reply all"
                  icon={<Icons.replyAll />}
                  onClick={() =>
                    openCompose({
                      to: [
                        message.from.email,
                        ...message.to.map((address) => address.email),
                      ].join(", "),
                      cc: message.cc
                        ?.map((address) => address.email)
                        .join(", "),
                      subject: message.subject.startsWith("Re:")
                        ? message.subject
                        : `Re: ${message.subject}`,
                      body: "",
                      inReplyTo: message.id,
                      references: [...(message.references ?? []), message.id],
                    })
                  }
                />
                <ActionButton
                  label="Forward"
                  icon={<Icons.forward />}
                  onClick={() =>
                    openCompose({
                      to: "",
                      subject: message.subject.startsWith("Fwd:")
                        ? message.subject
                        : `Fwd: ${message.subject}`,
                      body: `\n\n---------- Forwarded message ----------\nFrom: ${formatAddress(message.from)}\nDate: ${message.date}\nSubject: ${message.subject}\nTo: ${message.to.map(formatAddress).join(", ")}\n${message.attachments?.length ? `Attachments (download before forwarding): ${message.attachments.map((item) => item.filename).join(", ")}\n` : ""}\n${message.bodyText ?? message.snippet}`,
                    })
                  }
                />
                <ActionButton
                  label={message.starred ? "Unstar" : "Star"}
                  icon={<Icons.star />}
                  onClick={() =>
                    void mutateOpened(message.starred ? "unstar" : "star")
                  }
                />
                <ActionButton
                  label="Snooze until tomorrow"
                  icon={<Icons.snooze />}
                  command="snooze"
                  onClick={() =>
                    void mutateOpened("snooze", {
                      until: new Date(Date.now() + 86_400_000).toISOString(),
                    })
                  }
                />
                <ActionButton
                  label="Report spam"
                  icon={<Icons.warning />}
                  onClick={() => void mutateOpened("spam")}
                />
                {unsubscribeCapability &&
                  unsubscribeButtonVisible(unsubscribeCapability) && (
                    <ActionButton
                      label="Unsubscribe"
                      icon={<Icons.unsubscribe />}
                      tooltip={unsubscribeTooltip(unsubscribeCapability)}
                      onClick={() => void handleUnsubscribe()}
                    />
                  )}
              </div>
              <h1>{message.subject}</h1>
              <div className="conversation-heading">
                <span>
                  {threadMessages.length}{" "}
                  {threadMessages.length === 1 ? "message" : "messages"}
                </span>
                <span className="provider-pill">{message.provider}</span>
              </div>
              <div className="conversation" aria-label="Conversation history">
                {threadMessages.map((item, index) => (
                  <MessageCard
                    key={item.id}
                    message={item}
                    defaultExpanded={index === threadMessages.length - 1}
                    developerMode={settings.developerMode}
                    theme={settings.theme}
                    onDownloadAttachment={async (source, attachment) => {
                      const account = runtime.accounts.find(
                        (item) => item.accountId === source.accountId,
                      );
                      if (!account) return;
                      const stream = account.provider.fetchAttachment(
                        source.accountId,
                        attachment,
                      );
                      if (runtime.nativeStore) {
                        const size =
                          await runtime.nativeStore.putAttachmentStream(
                            source.accountId,
                            attachment.id,
                            stream,
                          );
                        setStatus(
                          `Stored ${attachment.filename} (${size.toLocaleString()} bytes) in encrypted quarantine`,
                        );
                      } else {
                        let size = 0;
                        for await (const chunk of stream)
                          size += chunk.byteLength;
                        setStatus(
                          `Fixture attachment streamed (${size.toLocaleString()} bytes)`,
                        );
                      }
                    }}
                  />
                ))}
              </div>
            </>
          ) : (
            <div className="reading-empty">
              <p className="meta">No thread selected.</p>
              <p className="meta meta-hint">
                <span className="kbd">J</span> <span className="kbd">K</span>{" "}
                navigate in Normal · <span className="kbd">I</span> or{" "}
                <span className="kbd">/</span> Insert ·{" "}
                <span className="kbd">Esc</span> Normal ·{" "}
                <span className="kbd">G</span> <span className="kbd">I</span>{" "}
                inbox · <span className="kbd">⌘K</span> commands
              </p>
            </div>
          )}
        </section>
      </div>

      <StatusBar
        mode={inputMode}
        status={status}
        detail={`${filteredThreads.length} threads`}
      />

      <CommandPalette
        open={paletteOpen}
        commands={runtime.commands.list()}
        onClose={() => setPaletteOpen(false)}
        onRun={(id) => {
          runtime.commands.dispatch(id);
          setPaletteOpen(false);
        }}
      />

      {composeOpen && (
        <ComposeModal
          mode={inputMode}
          onModeChange={setInputMode}
          initialDraft={composeInitial}
          requestReadReceipt={settings.requestReadReceipt}
          onClose={() => {
            setComposeOpen(false);
            setComposeInitial(undefined);
            setInputMode("normal");
          }}
          onMinimize={minimizeCompose}
          onSaveDraft={async (draft) => {
            const normalized = domainDraft(draft);
            await runtime.sync.enqueue({
              accountId: runtime.gmailAccountId,
              kind: "save_draft",
              targetIds: [normalized.id],
              payload: { draft: normalized } as unknown as Record<
                string,
                unknown
              >,
            });
            await runtime.sync.flushOutbox(runtime.gmailAccountId);
            const failed = (
              await runtime.sync.listOutbox(runtime.gmailAccountId)
            ).find(
              (item) =>
                item.kind === "save_draft" &&
                item.status === "failed" &&
                item.targetIds[0] === normalized.id,
            );
            if (failed) {
              throw new Error(failed.lastError ?? "Draft save failed");
            }
          }}
          onSend={async (draft) => {
            const normalized = domainDraft(draft);
            const undoUntil = new Date(Date.now() + 5_000).toISOString();
            const mutation = await runtime.sync.enqueue({
              accountId: runtime.gmailAccountId,
              kind: "send",
              targetIds: [],
              payload: { draft: normalized } as unknown as Record<
                string,
                unknown
              >,
              availableAt: undoUntil,
              undoUntil,
            });
            setComposeOpen(false);
            setComposeInitial(undefined);
            setInputMode("normal");
            undoRef.current = async () => {
              await runtime.sync.cancelOutbox(mutation.id);
              openCompose(draft);
              setStatus("Send cancelled");
            };
            setTimeout(
              () => void runtime.sync.flushOutbox(runtime.gmailAccountId),
              5_000,
            );
            setStatus("Send queued · Undo available for 5 seconds");
          }}
        />
      )}

      <FloatingDrafts
        drafts={drafts}
        onExpand={expandDraft}
        onClose={closeDraft}
        onSend={(id) => void sendDraft(id)}
      />

      {settingsOpen && (
        <SettingsPanel
          state={settings}
          consent={consent}
          inviteCode={inviteCode}
          providerMode={runtime.providerMode}
          canConnectGmail={runtime.gmailConnect.available}
          gmailConnecting={gmailConnecting}
          connectError={gmailConnectError}
          accounts={runtime.accounts.map((account) => ({
            email: account.email,
            provider: account.accountId.startsWith("gmail:")
              ? "gmail"
              : account.accountId.startsWith("microsoft:")
                ? "microsoft"
                : "fixture",
            live: runtime.providerMode === "live",
          }))}
          diagnostics={[
            status,
            `Provider mode: ${runtime.providerMode}`,
            `Local thread count: ${threads.length}`,
            "Sync mode: local hydrate, then provider deltas",
            `Remote processing: ${consent?.enabled ? "opted in" : "disabled"}`,
            `Retention: ${consent?.retentionHours ?? 0} hours`,
            `OPFS: ${runtime.adapters.opfsAvailable ? "available" : "unavailable"}`,
            `WebCrypto: ${runtime.adapters.webCryptoAvailable ? "available" : "unavailable"}`,
            `Gmail connect: ${runtime.gmailConnect.available ? "ready" : runtime.gmailConnect.clientIdConfigured ? "needs native app" : "client ID missing"}`,
          ]}
          onChange={updateSettings}
          onClose={() => setSettingsOpen(false)}
          onOpenRemoteProcessing={() => {
            setSettingsOpen(false);
            setOptInOpen(true);
          }}
          onLinkDevice={async () => {
            const invite = await runtime.devices.createInvite();
            setInviteCode(invite.inviteCode);
            setStatus(`Device invite created: ${invite.inviteCode}`);
          }}
          onConnectGmail={() => void connectGmail()}
          onDisconnectGmail={
            runtime.providerMode === "live" &&
            runtime.gmailAccountId.startsWith("gmail:")
              ? async () => {
                  setGmailConnectError(null);
                  try {
                    await disconnectGmailAccount(runtime.gmailAccountId);
                  } catch {
                    // Local session still clears even if remote revoke fails.
                  }
                  clearLiveGmailAccount();
                  setSettingsOpen(false);
                  setAwaitingSignIn(
                    shouldPromptGmailSignIn(Boolean(googleDesktopClientId())),
                  );
                  setRuntime(null);
                  setStatus("Disconnected Gmail");
                }
              : undefined
          }
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
            setConsent(
              await runtime.remoteOptIn.getConsent(runtime.gmailAccountId),
            );
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
