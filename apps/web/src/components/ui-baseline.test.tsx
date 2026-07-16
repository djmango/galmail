import { describe, expect, it, mock } from "bun:test";
import { asAccountId } from "@galmail/core-api";
import { renderToStaticMarkup } from "react-dom/server";
import { ActionButton } from "./ActionButton";
import { SettingsPanel } from "./SettingsPanel";
import { SafeMailBody } from "./SafeMailBody";
import { ComposeModal } from "./ComposeModal";
import { StatusBar } from "./StatusBar";

describe("current UI baseline", () => {
  it("keeps command buttons accessible and discoverable", () => {
    const html = renderToStaticMarkup(
      <ActionButton label="Archive" command="archive" onClick={mock()} />,
    );

    expect(html).toContain('title="Archive · E"');
    expect(html).toContain('aria-keyshortcuts="E"');
    expect(html).toContain("Archive");
    expect(html).toContain('<span class="kbd">E</span>');
  });

  it("marks icon buttons for hover label reveal", () => {
    const html = renderToStaticMarkup(
      <ActionButton
        label="Archive"
        icon={<span data-icon="archive" />}
        command="archive"
        onClick={mock()}
      />,
    );
    expect(html).toContain("ui-button-reveal");
    expect(html).toContain("ui-button-copy-clip");
    expect(html).toContain("ui-button-label");
    expect(html).toContain("Archive");
  });

  it("renders account, privacy, device-link, and diagnostics state", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel
        state={{
          theme: "dark",
          layout: "three-panel",
          developerMode: true,
          requestReadReceipt: false,
        }}
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
    expect(html).toContain("Sign in with Google");
    expect(html).toContain("Remote processing");
    expect(html).toContain("Request read receipts");
    expect(html).toContain('role="switch"');
    expect(html).toContain("DEVICE-123");
    expect(html).toContain("Local thread count: 4");
  });

  it("renders mail HTML in a sandbox with tracking controls", () => {
    const html = renderToStaticMarkup(
      <SafeMailBody
        html={'<img src="https://tracker.invalid/open"><p>Hello</p>'}
        text="Hello"
        sender="sender@example.com"
        theme="dark"
      />,
    );
    expect(html).toContain('sandbox=""');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain("Remote images enabled");
    expect(html).toContain("tracker.invalid");
    expect(html).toContain("Block remote images");
    expect(html).toContain("color-scheme:dark");
    expect(html).toContain('data-mail-scheme="dark"');
    expect(html).toContain("#0d0e10");
  });

  it("themes plain-text mail fallback", () => {
    const html = renderToStaticMarkup(
      <SafeMailBody text="Plain body" sender="sender@example.com" theme="light" />,
    );
    expect(html).toContain("mail-plain-text");
    expect(html).toContain("Plain body");
    expect(html).toContain('data-mail-scheme="light"');
    expect(html).not.toContain("<iframe");
  });

  it("exposes compose fields without receipt clutter", () => {
    const html = renderToStaticMarkup(
      <ComposeModal
        mode="insert"
        onModeChange={mock()}
        onClose={mock()}
        onSend={mock(async () => undefined)}
      />,
    );
    expect(html).toContain('aria-label="To"');
    expect(html).toContain('data-compose-field="to"');
    expect(html).toContain('data-compose-field="subject"');
    expect(html).toContain('data-compose-field="body"');
    expect(html).toContain("Cc/Bcc");
    expect(html).toContain("Send as alias");
    expect(html).toContain("Attach files");
    expect(html).toContain("Drop files to attach");
    expect(html).not.toContain("cannot prove a human read");
    expect(html).not.toContain("Request read receipt");
  });

  it("shows compose field ring in Normal mode", () => {
    const html = renderToStaticMarkup(
      <ComposeModal
        mode="normal"
        onModeChange={mock()}
        onClose={mock()}
        onSend={mock(async () => undefined)}
      />,
    );
    expect(html).toContain("compose-field-active");
    expect(html).toContain('data-compose-field="to"');
  });

  it("labels compose minimize as drafts, not PiP", () => {
    const html = renderToStaticMarkup(
      <ComposeModal
        mode="insert"
        onModeChange={mock()}
        onClose={mock()}
        onSend={mock(async () => undefined)}
        onMinimize={mock()}
      />,
    );
    expect(html).toContain("Minimize to drafts");
    expect(html).not.toContain("PiP");
  });

  it("shows mode pill with colored indicator", () => {
    const normal = renderToStaticMarkup(
      <StatusBar mode="normal" status="Ready" detail="12 threads" />,
    );
    const insert = renderToStaticMarkup(
      <StatusBar mode="insert" status="Typing" />,
    );
    expect(normal).toContain("mode-normal");
    expect(normal).toContain("Normal");
    expect(normal).toContain("12 threads");
    expect(insert).toContain("mode-insert");
    expect(insert).toContain("Insert");
  });
});
