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
    expect(html).not.toContain("title=");
  });

  it("gives icon-only controls a styled tip instead of native title", () => {
    const html = renderToStaticMarkup(
      <ActionButton
        label="Collapse sidebar"
        icon={<span data-icon="menu" />}
        iconOnly
        command="toggle_sidebar"
        onClick={mock()}
      />,
    );
    expect(html).toContain("ui-button-reveal");
    expect(html).toContain("ui-button-label");
    expect(html).toContain("Collapse sidebar");
    expect(html).not.toContain("title=");
  });

  it("keeps Add Google when one Gmail account is already connected", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel
        state={{
          theme: "light",
          layout: "three-panel",
          developerMode: false,
          requestReadReceipt: false,
          loadRemoteImages: true,
          trashAfterUnsubscribe: false,
        }}
        consent={null}
        diagnostics={[]}
        inviteCode={null}
        providerMode="live"
        canConnectGmail
        canConnectMicrosoft
        gmailConnecting={false}
        microsoftConnecting={false}
        connectError={null}
        accounts={[
          {
            accountId: "gmail:one@example.com",
            email: "one@example.com",
            provider: "gmail",
            live: true,
          },
        ]}
        onChange={mock()}
        onClose={mock()}
        onOpenRemoteProcessing={mock()}
        onLinkDevice={mock()}
        onConnectGmail={mock()}
        onConnectMicrosoft={mock()}
        onDisconnectAccount={mock()}
      />,
    );
    expect(html).toContain("Add Google account");
    expect(html).toContain("Sign in with Microsoft");
    expect(html).toContain("Disconnect");
    expect(html).toContain("one@example.com");
  });

  it("renders account, privacy, device-link, and diagnostics state", () => {
    const html = renderToStaticMarkup(
      <SettingsPanel
        state={{
          theme: "dark",
          layout: "three-panel",
          developerMode: true,
          requestReadReceipt: false,
          loadRemoteImages: true,
          trashAfterUnsubscribe: true,
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
        canConnectMicrosoft
        gmailConnecting={false}
        microsoftConnecting={false}
        connectError={null}
        accounts={[
          {
            accountId: "gmail:demo@galmail.local",
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
        onConnectMicrosoft={mock()}
      />,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain("demo@galmail.local");
    expect(html).toContain("Sign in with Google");
    expect(html).toContain("Sign in with Microsoft");
    expect(html).not.toContain(
      "Sign-in buttons appear in the GalMail app when Google or",
    );
    expect(html).toContain("Remote processing");
    expect(html).toContain("Request read receipts");
    expect(html).toContain("Load remote images");
    expect(html).toContain("Trash after unsubscribe");
    expect(html).toContain('role="switch"');
    expect(html).toContain("Light");
    expect(html).toContain("Dark");
    expect(html).toContain("Auto");
    expect(html).toContain("DEVICE-123");
    expect(html).toContain("Local thread count: 4");
  });

  it("renders mail HTML in a sandbox with overflow message controls", () => {
    const html = renderToStaticMarkup(
      <SafeMailBody
        html={'<img src="https://tracker.invalid/open"><p>Hello</p>'}
        text="Hello"
        sender="sender@example.com"
        theme="dark"
        loadRemoteImages
      />,
    );
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain("Message options");
    expect(html).toContain("mail-body-menu");
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain("tracker.invalid");
    expect(html).not.toContain("Remote images enabled");
    expect(html).not.toContain("Block remote images");
    expect(html).not.toContain("mail-security-controls");
    expect(html).toContain("color-scheme:dark");
    expect(html).toContain('data-mail-scheme="dark"');
    expect(html).toContain("#0d0e10");
    expect(html).toContain("galmail:open-url");
    expect(html).toContain("script-src");
  });

  it("blocks remote images when the setting defaults off", () => {
    const html = renderToStaticMarkup(
      <SafeMailBody
        html={'<img src="https://tracker.invalid/open"><p>Hello</p>'}
        text="Hello"
        sender="sender@example.com"
        theme="dark"
        loadRemoteImages={false}
      />,
    );
    expect(html).toContain("Message options");
    expect(html).not.toContain("Remote images blocked");
    expect(html).not.toContain("Load remote images");
    expect(html).not.toContain("tracker.invalid");
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
    expect(html).toContain("Schedule send");
    expect(html).not.toContain("cannot prove a human read");
    expect(html).not.toContain("Request read receipt");
  });

  it("compose From picker selects a non-default account for send", async () => {
    const sent: Array<{ accountId?: string }> = [];
    const html = renderToStaticMarkup(
      <ComposeModal
        mode="insert"
        onModeChange={mock()}
        onClose={mock()}
        accounts={[
          {
            accountId: "gmail:a@example.com",
            email: "a@example.com",
            provider: "gmail",
          },
          {
            accountId: "gmail:b@example.com",
            email: "b@example.com",
            provider: "gmail",
          },
        ]}
        defaultAccountId="gmail:a@example.com"
        initialDraft={{
          to: "z@example.com",
          subject: "Hi",
          body: "Body",
          accountId: "gmail:b@example.com",
        }}
        onSend={async (draft) => {
          sent.push({ accountId: draft.accountId });
        }}
      />,
    );
    expect(html).toContain('aria-label="From account"');
    expect(html).toContain("gmail:b@example.com");
    expect(html).toContain("b@example.com");
    // Static markup cannot fire submit; assert selected option is present.
    expect(html).toContain('value="gmail:b@example.com"');
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
      <StatusBar
        mode="normal"
        status="Ready"
        counts={{ label: "Inbox", unread: 6, total: 12 }}
      />,
    );
    const insert = renderToStaticMarkup(
      <StatusBar mode="insert" status="Typing" />,
    );
    expect(normal).toContain("mode-normal");
    expect(normal).toContain("Normal");
    expect(normal).toContain("status-counts");
    expect(normal).toContain("Inbox");
    expect(normal).toContain("6");
    expect(normal).toContain("unread");
    expect(normal).toContain("12");
    expect(insert).toContain("mode-insert");
    expect(insert).toContain("Insert");
  });
});
