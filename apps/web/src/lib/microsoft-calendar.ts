import { invoke } from "@tauri-apps/api/core";
import {
  createMicrosoftCalendarEvent,
  deleteMicrosoftCalendarEvent,
  listMicrosoftCalendarEvents,
  updateMicrosoftCalendarEvent,
  type CalendarEvent,
  type CalendarEventWrite,
} from "@galmail/providers";
import { microsoftClientId } from "./microsoft-connect";

export type { CalendarEvent, CalendarEventWrite };

function microsoftCalendarHttp(accountId: string, clientId: string) {
  return {
    async request(request: {
      url: string;
      method?: "GET" | "POST" | "PATCH" | "DELETE";
      headers: Record<string, string>;
      body?: string;
    }) {
      const url = new URL(request.url);
      if (
        url.origin !== "https://graph.microsoft.com" ||
        !url.pathname.startsWith("/v1.0/")
      ) {
        throw new Error("Invalid Microsoft Graph API URL");
      }
      const result = await invoke<{
        status: number;
        body: unknown;
        retryAfter?: string;
      }>("microsoft_graph_request", {
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
        headers: { "retry-after": result.retryAfter },
        async json() {
          return result.body;
        },
      };
    },
  };
}

function requireClientId(): string {
  const clientId = microsoftClientId();
  if (!clientId) {
    throw new Error("VITE_MICROSOFT_CLIENT_ID is not configured in sops");
  }
  return clientId;
}

export async function loadMicrosoftCalendarEvents(input: {
  accountId: string;
  start?: Date;
  end?: Date;
  limit?: number;
}): Promise<CalendarEvent[]> {
  const clientId = requireClientId();
  return listMicrosoftCalendarEvents({
    accountId: input.accountId,
    start: input.start,
    end: input.end,
    limit: input.limit,
    http: microsoftCalendarHttp(input.accountId, clientId),
  });
}

export async function createMicrosoftEvent(input: {
  accountId: string;
  event: CalendarEventWrite;
}): Promise<CalendarEvent> {
  const clientId = requireClientId();
  return createMicrosoftCalendarEvent({
    accountId: input.accountId,
    event: input.event,
    http: microsoftCalendarHttp(input.accountId, clientId),
  });
}

export async function updateMicrosoftEvent(input: {
  accountId: string;
  eventId: string;
  event: CalendarEventWrite;
}): Promise<CalendarEvent> {
  const clientId = requireClientId();
  return updateMicrosoftCalendarEvent({
    accountId: input.accountId,
    eventId: input.eventId,
    event: input.event,
    http: microsoftCalendarHttp(input.accountId, clientId),
  });
}

export async function deleteMicrosoftEvent(input: {
  accountId: string;
  eventId: string;
}): Promise<void> {
  const clientId = requireClientId();
  return deleteMicrosoftCalendarEvent({
    accountId: input.accountId,
    eventId: input.eventId,
    http: microsoftCalendarHttp(input.accountId, clientId),
  });
}
