import { describe, expect, it } from "bun:test";
import {
  findBodyUnsubscribeLink,
  parseAngleBracketUris,
  parseListUnsubscribe,
  resolveUnsubscribeCapability,
  unsubscribeHost,
} from "./unsubscribe.js";

describe("parseAngleBracketUris", () => {
  it("extracts mailto and https URIs", () => {
    expect(
      parseAngleBracketUris(
        "<mailto:unsub@example.com>, <https://example.com/unsub>",
      ),
    ).toEqual([
      "mailto:unsub@example.com",
      "https://example.com/unsub",
    ]);
  });
});

describe("parseListUnsubscribe", () => {
  it("detects RFC 8058 one-click when Post header matches exactly", () => {
    const capability = parseListUnsubscribe({
      "List-Unsubscribe":
        "<mailto:list@host.com?subject=unsubscribe>, <https://host.com/unsub>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(capability.kind).toBe("one_click");
    expect(capability.oneClickUrl).toBe("https://host.com/unsub");
    expect(capability.mailto?.address).toBe("list@host.com");
    expect(capability.mailto?.subject).toBe("unsubscribe");
  });

  it("is case-insensitive for header names", () => {
    const capability = parseListUnsubscribe({
      "list-unsubscribe": "<https://news.example/leave>",
      "LIST-UNSUBSCRIBE-POST": "List-Unsubscribe=One-Click",
    });
    expect(capability.kind).toBe("one_click");
    expect(capability.oneClickUrl).toBe("https://news.example/leave");
  });

  it("rejects non-exact List-Unsubscribe-Post values", () => {
    const capability = parseListUnsubscribe({
      "List-Unsubscribe": "<https://host.com/unsub>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click; foo",
    });
    expect(capability.kind).toBe("https_link");
    expect(capability.oneClickUrl).toBeUndefined();
    expect(capability.httpsUrl).toBe("https://host.com/unsub");
  });

  it("prefers mailto when one-click is unavailable", () => {
    const capability = parseListUnsubscribe({
      "List-Unsubscribe":
        "<mailto:leave@brand.test?subject=bye&body=please%20remove>, <https://brand.test/prefs>",
    });
    expect(capability.kind).toBe("mailto");
    expect(capability.mailto).toEqual({
      address: "leave@brand.test",
      subject: "bye",
      body: "please remove",
    });
    expect(capability.httpsUrl).toBe("https://brand.test/prefs");
  });

  it("returns https_link when only an https URI is present", () => {
    const capability = parseListUnsubscribe({
      "List-Unsubscribe": "<https://only.example/out>",
    });
    expect(capability).toEqual({
      kind: "https_link",
      httpsUrl: "https://only.example/out",
    });
  });

  it("ignores http and javascript URIs for automated actions", () => {
    const capability = parseListUnsubscribe({
      "List-Unsubscribe":
        "<http://insecure.example/unsub>, <javascript:alert(1)>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(capability.kind).toBe("none");
  });

  it("returns none when headers are missing", () => {
    expect(parseListUnsubscribe(undefined).kind).toBe("none");
    expect(parseListUnsubscribe({}).kind).toBe("none");
  });
});

describe("findBodyUnsubscribeLink / resolveUnsubscribeCapability", () => {
  it("finds https body links by href or anchor text", () => {
    expect(
      findBodyUnsubscribeLink(
        `<p><a href="https://shop.example/unsubscribe?u=1">Click here</a></p>`,
      ),
    ).toBe("https://shop.example/unsubscribe?u=1");

    expect(
      findBodyUnsubscribeLink(
        `<a href="https://shop.example/prefs">Manage preferences</a>`,
      ),
    ).toBe("https://shop.example/prefs");
  });

  it("rejects non-https body links", () => {
    expect(
      findBodyUnsubscribeLink(
        `<a href="http://shop.example/unsubscribe">Unsubscribe</a>`,
      ),
    ).toBeUndefined();
    expect(
      findBodyUnsubscribeLink(
        `<a href="javascript:void(0)">Unsubscribe</a>`,
      ),
    ).toBeUndefined();
  });

  it("falls back to body heuristic when headers have no capability", () => {
    const capability = resolveUnsubscribeCapability(
      {},
      `<a href="https://list.example/opt-out">opt-out</a>`,
    );
    expect(capability.kind).toBe("body_heuristic");
    expect(capability.bodyUrl).toBe("https://list.example/opt-out");
    expect(unsubscribeHost(capability)).toBe("list.example");
  });

  it("keeps header capability over body links", () => {
    const capability = resolveUnsubscribeCapability(
      {
        "List-Unsubscribe": "<mailto:a@b.com>",
      },
      `<a href="https://evil.example/unsubscribe">Unsubscribe</a>`,
    );
    expect(capability.kind).toBe("mailto");
    expect(capability.bodyUrl).toBeUndefined();
  });
});
