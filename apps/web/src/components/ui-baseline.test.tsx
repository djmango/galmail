import { describe, expect, it, mock } from "bun:test";
import { asAccountId } from "@galmail/core-api";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionButton } from "./ActionButton";
import { SettingsPanel } from "./SettingsPanel";
import { SafeMailBody } from "./SafeMailBody";
import { ComposeModal } from "./ComposeModal";

describe("current UI baseline", () => {
  it("keeps command buttons accessible and discoverable", () => {
    const html = renderToStaticMarkup(
      <ActionButton label="Archive" command="archive" onClick={mock()} />,
    );

    expect(html).toContain('title="Archive · E"');
    expect(html).toContain('aria-keyshortcuts="E"');
    expect(html).toContain("<span>Archive</span>");
    expect(html).toContain('<span class="kbd">E</span>');
  });

  it("renders account, privacy, device-link, and diagnostics state", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel
        state={{ theme: "dark", layout: "three-panel", developerMode: true }}
        consent={{
          accountId: asAccountId("gmail-demo"),
          enabled: false,
          allowAi: false,
          retentionHours: 0,
          disclosureVersion: "test",
        }}
        diagnostics={["Local thread count: 4"]}
        inviteCode="DEVICE-123"
        providerMode="fixture"
        canConnectGmail
        gmailConnecting={false}
        connectError={null}
        accounts={[
          {
            email: "demo@galmail.local",
            provider: "gmail",
            live: false,
          },
        ]}
        onChange={mock()}
        onClose={mock()}
        onOpenRemoteProcessing={mock()}
        onLinkDevice={mock()}
        onConnectGmail={mock()}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("demo@galmail.local");
    expect(html).toContain("Connect Gmail");
    expect(html).toContain("Remote processing");
    expect(html).toContain("DEVICE-123");
    expect(html).toContain("Local thread count: 4");
  });

  it("renders mail HTML in a sandbox with tracking controls", () => {
    const html = renderToStaticMarkup(
      <SafeMailBody
        html={'<img src="https://tracker.invalid/open"><p>Hello</p>'}
        text="Hello"
        sender="sender@example.com"
      />,
    );
    expect(html).toContain('sandbox=""');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain("Remote images blocked");
    expect(html).not.toContain("tracker.invalid");
  });

  it("exposes complete compose fields and honest receipt copy", () => {
    const html = renderToStaticMarkup(
      <ComposeModal onClose={mock()} onSend={mock(async () => undefined)} />,
    );
    expect(html).toContain('aria-label="Cc"');
    expect(html).toContain('aria-label="Bcc"');
    expect(html).toContain("Send as alias");
    expect(html).toContain("Attach files");
    expect(html).toContain("cannot prove a human read");
  });
});
