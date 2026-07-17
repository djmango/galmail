import { describe, expect, it } from "bun:test";
import {
  parseSecretsDocument,
  stringifyFlatSecretsYaml,
} from "./secrets-yaml";

describe("secrets YAML helpers", () => {
  it("round-trips flat string maps with quoted empties", () => {
    const data = {
      VITE_GOOGLE_DESKTOP_CLIENT_ID: "",
      VITE_MICROSOFT_TENANT: "common",
      GALMAIL_RELAY_URL: "http://127.0.0.1:8787",
    };
    const yaml = stringifyFlatSecretsYaml(data);
    expect(yaml).toContain('VITE_GOOGLE_DESKTOP_CLIENT_ID: ""');
    expect(yaml).toContain('VITE_MICROSOFT_TENANT: "common"');
    const parsed = parseSecretsDocument(yaml, "secrets/dev.yaml");
    expect(parsed).toEqual(data);
  });

  it("still parses JSON overlays", () => {
    const parsed = parseSecretsDocument(
      JSON.stringify({ GOOGLE_DESKTOP_OAUTH_JSON: "{}" }),
      "secrets/google-desktop-oauth.json",
    );
    expect(parsed).toEqual({ GOOGLE_DESKTOP_OAUTH_JSON: "{}" });
  });
});
