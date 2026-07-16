import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Toaster, toast } from "sonner";
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
import type { NativeGmailSyncEngine } from "./lib/native-sync";
import {
  DEFAULT_LAYOUT,
  getSystemTheme,
  loadPersistedLoadRemoteImages,
  loadPersistedSidebarCollapsed,
  loadPersistedTheme,
  loadPersistedTrashAfterUnsubscribe,
  persistLoadRemoteImages,
  persistSidebarCollapsed,
  persistTheme,
  persistTrashAfterUnsubscribe,
  subscribeSystemTheme,
  type ResolvedTheme,
} from "./lib/themes";

function labelStatusName(labelId: string, labels: MailLabel[]): string {
  switch (labelId) {
    case "SPAM":
      return "Spam";
    case "TRASH":
      return "Trash";
    case "ARCHIVE":
      return "Archive";
    case "STARRED":
      return "Starred";
    default:
      return labels.find((label) => label.id === labelId)?.name ?? labelId;
  }
}

function threadsFromSync(rt: GalMailRuntime): MailThread[] {
  const sync = rt.sync as NativeGmailSyncEngine;
  if (typeof sync.localThreads === "function") {
    return rt.accounts
      .flatMap((account) => sync.localThreads(account.accountId))
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }
  return [];
}
import {
  capabilityForMessage,
  performUnsubscribe,
  unsubscribeButtonVisible,
  unsubscribeFailureStatus,
  unsubscribeSenderLabel,
  unsubscribeSuccessStatus,
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

function formatScheduleToast(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

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
  theme: ResolvedTheme;
  loadRemoteImages: boolean;
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
            loadRemoteImages={props.loadRemoteImages}
          />
          {props.message.attachments &&
            props.message.attachments.length > 0 && (
              <ul className="message-attachments" aria-label="Attachments">
                {props.message.attachments.map((attachment) => {
                  const quarantine =
                    attachment.quarantineReason ??
                    attachmentQuarantineReason(attachment);
                  const name = attachment.filename || "Unnamed attachment";
                  const sizeLabel =
                    attachment.size < 1024
                      ? `${attachment.size} B`
                      : attachment.size < 1024 * 1024
                        ? `${(attachment.size / 1024).toFixed(1)} KB`
                        : `${(attachment.size / (1024 * 1024)).toFixed(1)} MB`;
                  return (
                    <li
                      key={attachment.id}
                      className={
                        quarantine
                          ? "message-attachment-chip is-quarantined"
                          : "message-attachment-chip"
                      }
                      title={
                        quarantine
                          ? `${name} · Quarantined: ${quarantine}`
                          : `${name} · ${attachment.mimeType} · ${sizeLabel}`
                      }
                    >
                      <span className="message-attachment-meta">
                        <span className="message-attachment-name">{name}</span>
                        <span className="message-attachment-size">
                          {sizeLabel}
                        </span>
                      </span>
                      {quarantine ? (
                        <span className="quarantine" aria-label="Quarantined">
                          Quarantined
                        </span>
                      ) : (
                        <ActionButton
                          label="Download"
                          variant="quiet"
                          tooltip="Download to encrypted quarantine"
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
    loadRemoteImages: loadPersistedLoadRemoteImages(),
    trashAfterUnsubscribe: loadPersistedTrashAfterUnsubscribe(),
  }));
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() =>
    getSystemTheme(),
  );
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

  const resolvedTheme: ResolvedTheme =
    settings.theme === "system" ? systemTheme : settings.theme;

  useEffect(() => {
    if (bulkSelection.size === 0) bulkAnchorIdRef.current = null;
  }, [bulkSelection]);

  // Persist theme preference whenever it changes.
  useEffect(() => {
    persistTheme(settings.theme);
  }, [settings.theme]);

  // When preference is Auto, follow OS theme live.
  useEffect(() => {
    if (settings.theme !== "system") return;
    setSystemTheme(getSystemTheme());
    return subscribeSystemTheme(setSystemTheme);
  }, [settings.theme]);

  useEffect(() => {
    persistSidebarCollapsed(sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    persistLoadRemoteImages(settings.loadRemoteImages);
  }, [settings.loadRemoteImages]);

  useEffect(() => {
    persistTrashAfterUnsubscribe(settings.trashAfterUnsubscribe);
  }, [settings.trashAfterUnsubscribe]);

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
      const syncWithLocal = rt.sync as NativeGmailSyncEngine;
      let nextThreads: MailThread[];
      if (typeof syncWithLocal.localThreads === "function") {
        nextThreads = threadsFromSync(rt);
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
      const message = invokeErrorMessage(error, "Inbox sync failed");
      setStatus(message);
      toast.error(message);
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

  const syncedLabelsRef = useRef(new Set<string>());
  const syncedLabelsRuntimeRef = useRef<GalMailRuntime | null>(null);

  useEffect(() => {
    if (!runtime || runtime.providerMode !== "live") return;
    if (activeLabel === "INBOX" || activeLabel === "ALL") return;
    const sync = runtime.sync as NativeGmailSyncEngine;
    if (typeof sync.syncLabel !== "function") return;

    if (syncedLabelsRuntimeRef.current !== runtime) {
      syncedLabelsRuntimeRef.current = runtime;
      syncedLabelsRef.current = new Set();
    }

    const cacheKey = `${runtime.gmailAccountId}:${activeLabel}`;
    if (syncedLabelsRef.current.has(cacheKey)) return;

    let cancelled = false;
    const labelName = labelStatusName(activeLabel, labels);
    (async () => {
      setStatus(`Loading ${labelName}…`);
      try {
        for (const account of runtime.accounts) {
          if (cancelled) return;
          await sync.syncLabel(account.accountId, activeLabel);
        }
        if (cancelled) return;
        syncedLabelsRef.current.add(cacheKey);
        const nextThreads = threadsFromSync(runtime);
        setThreads(nextThreads);
        setStatus(`${labelName} · synced`);
      } catch (error) {
        if (!cancelled) {
          setStatus(invokeErrorMessage(error, `Failed to load ${labelName}`));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [runtime, activeLabel, labels]);

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
            toast.success("Archive undone");
          };
          setTimeout(
            () => void runtime.sync.flushOutbox(thread.accountId),
            5_000,
          );
          toast.success("Archived", {
            description: "Undo available for 5 seconds",
          });
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
        .then(() =>
          toast.success(markingUnread ? "Marked unread" : "Marked read"),
        );
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
          toast.success("Trash undone");
        };
        setTimeout(() => void runtime.sync.flushOutbox(), 5_000);
        setBulkSelection(new Set());
        toast.success(
          `Moved ${targets.length} thread(s) to Trash`,
          { description: "Undo available for 5 seconds" },
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
    reg.on("open_settings", () => setSettingsOpen(true));
    reg.on("search", () => enterInsertMode());
    reg.on("enter_insert", () => enterInsertMode());
    reg.on("enter_normal", () => enterNormalMode());
    reg.on("undo", () => {
      const undo = undoRef.current;
      if (!undo) {
        toast.message("Nothing to undo");
        return;
      }
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

      // Don't steal typing in compose/search fields; macOS-style ⌘,/⌘K still work.
      if (editable && !e.metaKey && !e.ctrlKey) return;

      // Insert mode: only meta/ctrl chords (e.g. ⌘K, ⌘,) still run until Esc.
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
      toast.success("Action undone");
    };
    setTimeout(() => void runtime.sync.flushOutbox(message.accountId), 5_000);
    toast.success(`${kind.replace("_", " ")} queued`, {
      description: "Undo available for 5 seconds",
    });
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
    toast.success(
      `${kind.replace("_", " ")} applied to ${targets.length} thread(s)`,
    );
    setBulkSelection(new Set());
  };

  const trashThread = (thread: MailThread, statusMessage: string) => {
    if (!runtime) return;
    const snapshot = thread;
    setThreads((items) =>
      items.map((item) =>
        item.id === thread.id
          ? { ...item, labelIds: ["TRASH" as never] }
          : item,
      ),
    );
    void runtime.sync
      .enqueue({
        accountId: thread.accountId,
        kind: "trash",
        targetIds: thread.messageIds,
        availableAt: new Date(Date.now() + 5_000).toISOString(),
        undoUntil: new Date(Date.now() + 5_000).toISOString(),
      })
      .then((mutation) => {
        undoRef.current = async () => {
          await runtime.sync.cancelOutbox(mutation.id);
          setThreads((items) =>
            items.map((item) => (item.id === thread.id ? snapshot : item)),
          );
          toast.success("Trash undone");
        };
        setTimeout(() => void runtime.sync.flushOutbox(), 5_000);
        toast.success(statusMessage);
      });
  };

  const handleUnsubscribe = async () => {
    if (!runtime || !message) return;
    const sender = unsubscribeSenderLabel(message);
    const result = await performUnsubscribe(message, {
      trashAfterUnsubscribe: settings.trashAfterUnsubscribe,
    });
    if (result.status === "cancelled") return;
    if (result.status === "error") {
      toast.error(unsubscribeFailureStatus(result.detail));
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
        toast.message("Unsubscribe send cancelled");
      };
      setTimeout(
        () => void runtime.sync.flushOutbox(message.accountId),
        5_000,
      );
    }

    const success = unsubscribeSuccessStatus(sender);
    if (settings.trashAfterUnsubscribe) {
      const thread =
        (openedId
          ? threads.find((item) => item.id === openedId)
          : undefined) ??
        threads.find((item) => item.messageIds.includes(message.id));
      if (thread) {
        trashThread(thread, `${success} · Moved to Trash`);
        return;
      }
    }

    if (result.status === "mailto") {
      toast.success(success, {
        description: "Undo available for 5 seconds",
      });
      return;
    }
    toast.success(success);
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
      toast.message("Send cancelled");
    };
    setTimeout(
      () => void runtime.sync.flushOutbox(runtime.gmailAccountId),
      5_000,
    );
    toast.success("Send queued", {
      description: "Undo available for 5 seconds",
    });
  };

  if (awaitingSignIn) {
    return (
      <div className="app" data-theme={resolvedTheme}>
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
      <div className="app" data-theme={resolvedTheme}>
        <p className="meta meta-hint">Loading encrypted local graph…</p>
      </div>
    );
  }

  return (
    <div
      className="app"
      data-theme={resolvedTheme}
      data-layout={settings.layout}
      data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}
    >
      <div className="shell">
        <aside className="sidebar panel" aria-label="Folders">
          <div className="sidebar-header">
            <ActionButton
              className="sidebar-collapse-toggle"
              variant="quiet"
              label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              icon={<Icons.menu />}
              iconOnly
              command="toggle_sidebar"
              aria-expanded={!sidebarCollapsed}
              onClick={() => setSidebarCollapsed((value) => !value)}
            />
          </div>
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
                    {item.kind.replace("_", " ")} ·{" "}
                    {item.availableAt &&
                    new Date(item.availableAt).getTime() > Date.now()
                      ? `scheduled ${formatScheduleToast(item.availableAt)}`
                      : item.status}
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
              command="open_settings"
              onClick={() => setSettingsOpen(true)}
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
            </div>
          )}
          {bulkSelection.size > 0 && (
            <div className="bulk-toolbar" aria-label="Bulk actions">
              <span className="bulk-toolbar-count">
                {bulkSelection.size} selected
              </span>
              <div className="bulk-toolbar-actions">
                <ActionButton
                  label="Archive selected"
                  icon={<Icons.archive />}
                  onClick={() => void bulkMutate("archive")}
                />
                <ActionButton
                  label="Mark selected read"
                  icon={<Icons.mailOpen />}
                  onClick={() => void bulkMutate("mark_read")}
                />
                {labels.find((label) => label.kind === "label") && (
                  <ActionButton
                    label={`Apply ${labels.find((label) => label.kind === "label")!.name}`}
                    icon={<Icons.tag />}
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
          )}
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
                    theme={resolvedTheme}
                    loadRemoteImages={settings.loadRemoteImages}
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
                        toast.success(`Stored ${attachment.filename}`, {
                          description: `${size.toLocaleString()} bytes in encrypted quarantine`,
                        });
                      } else {
                        let size = 0;
                        for await (const chunk of stream)
                          size += chunk.byteLength;
                        toast.success("Attachment streamed", {
                          description: `${size.toLocaleString()} bytes`,
                        });
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
        counts={{
          label: labelStatusName(activeLabel, labels),
          unread: filteredThreads.filter((t) => t.unreadCount > 0).length,
          total: filteredThreads.length,
        }}
      />

      <Toaster
        theme={resolvedTheme}
        position="bottom-right"
        closeButton
        richColors={false}
        className="galmail-toaster"
        toastOptions={{ className: "galmail-toast" }}
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
            const mutation = await runtime.sync.enqueue({
              accountId: runtime.gmailAccountId,
              kind: "save_draft",
              targetIds: [normalized.id],
              payload: { draft: normalized } as unknown as Record<
                string,
                unknown
              >,
            });
            // Failed rows stay failed until Retry — do not flush/retry on autosave.
            if (mutation.status === "failed") {
              throw new Error(mutation.lastError ?? "Draft save failed");
            }
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
          onSend={async (draft, options) => {
            const normalized = domainDraft(draft);
            const sendAt = options?.sendAt ? new Date(options.sendAt) : null;
            const scheduled =
              sendAt &&
              !Number.isNaN(sendAt.getTime()) &&
              sendAt.getTime() > Date.now() + 1_000;
            const availableAt = scheduled
              ? sendAt.toISOString()
              : new Date(Date.now() + 5_000).toISOString();
            const mutation = await runtime.sync.enqueue({
              accountId: runtime.gmailAccountId,
              kind: "send",
              targetIds: [],
              payload: { draft: normalized } as unknown as Record<
                string,
                unknown
              >,
              availableAt,
              undoUntil: scheduled ? undefined : availableAt,
            });
            setComposeOpen(false);
            setComposeInitial(undefined);
            setInputMode("normal");
            if (scheduled) {
              toast.success(`Scheduled for ${formatScheduleToast(availableAt)}`, {
                description: "Sends when GalMail is open",
              });
              return;
            }
            undoRef.current = async () => {
              await runtime.sync.cancelOutbox(mutation.id);
              openCompose(draft);
              toast.message("Send cancelled");
            };
            setTimeout(
              () => void runtime.sync.flushOutbox(runtime.gmailAccountId),
              5_000,
            );
            toast.success("Send queued", {
              description: "Undo available for 5 seconds",
            });
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
            toast.success("Device invite created", {
              description: invite.inviteCode,
            });
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
                  toast.success("Disconnected Gmail");
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
            toast.success(
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
