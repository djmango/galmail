import { invoke } from "@tauri-apps/api/core";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  listGoogleCalendarEvents,
  updateGoogleCalendarEvent,
  type CalendarEvent,
  type CalendarEventWrite,
} from "@galmail/providers";
import { googleDesktopClientId } from "./gmail-connect";

export type { CalendarEvent, CalendarEventWrite };

function googleCalendarHttp(accountId: string, clientId: string) {
  return {
    async request(request: {
      url: string;
      method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
      headers: Record<string, string>;
      body?: string;
    }) {
      const url = new URL(request.url);
      if (
        url.origin !== "https://www.googleapis.com" ||
        !url.pathname.startsWith("/calendar/v3/")
      ) {
        throw new Error("Invalid Google Calendar API URL");
      }
      const result = await invoke<{
        status: number;
        body: unknown;
      }>("google_calendar_request", {
        request: {
          accountId,
          clientId,
          method: request.method ?? "GET",
          path: `${url.pathname}${url.search}`,
          body: request.body ? JSON.parse(request.body) : undefined,
        },
      });
      return {
        status: result.status,
        async json() {
          return result.body;
        },
      };
    },
  };
}

function requireClientId(): string {
  const clientId = googleDesktopClientId();
  if (!clientId) {
    throw new Error("VITE_GOOGLE_DESKTOP_CLIENT_ID is not configured in sops");
  }
  return clientId;
}

export async function loadGoogleCalendarEvents(input: {
  accountId: string;
  start?: Date;
  end?: Date;
  limit?: number;
}): Promise<CalendarEvent[]> {
  const clientId = requireClientId();
  return listGoogleCalendarEvents({
    accountId: input.accountId,
    start: input.start,
    end: input.end,
    limit: input.limit,
    http: googleCalendarHttp(input.accountId, clientId),
  });
}

export async function createGoogleEvent(input: {
  accountId: string;
  event: CalendarEventWrite;
}): Promise<CalendarEvent> {
  const clientId = requireClientId();
  return createGoogleCalendarEvent({
    accountId: input.accountId,
    event: input.event,
    http: googleCalendarHttp(input.accountId, clientId),
  });
}

export async function updateGoogleEvent(input: {
  accountId: string;
  eventId: string;
  event: CalendarEventWrite;
}): Promise<CalendarEvent> {
  const clientId = requireClientId();
  return updateGoogleCalendarEvent({
    accountId: input.accountId,
    eventId: input.eventId,
    event: input.event,
    http: googleCalendarHttp(input.accountId, clientId),
  });
}

export async function deleteGoogleEvent(input: {
  accountId: string;
  eventId: string;
}): Promise<void> {
  const clientId = requireClientId();
  return deleteGoogleCalendarEvent({
    accountId: input.accountId,
    eventId: input.eventId,
    http: googleCalendarHttp(input.accountId, clientId),
  });
}
