import type { GraphHttpClient } from "./live.js";

const GRAPH_ORIGIN = "https://graph.microsoft.com";
const EVENT_SELECT = [
  "id",
  "subject",
  "bodyPreview",
  "start",
  "end",
  "location",
  "isAllDay",
  "onlineMeeting",
  "onlineMeetingUrl",
  "webLink",
  "organizer",
  "attendees",
  "isCancelled",
].join(",");

export type CalendarEvent = {
  id: string;
  accountId: string;
  provider: "microsoft" | "google";
  title: string;
  bodyPreview?: string;
  start: string;
  end: string;
  isAllDay: boolean;
  location?: string;
  joinUrl?: string;
  webLink?: string;
  organizer?: { email: string; name?: string };
  attendees: Array<{ email: string; name?: string; status?: string }>;
  isCancelled: boolean;
};

export type CalendarEventWrite = {
  title: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  isAllDay?: boolean;
};

type GraphEvent = {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  location?: { displayName?: string };
  isAllDay?: boolean;
  onlineMeeting?: { joinUrl?: string };
  onlineMeetingUrl?: string;
  webLink?: string;
  organizer?: { emailAddress?: { address?: string; name?: string } };
  attendees?: Array<{
    emailAddress?: { address?: string; name?: string };
    status?: { response?: string };
  }>;
  isCancelled?: boolean;
};

function instant(value?: {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}): string {
  if (value?.dateTime) {
    const raw = value.dateTime.endsWith("Z")
      ? value.dateTime
      : `${value.dateTime}Z`;
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    return value.dateTime;
  }
  if (value?.date) return `${value.date}T00:00:00.000Z`;
  return new Date(0).toISOString();
}

function normalizeEvent(accountId: string, raw: GraphEvent): CalendarEvent {
  if (!raw.id) throw new Error("Microsoft Graph returned an incomplete event");
  return {
    id: raw.id,
    accountId,
    provider: "microsoft",
    title: raw.subject?.trim() || "(no title)",
    bodyPreview: raw.bodyPreview || raw.body?.content?.trim() || undefined,
    start: instant(raw.start),
    end: instant(raw.end),
    isAllDay: raw.isAllDay === true,
    location: raw.location?.displayName?.trim() || undefined,
    joinUrl:
      raw.onlineMeeting?.joinUrl?.trim() ||
      raw.onlineMeetingUrl?.trim() ||
      undefined,
    webLink: raw.webLink?.trim() || undefined,
    organizer: raw.organizer?.emailAddress?.address
      ? {
          email: raw.organizer.emailAddress.address,
          name: raw.organizer.emailAddress.name || undefined,
        }
      : undefined,
    attendees: (raw.attendees ?? [])
      .map((attendee) => {
        const email = attendee.emailAddress?.address?.trim();
        if (!email) return null;
        return {
          email,
          name: attendee.emailAddress?.name || undefined,
          status: attendee.status?.response || undefined,
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value)),
    isCancelled: raw.isCancelled === true,
  };
}

function graphDateTime(iso: string): string {
  return new Date(iso).toISOString().replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
}

function writeBody(input: CalendarEventWrite): Record<string, unknown> {
  const allDay = input.isAllDay === true;
  const description = input.description?.trim();
  return {
    subject: input.title.trim() || "(no title)",
    body: description
      ? { contentType: "Text", content: description }
      : { contentType: "Text", content: "" },
    location: { displayName: input.location?.trim() || "" },
    isAllDay: allDay,
    start: allDay
      ? { dateTime: `${input.start.slice(0, 10)}T00:00:00`, timeZone: "UTC" }
      : { dateTime: graphDateTime(input.start), timeZone: "UTC" },
    end: allDay
      ? { dateTime: `${input.end.slice(0, 10)}T00:00:00`, timeZone: "UTC" }
      : { dateTime: graphDateTime(input.end), timeZone: "UTC" },
  };
}

async function calendarRequest(input: {
  http: GraphHttpClient;
  url: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  accessToken?: string;
}): Promise<{ status: number; json: () => Promise<unknown> }> {
  return input.http.request({
    url: input.url,
    method: input.method,
    headers: {
      accept: "application/json",
      Prefer: 'outlook.timezone="UTC"',
      ...(input.body ? { "content-type": "application/json" } : {}),
      ...(input.accessToken
        ? { authorization: `Bearer ${input.accessToken}` }
        : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
  });
}

function denyMessage(): Error {
  return new Error(
    "Microsoft calendar access was denied. Reconnect Microsoft 365 to grant Calendars.ReadWrite.",
  );
}

/**
 * Upcoming calendar view via Microsoft Graph `/me/calendarView`.
 * Requires `Calendars.ReadWrite` (re-consent if the account was connected with
 * Calendars.Read or without calendar).
 */
export async function listMicrosoftCalendarEvents(input: {
  accountId: string;
  http: GraphHttpClient;
  start?: Date;
  end?: Date;
  limit?: number;
  accessToken?: string;
}): Promise<CalendarEvent[]> {
  const start = input.start ?? new Date();
  const end =
    input.end ?? new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  const limit = Math.min(100, input.limit ?? 50);
  const params = new URLSearchParams({
    startDateTime: start.toISOString(),
    endDateTime: end.toISOString(),
    $select: EVENT_SELECT,
    $orderby: "start/dateTime",
    $top: String(limit),
  });
  const url = `${GRAPH_ORIGIN}/v1.0/me/calendarView?${params}`;
  const response = await calendarRequest({
    http: input.http,
    url,
    method: "GET",
    accessToken: input.accessToken,
  });
  if (response.status === 401 || response.status === 403) {
    throw denyMessage();
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Microsoft calendar request failed (${response.status})`);
  }
  const page = (await response.json()) as { value?: GraphEvent[] };
  return (page.value ?? [])
    .filter((event) => event.id && !event.isCancelled)
    .map((event) => normalizeEvent(input.accountId, event));
}

/** Create an event on the default calendar. */
export async function createMicrosoftCalendarEvent(input: {
  accountId: string;
  http: GraphHttpClient;
  event: CalendarEventWrite;
  accessToken?: string;
}): Promise<CalendarEvent> {
  const url = `${GRAPH_ORIGIN}/v1.0/me/events`;
  const response = await calendarRequest({
    http: input.http,
    url,
    method: "POST",
    body: writeBody(input.event),
    accessToken: input.accessToken,
  });
  if (response.status === 401 || response.status === 403) {
    throw denyMessage();
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Microsoft calendar create failed (${response.status})`);
  }
  return normalizeEvent(
    input.accountId,
    (await response.json()) as GraphEvent,
  );
}

/** Patch an existing calendar event. */
export async function updateMicrosoftCalendarEvent(input: {
  accountId: string;
  http: GraphHttpClient;
  eventId: string;
  event: CalendarEventWrite;
  accessToken?: string;
}): Promise<CalendarEvent> {
  const url = `${GRAPH_ORIGIN}/v1.0/me/events/${encodeURIComponent(input.eventId)}`;
  const response = await calendarRequest({
    http: input.http,
    url,
    method: "PATCH",
    body: writeBody(input.event),
    accessToken: input.accessToken,
  });
  if (response.status === 401 || response.status === 403) {
    throw denyMessage();
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Microsoft calendar update failed (${response.status})`);
  }
  return normalizeEvent(
    input.accountId,
    (await response.json()) as GraphEvent,
  );
}

/** Delete a calendar event. */
export async function deleteMicrosoftCalendarEvent(input: {
  accountId: string;
  http: GraphHttpClient;
  eventId: string;
  accessToken?: string;
}): Promise<void> {
  const url = `${GRAPH_ORIGIN}/v1.0/me/events/${encodeURIComponent(input.eventId)}`;
  const response = await calendarRequest({
    http: input.http,
    url,
    method: "DELETE",
    accessToken: input.accessToken,
  });
  if (response.status === 401 || response.status === 403) {
    throw denyMessage();
  }
  if (response.status !== 204 && (response.status < 200 || response.status >= 300)) {
    throw new Error(`Microsoft calendar delete failed (${response.status})`);
  }
}
