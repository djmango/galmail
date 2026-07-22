import { describe, expect, it } from "bun:test";
import {
  createMicrosoftCalendarEvent,
  deleteMicrosoftCalendarEvent,
  listMicrosoftCalendarEvents,
  updateMicrosoftCalendarEvent,
} from "./calendar.js";
import type { GraphHttpClient } from "./live.js";

describe("Microsoft calendar client", () => {
  it("normalizes upcoming events from calendarView", async () => {
    const http: GraphHttpClient = {
      async request(input) {
        expect(input.url).toContain("/me/calendarView?");
        expect(input.url).toContain("startDateTime=");
        expect(input.headers.authorization).toBeUndefined();
        return {
          status: 200,
          async json() {
            return {
              value: [
                {
                  id: "event-1",
                  subject: "Design sync",
                  bodyPreview: "Agenda",
                  start: { dateTime: "2026-07-16T18:00:00.0000000" },
                  end: { dateTime: "2026-07-16T18:30:00.0000000" },
                  location: { displayName: "Room A" },
                  isAllDay: false,
                  onlineMeeting: { joinUrl: "https://teams.example/join" },
                  organizer: {
                    emailAddress: {
                      address: "lead@contoso.local",
                      name: "Lead",
                    },
                  },
                  attendees: [
                    {
                      emailAddress: { address: "you@contoso.local" },
                      status: { response: "accepted" },
                    },
                  ],
                  isCancelled: false,
                },
                {
                  id: "cancelled",
                  subject: "Old",
                  start: { dateTime: "2026-07-16T19:00:00Z" },
                  end: { dateTime: "2026-07-16T20:00:00Z" },
                  isCancelled: true,
                },
              ],
            };
          },
        };
      },
    };

    const events = await listMicrosoftCalendarEvents({
      accountId: "microsoft:reader@example.com",
      http,
      start: new Date("2026-07-16T00:00:00.000Z"),
      end: new Date("2026-07-23T00:00:00.000Z"),
    });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "event-1",
      title: "Design sync",
      location: "Room A",
      joinUrl: "https://teams.example/join",
      organizer: { email: "lead@contoso.local", name: "Lead" },
    });
    expect(events[0]!.attendees).toEqual([
      { email: "you@contoso.local", name: undefined, status: "accepted" },
    ]);
  });

  it("creates and updates events via Graph", async () => {
    const calls: Array<{ method?: string; url: string; body?: string }> = [];
    const http: GraphHttpClient = {
      async request(input) {
        calls.push({
          method: input.method,
          url: input.url,
          body: input.body,
        });
        if (input.method === "POST") {
          return {
            status: 201,
            async json() {
              return {
                id: "ms-1",
                subject: "Kickoff",
                bodyPreview: "Intro",
                start: { dateTime: "2026-07-16T18:00:00.0000000" },
                end: { dateTime: "2026-07-16T19:00:00.0000000" },
                location: { displayName: "Room B" },
                isAllDay: false,
                isCancelled: false,
                attendees: [],
              };
            },
          };
        }
        return {
          status: 200,
          async json() {
            return {
              id: "ms-1",
              subject: "Kickoff (updated)",
              bodyPreview: "Intro",
              start: { dateTime: "2026-07-16T18:00:00.0000000" },
              end: { dateTime: "2026-07-16T19:30:00.0000000" },
              location: { displayName: "Room B" },
              isAllDay: false,
              isCancelled: false,
              attendees: [],
            };
          },
        };
      },
    };

    const created = await createMicrosoftCalendarEvent({
      accountId: "microsoft:reader@example.com",
      http,
      event: {
        title: "Kickoff",
        description: "Intro",
        location: "Room B",
        start: "2026-07-16T18:00:00.000Z",
        end: "2026-07-16T19:00:00.000Z",
      },
    });
    expect(created).toMatchObject({ id: "ms-1", title: "Kickoff" });
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toContain("/me/events");
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({
      subject: "Kickoff",
      location: { displayName: "Room B" },
    });

    const updated = await updateMicrosoftCalendarEvent({
      accountId: "microsoft:reader@example.com",
      http,
      eventId: "ms-1",
      event: {
        title: "Kickoff (updated)",
        description: "Intro",
        location: "Room B",
        start: "2026-07-16T18:00:00.000Z",
        end: "2026-07-16T19:30:00.000Z",
      },
    });
    expect(updated.title).toBe("Kickoff (updated)");
    expect(calls[1]?.method).toBe("PATCH");
    expect(calls[1]?.url).toContain("/me/events/ms-1");
  });

  it("deletes events and surfaces reconnect guidance", async () => {
    const httpOk: GraphHttpClient = {
      async request(input) {
        expect(input.method).toBe("DELETE");
        return {
          status: 204,
          async json() {
            return null;
          },
        };
      },
    };
    await deleteMicrosoftCalendarEvent({
      accountId: "microsoft:reader@example.com",
      http: httpOk,
      eventId: "event-1",
    });

    const httpDenied: GraphHttpClient = {
      async request() {
        return {
          status: 403,
          async json() {
            return {};
          },
        };
      },
    };
    await expect(
      listMicrosoftCalendarEvents({
        accountId: "microsoft:reader@example.com",
        http: httpDenied,
      }),
    ).rejects.toThrow(/Reconnect Microsoft 365/);
  });
});
