import type {
  CalendarEvent,
  CalendarEventWrite,
} from "../microsoft/calendar.js";
import type { GmailHttpClient } from "./live.js";

export type { CalendarEventWrite };

const CALENDAR_ORIGIN = "https://www.googleapis.com";

type GoogleEvent = {
  id?: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  location?: string;
  hangoutLink?: string;
  htmlLink?: string;
  status?: string;
  organizer?: { email?: string; displayName?: string };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    responseStatus?: string;
  }>;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
};

function instant(value?: {
  dateTime?: string;
  date?: string;
  timeZone?: string;
}): string {
  if (value?.dateTime) {
    const parsed = Date.parse(value.dateTime);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
    return value.dateTime;
  }
  if (value?.date) return `${value.date}T00:00:00.000Z`;
  return new Date(0).toISOString();
}

function joinUrl(raw: GoogleEvent): string | undefined {
  const hangout = raw.hangoutLink?.trim();
  if (hangout) return hangout;
  const video = raw.conferenceData?.entryPoints?.find(
    (entry) => entry.entryPointType === "video" && entry.uri?.trim(),
  );
  return video?.uri?.trim() || undefined;
}

function normalizeEvent(accountId: string, raw: GoogleEvent): CalendarEvent {
  if (!raw.id) throw new Error("Google Calendar returned an incomplete event");
  return {
    id: raw.id,
    accountId,
    provider: "google",
    title: raw.summary?.trim() || "(no title)",
    bodyPreview: raw.description?.trim() || undefined,
    start: instant(raw.start),
    end: instant(raw.end),
    isAllDay: Boolean(raw.start?.date && !raw.start?.dateTime),
    location: raw.location?.trim() || undefined,
    joinUrl: joinUrl(raw),
    webLink: raw.htmlLink?.trim() || undefined,
    organizer: raw.organizer?.email
      ? {
          email: raw.organizer.email,
          name: raw.organizer.displayName || undefined,
        }
      : undefined,
    attendees: (raw.attendees ?? [])
      .map((attendee) => {
        const email = attendee.email?.trim();
        if (!email) return null;
        return {
          email,
          name: attendee.displayName || undefined,
          status: attendee.responseStatus || undefined,
        };
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value)),
    isCancelled: raw.status === "cancelled",
  };
}

function dateBound(iso: string, allDay: boolean): {
  dateTime?: string;
  date?: string;
} {
  if (allDay) {
    return { date: iso.slice(0, 10) };
  }
  return { dateTime: new Date(iso).toISOString() };
}

function writeBody(input: CalendarEventWrite): Record<string, unknown> {
  const allDay = input.isAllDay === true;
  return {
    summary: input.title.trim() || "(no title)",
    description: input.description?.trim() || undefined,
    location: input.location?.trim() || undefined,
    start: dateBound(input.start, allDay),
    end: dateBound(input.end, allDay),
  };
}

async function calendarRequest(input: {
  http: GmailHttpClient;
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: Record<string, unknown>;
  accessToken?: string;
}): Promise<{ status: number; json: () => Promise<unknown> }> {
  return input.http.request({
    url: input.url,
    method: input.method,
    headers: {
      accept: "application/json",
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
    "Google calendar access was denied. Reconnect Google to grant calendar write access.",
  );
}

/**
 * Upcoming events via Google Calendar `calendars/primary/events`.
 * Requires `https://www.googleapis.com/auth/calendar` (re-consent if the
 * account was connected with calendar.readonly or without calendar).
 */
export async function listGoogleCalendarEvents(input: {
  accountId: string;
  http: GmailHttpClient;
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
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: String(limit),
  });
  const url = `${CALENDAR_ORIGIN}/calendar/v3/calendars/primary/events?${params}`;
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
    throw new Error(`Google calendar request failed (${response.status})`);
  }
  const page = (await response.json()) as { items?: GoogleEvent[] };
  return (page.items ?? [])
    .filter((event) => event.id && event.status !== "cancelled")
    .map((event) => normalizeEvent(input.accountId, event));
}

/** Create an event on the primary calendar. */
export async function createGoogleCalendarEvent(input: {
  accountId: string;
  http: GmailHttpClient;
  event: CalendarEventWrite;
  accessToken?: string;
}): Promise<CalendarEvent> {
  const url = `${CALENDAR_ORIGIN}/calendar/v3/calendars/primary/events`;
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
    throw new Error(`Google calendar create failed (${response.status})`);
  }
  return normalizeEvent(
    input.accountId,
    (await response.json()) as GoogleEvent,
  );
}

/** Patch an existing primary-calendar event. */
export async function updateGoogleCalendarEvent(input: {
  accountId: string;
  http: GmailHttpClient;
  eventId: string;
  event: CalendarEventWrite;
  accessToken?: string;
}): Promise<CalendarEvent> {
  const url = `${CALENDAR_ORIGIN}/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`;
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
    throw new Error(`Google calendar update failed (${response.status})`);
  }
  return normalizeEvent(
    input.accountId,
    (await response.json()) as GoogleEvent,
  );
}

/** Delete an event from the primary calendar. */
export async function deleteGoogleCalendarEvent(input: {
  accountId: string;
  http: GmailHttpClient;
  eventId: string;
  accessToken?: string;
}): Promise<void> {
  const url = `${CALENDAR_ORIGIN}/calendar/v3/calendars/primary/events/${encodeURIComponent(input.eventId)}`;
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
    throw new Error(`Google calendar delete failed (${response.status})`);
  }
}
