import { describe, expect, it } from "bun:test";
import {
  createGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  listGoogleCalendarEvents,
  updateGoogleCalendarEvent,
} from "./calendar.js";
import type { GmailHttpClient } from "./live.js";

describe("Google calendar client", () => {
  it("normalizes upcoming events from primary calendar", async () => {
    const http: GmailHttpClient = {
      async request(input) {
        expect(input.url).toContain("/calendar/v3/calendars/primary/events?");
        expect(input.url).toContain("timeMin=");
        expect(input.url).toContain("singleEvents=true");
        expect(input.headers.authorization).toBeUndefined();
        return {
          status: 200,
          async json() {
            return {
              items: [
                {
                  id: "event-1",
                  summary: "Standup",
                  description: "Daily sync",
                  start: { dateTime: "2026-07-16T15:00:00-07:00" },
                  end: { dateTime: "2026-07-16T15:30:00-07:00" },
                  location: "Meet",
                  hangoutLink: "https://meet.google.com/abc-defg-hij",
                  htmlLink: "https://calendar.google.com/event?eid=1",
                  status: "confirmed",
                  organizer: {
                    email: "lead@example.com",
                    displayName: "Lead",
                  },
                  attendees: [
                    {
                      email: "you@example.com",
                      responseStatus: "accepted",
                    },
                  ],
                },
                {
                  id: "cancelled",
                  summary: "Old",
                  start: { dateTime: "2026-07-16T19:00:00Z" },
                  end: { dateTime: "2026-07-16T20:00:00Z" },
                  status: "cancelled",
                },
                {
                  id: "all-day",
                  summary: "Holiday",
                  start: { date: "2026-07-17" },
                  end: { date: "2026-07-18" },
                  status: "confirmed",
                },
              ],
            };
          },
        };
      },
    };

    const events = await listGoogleCalendarEvents({
      accountId: "gmail:reader@example.com",
      http,
      start: new Date("2026-07-16T00:00:00.000Z"),
      end: new Date("2026-07-23T00:00:00.000Z"),
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      id: "event-1",
      provider: "google",
      title: "Standup",
      location: "Meet",
      joinUrl: "https://meet.google.com/abc-defg-hij",
      organizer: { email: "lead@example.com", name: "Lead" },
      isAllDay: false,
    });
    expect(events[0]!.attendees).toEqual([
      { email: "you@example.com", name: undefined, status: "accepted" },
    ]);
    expect(events[1]).toMatchObject({
      id: "all-day",
      title: "Holiday",
      isAllDay: true,
      start: "2026-07-17T00:00:00.000Z",
    });
  });

  it("creates and updates events on the primary calendar", async () => {
    const calls: Array<{ method?: string; url: string; body?: string }> = [];
    const http: GmailHttpClient = {
      async request(input) {
        calls.push({
          method: input.method,
          url: input.url,
          body: input.body,
        });
        if (input.method === "POST") {
          return {
            status: 200,
            async json() {
              return {
                id: "new-1",
                summary: "Planning",
                description: "Notes",
                location: "HQ",
                start: { dateTime: "2026-07-16T18:00:00.000Z" },
                end: { dateTime: "2026-07-16T19:00:00.000Z" },
                status: "confirmed",
              };
            },
          };
        }
        return {
          status: 200,
          async json() {
            return {
              id: "new-1",
              summary: "Planning (updated)",
              description: "Notes",
              location: "HQ",
              start: { dateTime: "2026-07-16T18:00:00.000Z" },
              end: { dateTime: "2026-07-16T19:30:00.000Z" },
              status: "confirmed",
            };
          },
        };
      },
    };

    const created = await createGoogleCalendarEvent({
      accountId: "gmail:reader@example.com",
      http,
      event: {
        title: "Planning",
        description: "Notes",
        location: "HQ",
        start: "2026-07-16T18:00:00.000Z",
        end: "2026-07-16T19:00:00.000Z",
      },
    });
    expect(created).toMatchObject({ id: "new-1", title: "Planning" });
    expect(calls[0]?.method).toBe("POST");
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({
      summary: "Planning",
      location: "HQ",
    });

    const updated = await updateGoogleCalendarEvent({
      accountId: "gmail:reader@example.com",
      http,
      eventId: "new-1",
      event: {
        title: "Planning (updated)",
        description: "Notes",
        location: "HQ",
        start: "2026-07-16T18:00:00.000Z",
        end: "2026-07-16T19:30:00.000Z",
      },
    });
    expect(updated.title).toBe("Planning (updated)");
    expect(calls[1]?.method).toBe("PATCH");
    expect(calls[1]?.url).toContain("/events/new-1");
  });

  it("deletes events and surfaces reconnect guidance", async () => {
    const httpOk: GmailHttpClient = {
      async request(input) {
        expect(input.method).toBe("DELETE");
        return { status: 204, async json() { return null; } };
      },
    };
    await deleteGoogleCalendarEvent({
      accountId: "gmail:reader@example.com",
      http: httpOk,
      eventId: "event-1",
    });

    const httpDenied: GmailHttpClient = {
      async request() {
        return { status: 403, async json() { return {}; } };
      },
    };
    await expect(
      listGoogleCalendarEvents({
        accountId: "gmail:reader@example.com",
        http: httpDenied,
      }),
    ).rejects.toThrow(/Reconnect Google/);
  });
});
