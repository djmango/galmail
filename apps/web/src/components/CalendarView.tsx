import { useEffect, useMemo, useState } from "react";
import type {
  CalendarEvent,
  CalendarEventWrite,
} from "../lib/microsoft-calendar";
import { ActionButton } from "./ActionButton";
import { Icons } from "./Icons";

export type CalendarAccountOption = {
  accountId: string;
  email: string;
  provider: "google" | "microsoft";
};

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function eventKey(event: CalendarEvent): string {
  return `${event.accountId}:${event.id}`;
}

function formatDayHeading(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00.000Z`);
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

function formatTimeRange(event: CalendarEvent): string {
  if (event.isAllDay) return "All day";
  const start = new Date(event.start);
  const end = new Date(event.end);
  const opts: Intl.DateTimeFormatOptions = {
    hour: "numeric",
    minute: "2-digit",
  };
  return `${start.toLocaleTimeString(undefined, opts)} - ${end.toLocaleTimeString(undefined, opts)}`;
}

function attendeesSummary(event: CalendarEvent): string {
  if (event.attendees.length === 0) {
    return event.organizer?.name || event.organizer?.email || "No attendees";
  }
  const names = event.attendees
    .slice(0, 3)
    .map((person) => person.name || person.email);
  const rest = event.attendees.length - names.length;
  return rest > 0 ? `${names.join(", ")} +${rest}` : names.join(", ");
}

function providerLabel(provider: CalendarEvent["provider"]): string {
  return provider === "google" ? "Google" : "Microsoft";
}

function openLinkLabel(provider: CalendarEvent["provider"]): string {
  return provider === "google" ? "Open in Google Calendar" : "Open in Outlook";
}

function toLocalInputValue(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("Enter a valid start and end time");
  }
  return parsed.toISOString();
}

function defaultCreateDraft(): CalendarEventWrite & { accountId: string } {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    accountId: "",
    title: "",
    start: start.toISOString(),
    end: end.toISOString(),
    location: "",
    description: "",
    isAllDay: false,
  };
}

type EditorMode =
  | { kind: "create" }
  | { kind: "edit"; event: CalendarEvent }
  | null;

type FormState = {
  accountId: string;
  title: string;
  startLocal: string;
  endLocal: string;
  location: string;
  description: string;
};

function formFromEvent(event: CalendarEvent): FormState {
  return {
    accountId: event.accountId,
    title: event.title === "(no title)" ? "" : event.title,
    startLocal: toLocalInputValue(event.start),
    endLocal: toLocalInputValue(event.end),
    location: event.location ?? "",
    description: event.bodyPreview ?? "",
  };
}

function formFromCreate(
  accounts: CalendarAccountOption[],
  preferredAccountId?: string,
): FormState {
  const draft = defaultCreateDraft();
  const accountId =
    preferredAccountId &&
    accounts.some((account) => account.accountId === preferredAccountId)
      ? preferredAccountId
      : (accounts[0]?.accountId ?? "");
  return {
    accountId,
    title: draft.title,
    startLocal: toLocalInputValue(draft.start),
    endLocal: toLocalInputValue(draft.end),
    location: "",
    description: "",
  };
}

export function CalendarView(props: {
  events: CalendarEvent[];
  loading: boolean;
  error: string | null;
  rangeLabel: string;
  accounts: CalendarAccountOption[];
  saving?: boolean;
  onRefresh: () => void;
  onOpenLink: (url: string) => void;
  onCreate: (input: {
    accountId: string;
    event: CalendarEventWrite;
  }) => Promise<void>;
  onUpdate: (input: {
    accountId: string;
    eventId: string;
    event: CalendarEventWrite;
  }) => Promise<void>;
  onDelete: (input: { accountId: string; eventId: string }) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorMode>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const showProvider = useMemo(() => {
    const providers = new Set(props.events.map((event) => event.provider));
    return providers.size > 1 || props.accounts.length > 1;
  }, [props.events, props.accounts.length]);
  const grouped = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const event of props.events) {
      const key = dayKey(event.start);
      const list = map.get(key) ?? [];
      list.push(event);
      map.set(key, list);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [props.events]);
  const selected =
    props.events.find((event) => eventKey(event) === selectedId) ??
    props.events[0] ??
    null;

  useEffect(() => {
    if (!editor) {
      setForm(null);
      setFormError(null);
      return;
    }
    if (editor.kind === "create") {
      setForm(formFromCreate(props.accounts));
    } else {
      setForm(formFromEvent(editor.event));
    }
    setFormError(null);
  }, [editor, props.accounts]);

  const canWrite = props.accounts.length > 0;
  const closeEditor = () => setEditor(null);

  const submitEditor = async () => {
    if (!editor || !form) return;
    setFormError(null);
    try {
      const start = fromLocalInputValue(form.startLocal);
      const end = fromLocalInputValue(form.endLocal);
      if (Date.parse(end) <= Date.parse(start)) {
        throw new Error("End time must be after start time");
      }
      if (!form.accountId) {
        throw new Error("Choose a calendar account");
      }
      const event: CalendarEventWrite = {
        title: form.title.trim() || "(no title)",
        start,
        end,
        location: form.location.trim() || undefined,
        description: form.description.trim() || undefined,
        isAllDay: false,
      };
      if (editor.kind === "create") {
        await props.onCreate({ accountId: form.accountId, event });
      } else {
        await props.onUpdate({
          accountId: editor.event.accountId,
          eventId: editor.event.id,
          event,
        });
      }
      closeEditor();
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Could not save event",
      );
    }
  };

  const deleteSelected = async () => {
    if (!selected) return;
    const confirmed = window.confirm(`Delete "${selected.title}"?`);
    if (!confirmed) return;
    try {
      await props.onDelete({
        accountId: selected.accountId,
        eventId: selected.id,
      });
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Could not delete event",
      );
    }
  };

  return (
    <section className="calendar-view" aria-label="Calendar">
      <header className="calendar-toolbar">
        <div>
          <p className="eyebrow">Calendar</p>
          <h2 className="calendar-title">{props.rangeLabel}</h2>
        </div>
        <div className="calendar-toolbar-actions">
          {canWrite && (
            <ActionButton
              label="New event"
              variant="primary"
              icon={<Icons.compose />}
              disabled={props.saving}
              onClick={() => setEditor({ kind: "create" })}
            />
          )}
          <ActionButton
            label={props.loading ? "Refreshing…" : "Refresh"}
            icon={<Icons.clock />}
            disabled={props.loading || props.saving}
            onClick={props.onRefresh}
          />
        </div>
      </header>

      {props.error && (
        <p className="settings-note settings-note-error" role="alert">
          {props.error}
        </p>
      )}

      {!props.error && !props.loading && props.events.length === 0 && (
        <p className="calendar-empty">No upcoming events in this range.</p>
      )}

      {props.loading && props.events.length === 0 && (
        <p className="calendar-empty">Loading calendar…</p>
      )}

      <div className="calendar-layout">
        <div className="calendar-agenda" role="list">
          {grouped.map(([day, events]) => (
            <section key={day} className="calendar-day">
              <h3 className="calendar-day-heading">{formatDayHeading(day)}</h3>
              <ul className="calendar-event-list">
                {events.map((event) => {
                  const key = eventKey(event);
                  return (
                    <li key={key}>
                      <button
                        type="button"
                        className={`calendar-event ${selected && eventKey(selected) === key ? "active" : ""}`}
                        onClick={() => setSelectedId(key)}
                      >
                        <span className="calendar-event-time">
                          {formatTimeRange(event)}
                        </span>
                        <span className="calendar-event-title">{event.title}</span>
                        {showProvider && (
                          <span className="provider-pill">
                            {providerLabel(event.provider)}
                          </span>
                        )}
                        {event.location && (
                          <span className="calendar-event-meta">
                            {event.location}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        {selected && (
          <aside className="calendar-detail panel" aria-label="Event details">
            <p className="calendar-detail-time">{formatTimeRange(selected)}</p>
            <h3 className="calendar-detail-title">{selected.title}</h3>
            {showProvider && (
              <p className="calendar-detail-row">
                <strong>Calendar</strong>
                <span>{providerLabel(selected.provider)}</span>
              </p>
            )}
            {selected.location && (
              <p className="calendar-detail-row">
                <strong>Location</strong>
                <span>{selected.location}</span>
              </p>
            )}
            <p className="calendar-detail-row">
              <strong>Attendees</strong>
              <span>{attendeesSummary(selected)}</span>
            </p>
            {selected.bodyPreview && (
              <p className="calendar-detail-preview">{selected.bodyPreview}</p>
            )}
            <div className="calendar-detail-actions">
              {canWrite && (
                <>
                  <ActionButton
                    label="Edit"
                    icon={<Icons.compose />}
                    disabled={props.saving}
                    onClick={() =>
                      setEditor({ kind: "edit", event: selected })
                    }
                  />
                  <ActionButton
                    label="Delete"
                    icon={<Icons.trash />}
                    disabled={props.saving}
                    onClick={() => void deleteSelected()}
                  />
                </>
              )}
              {selected.joinUrl && (
                <ActionButton
                  label="Join meeting"
                  variant="primary"
                  onClick={() => props.onOpenLink(selected.joinUrl!)}
                />
              )}
              {selected.webLink && (
                <ActionButton
                  label={openLinkLabel(selected.provider)}
                  onClick={() => props.onOpenLink(selected.webLink!)}
                />
              )}
            </div>
          </aside>
        )}
      </div>

      {editor && form && (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label={editor.kind === "create" ? "New event" : "Edit event"}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeEditor();
          }}
        >
          <div className="modal-card calendar-editor-card">
            <header className="compose-head">
              <h3 className="compose-title">
                {editor.kind === "create" ? "New event" : "Edit event"}
              </h3>
              <div className="compose-head-actions">
                <ActionButton label="Close" onClick={closeEditor} />
              </div>
            </header>
            <div className="calendar-editor-fields">
              {editor.kind === "create" && props.accounts.length > 1 && (
                <label className="compose-field">
                  <span className="compose-field-label">Calendar</span>
                  <select
                    className="field-input"
                    value={form.accountId}
                    onChange={(event) =>
                      setForm({ ...form, accountId: event.target.value })
                    }
                  >
                    {props.accounts.map((account) => (
                      <option
                        key={account.accountId}
                        value={account.accountId}
                      >
                        {account.email} ({providerLabel(account.provider)})
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="compose-field">
                <span className="compose-field-label">Title</span>
                <input
                  className="field-input"
                  value={form.title}
                  placeholder="Event title"
                  onChange={(event) =>
                    setForm({ ...form, title: event.target.value })
                  }
                />
              </label>
              <label className="compose-field">
                <span className="compose-field-label">Starts</span>
                <input
                  className="field-input"
                  type="datetime-local"
                  value={form.startLocal}
                  onChange={(event) =>
                    setForm({ ...form, startLocal: event.target.value })
                  }
                />
              </label>
              <label className="compose-field">
                <span className="compose-field-label">Ends</span>
                <input
                  className="field-input"
                  type="datetime-local"
                  value={form.endLocal}
                  onChange={(event) =>
                    setForm({ ...form, endLocal: event.target.value })
                  }
                />
              </label>
              <label className="compose-field">
                <span className="compose-field-label">Location</span>
                <input
                  className="field-input"
                  value={form.location}
                  placeholder="Optional"
                  onChange={(event) =>
                    setForm({ ...form, location: event.target.value })
                  }
                />
              </label>
              <label className="compose-field">
                <span className="compose-field-label">Description</span>
                <textarea
                  className="field-textarea compose-body"
                  rows={4}
                  value={form.description}
                  placeholder="Optional notes"
                  onChange={(event) =>
                    setForm({ ...form, description: event.target.value })
                  }
                />
              </label>
            </div>
            {formError && (
              <p className="settings-note settings-note-error" role="alert">
                {formError}
              </p>
            )}
            <div className="compose-toolbar">
              <div className="compose-toolbar-end">
                <ActionButton
                  label="Cancel"
                  disabled={props.saving}
                  onClick={closeEditor}
                />
                <ActionButton
                  label={
                    props.saving
                      ? "Saving…"
                      : editor.kind === "create"
                        ? "Create"
                        : "Save"
                  }
                  variant="primary"
                  disabled={props.saving}
                  onClick={() => void submitEditor()}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
