import type { RemoteProcessingConsent } from "@galmail/core-api";
import type { McpApprovalMode, McpPolicy } from "../lib/mcp-settings";
import type { RemoteImagePolicy, ThemePreference } from "../lib/themes";
import {
  SWIPE_ACTION_OPTIONS,
  SWIPE_SLOT_LABELS,
  type SwipeSlot,
} from "../lib/swipe-actions";
import { ActionButton } from "./ActionButton";
import { Icons } from "./Icons";
import { SettingsBar, type SettingsState } from "./SettingsBar";

const MCP_APPROVAL_OPTIONS: { id: McpApprovalMode; label: string }[] = [
  { id: "ask_writes", label: "Ask on writes" },
  { id: "ask", label: "Ask every time" },
  { id: "allowlisted", label: "Allow all" },
];

export type SettingsAccount = {
  accountId: string;
  email: string;
  provider: "gmail" | "microsoft" | "fixture";
  live: boolean;
};

const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "Auto" },
];

const REMOTE_IMAGE_OPTIONS: { id: RemoteImagePolicy; label: string }[] = [
  { id: "never", label: "Never" },
  { id: "ask", label: "Ask" },
  { id: "allow", label: "Allow all" },
];

const SWIPE_SLOTS: SwipeSlot[] = [
  "rightNear",
  "rightFar",
  "leftNear",
  "leftFar",
];

export function SettingsPanel(props: {
  state: SettingsState;
  consent: RemoteProcessingConsent | null;
  diagnostics: string[];
  inviteCode: string | null;
  accounts: SettingsAccount[];
  providerMode: "fixture" | "live";
  canConnectGmail: boolean;
  canConnectMicrosoft: boolean;
  gmailConnecting: boolean;
  microsoftConnecting: boolean;
  connectError: string | null;
  isMobile?: boolean;
  onChange: (next: Partial<SettingsState>) => void;
  onClose: () => void;
  onOpenRemoteProcessing: () => void;
  onLinkDevice: () => void;
  onConnectGmail: () => void;
  onConnectMicrosoft: () => void;
  /** Disconnect a single account by ID (preferred). */
  onDisconnectAccount?: (accountId: string) => void;
  /** @deprecated Prefer onDisconnectAccount */
  onDisconnectGmail?: () => void;
  /** @deprecated Prefer onDisconnectAccount */
  onDisconnectMicrosoft?: () => void;
  mcpPolicy: McpPolicy;
  mcpCreatedToken: string | null;
  mcpCursorConfig: string | null;
  mcpBridgeUrl: string | null;
  mcpBridgeRunning: boolean;
  onMcpPolicyChange: (next: Partial<McpPolicy>) => void;
  onCreateMcpClient: () => void;
  onRevokeMcpClient: (clientId: string) => void;
  onStartMcpBridge: () => void;
  onStopMcpBridge: () => void;
}) {
  const connecting = props.gmailConnecting || props.microsoftConnecting;
  const liveAccounts = props.accounts.filter((account) => account.live);
  const hasGmail = liveAccounts.some((a) => a.provider === "gmail");
  const hasMicrosoft = liveAccounts.some((a) => a.provider === "microsoft");

  return (
    <div
      className="modal settings-modal"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        className="modal-card settings-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <header className="settings-head">
          <div>
            <p className="eyebrow">GalMail</p>
            <h2 id="settings-title">Settings</h2>
          </div>
          <ActionButton
            label="Close settings"
            icon={<Icons.close />}
            iconOnly
            onClick={props.onClose}
          />
        </header>

        <div className="settings-body">
          <section className="settings-section">
            <h3 className="settings-section-title">Accounts</h3>
            <p className="settings-copy">
              {props.providerMode === "live"
                ? "Using live provider accounts on this device. Add as many Google or Microsoft accounts as you need."
                : "Showing fixture mail until you connect a real account."}
            </p>
            <div className="settings-group">
              {props.accounts.map((account) => (
                <div
                  className="settings-row account-row"
                  key={
                    account.accountId || `${account.provider}:${account.email}`
                  }
                >
                  <div className="settings-row-text">
                    <strong>{account.email}</strong>
                    <span>
                      {account.provider === "gmail"
                        ? "Google"
                        : account.provider === "microsoft"
                          ? "Microsoft"
                          : "Demo"}
                    </span>
                  </div>
                  {account.live && props.onDisconnectAccount ? (
                    <ActionButton
                      className="account-disconnect"
                      label="Disconnect"
                      onClick={() =>
                        props.onDisconnectAccount?.(account.accountId)
                      }
                    />
                  ) : (
                    <span className="account-state">
                      {account.live ? "Connected" : "Demo"}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="account-connect-grid" role="group" aria-label="Add accounts">
              {props.canConnectGmail && (
                <ActionButton
                  className="account-connect-tile"
                  label={
                    props.gmailConnecting
                      ? "Waiting for Google…"
                      : hasGmail
                        ? "Add Google"
                        : "Add Google"
                  }
                  icon={<Icons.google />}
                  variant="primary"
                  reveal={false}
                  showShortcut={false}
                  disabled={connecting}
                  onClick={props.onConnectGmail}
                />
              )}
              {props.canConnectMicrosoft && (
                <ActionButton
                  className="account-connect-tile"
                  label={
                    props.microsoftConnecting
                      ? "Waiting for Microsoft…"
                      : "Add Microsoft"
                  }
                  icon={<Icons.microsoft />}
                  variant="primary"
                  reveal={false}
                  showShortcut={false}
                  disabled={connecting}
                  onClick={props.onConnectMicrosoft}
                />
              )}
              <ActionButton
                className="account-connect-tile"
                label="Link device"
                icon={<Icons.devices />}
                variant="quiet"
                reveal={false}
                showShortcut={false}
                onClick={props.onLinkDevice}
              />
            </div>
            {!props.onDisconnectAccount &&
              hasGmail &&
              props.onDisconnectGmail && (
                <div className="settings-actions">
                  <ActionButton
                    label="Disconnect Gmail"
                    onClick={props.onDisconnectGmail}
                  />
                </div>
              )}
            {!props.onDisconnectAccount &&
              hasMicrosoft &&
              props.onDisconnectMicrosoft && (
                <div className="settings-actions">
                  <ActionButton
                    label="Disconnect Microsoft"
                    onClick={props.onDisconnectMicrosoft}
                  />
                </div>
              )}
            {!props.canConnectGmail && !props.canConnectMicrosoft && (
              <p className="settings-note" role="status">
                Sign-in buttons appear in the GalMail app when Google or
                Microsoft client IDs are configured for this build.
              </p>
            )}
            {props.connectError && (
              <p className="settings-note settings-note-error" role="alert">
                {props.connectError}
              </p>
            )}
            {props.inviteCode && (
              <p className="settings-note" role="status">
                Device code <strong>{props.inviteCode}</strong> expires in 15
                minutes.
              </p>
            )}
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Appearance</h3>
            <div className="settings-group">
              <div className="settings-row settings-row-stack">
                <div className="settings-row-text">
                  <strong id="theme-label">Theme</strong>
                  <span>Light, dark, or match your system</span>
                </div>
                <div
                  className="settings-segment"
                  role="group"
                  aria-labelledby="theme-label"
                >
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="settings-segment-option"
                      aria-pressed={props.state.theme === option.id}
                      onClick={() => props.onChange({ theme: option.id })}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              {!props.isMobile ? (
                <div className="settings-row settings-row-stack">
                  <div className="settings-row-text">
                    <strong id="layout-label">Inbox layout</strong>
                    <span>How threads and reading panes are arranged</span>
                  </div>
                  <SettingsBar state={props.state} onChange={props.onChange} />
                </div>
              ) : null}
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">Mail</h3>
            <div className="settings-group">
              <div className="settings-row settings-switch-row">
                <div className="settings-row-text">
                  <strong id="trash-after-unsubscribe-label">
                    Trash after unsubscribe
                  </strong>
                  <span>
                    Move the message to Trash after a successful unsubscribe
                  </span>
                </div>
                <label className="ios-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-labelledby="trash-after-unsubscribe-label"
                    checked={props.state.trashAfterUnsubscribe}
                    onChange={(event) =>
                      props.onChange({
                        trashAfterUnsubscribe: event.target.checked,
                      })
                    }
                  />
                  <span className="ios-switch-track" aria-hidden />
                </label>
              </div>
              <div className="settings-row settings-row-stack">
                <div className="settings-row-text">
                  <strong id="remote-image-label">Remote images</strong>
                  <span>
                    Approval mode for images hosted off-device when opening mail
                  </span>
                </div>
                <div
                  className="settings-segment"
                  role="group"
                  aria-labelledby="remote-image-label"
                >
                  {REMOTE_IMAGE_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="settings-segment-option"
                      aria-pressed={
                        props.state.remoteImagePolicy === option.id
                      }
                      onClick={() =>
                        props.onChange({
                          remoteImagePolicy: option.id,
                          loadRemoteImages: option.id === "allow",
                        })
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {props.isMobile ? (
            <section className="settings-section">
              <h3 className="settings-section-title">Swipe actions</h3>
              <p className="settings-copy">
                Near and far stops for each direction. Defaults: right archives,
                left deletes; farther right stars, farther left marks spam.
              </p>
              <div className="settings-group">
                {SWIPE_SLOTS.map((slot) => (
                  <div className="settings-row settings-row-stack" key={slot}>
                    <div className="settings-row-text">
                      <strong id={`swipe-${slot}-label`}>
                        {SWIPE_SLOT_LABELS[slot]}
                      </strong>
                    </div>
                    <label className="settings-select-wrap">
                      <span className="sr-only">
                        {SWIPE_SLOT_LABELS[slot]} action
                      </span>
                      <select
                        className="field-input settings-select"
                        aria-labelledby={`swipe-${slot}-label`}
                        value={props.state.swipeActions[slot]}
                        onChange={(event) =>
                          props.onChange({
                            swipeActions: {
                              ...props.state.swipeActions,
                              [slot]: event.target.value as
                                SettingsState["swipeActions"][SwipeSlot],
                            },
                          })
                        }
                      >
                        {SWIPE_ACTION_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="settings-section">
            <h3 className="settings-section-title">Privacy</h3>
            <p className="settings-copy">
              Mail stays on your devices by default. Remote features can be
              enabled separately for each account.
            </p>
            <div className="settings-group">
              <div className="settings-row">
                <div className="settings-row-text">
                  <strong>Remote processing</strong>
                  <span>
                    {props.consent?.enabled ? "Enabled for account" : "Off"}
                  </span>
                </div>
                <ActionButton
                  label="Manage"
                  onClick={props.onOpenRemoteProcessing}
                />
              </div>
              <div className="settings-row settings-switch-row">
                <div className="settings-row-text">
                  <strong id="read-receipt-label">Request read receipts</strong>
                  <span>Ask recipient clients for a read confirmation</span>
                </div>
                <label className="ios-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-labelledby="read-receipt-label"
                    checked={props.state.requestReadReceipt}
                    onChange={(event) =>
                      props.onChange({
                        requestReadReceipt: event.target.checked,
                      })
                    }
                  />
                  <span className="ios-switch-track" aria-hidden />
                </label>
              </div>
            </div>
          </section>

          <section className="settings-section">
            <h3 className="settings-section-title">MCP</h3>
            <p className="settings-copy">
              Let AI clients search your live local inbox over MCP while GalMail
              is open. Approvals appear in-app; mail stays on this device.
            </p>
            <div className="settings-group">
              <div className="settings-row settings-switch-row">
                <div className="settings-row-text">
                  <strong id="mcp-enabled-label">Enable MCP access</strong>
                  <span>Issue client tokens and enforce scopes</span>
                </div>
                <label className="ios-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-labelledby="mcp-enabled-label"
                    checked={props.mcpPolicy.enabled}
                    onChange={(event) =>
                      props.onMcpPolicyChange({ enabled: event.target.checked })
                    }
                  />
                  <span className="ios-switch-track" aria-hidden />
                </label>
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <strong>Live bridge</strong>
                  <span>
                    {props.mcpBridgeRunning
                      ? (props.mcpBridgeUrl ?? "Running")
                      : "Stopped - start after creating a client"}
                  </span>
                </div>
                {props.mcpBridgeRunning ? (
                  <ActionButton
                    label="Stop bridge"
                    onClick={props.onStopMcpBridge}
                  />
                ) : (
                  <ActionButton
                    label="Start bridge"
                    onClick={props.onStartMcpBridge}
                  />
                )}
              </div>
              <div className="settings-row settings-row-stack">
                <div className="settings-row-text">
                  <strong id="mcp-approval-label">Approval mode</strong>
                  <span>
                    Ask on writes, ask every time, or allow all for connected
                    clients (send still prompts)
                  </span>
                </div>
                <div
                  className="settings-segment"
                  role="group"
                  aria-labelledby="mcp-approval-label"
                >
                  {MCP_APPROVAL_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className="settings-segment-option"
                      aria-pressed={props.mcpPolicy.approvalMode === option.id}
                      onClick={() =>
                        props.onMcpPolicyChange({ approvalMode: option.id })
                      }
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <div className="settings-row-text">
                  <strong>AI clients</strong>
                  <span>
                    {
                      props.mcpPolicy.clients.filter(
                        (client) => !client.revokedAt,
                      ).length
                    }{" "}
                    active
                  </span>
                </div>
                <ActionButton
                  label="Create client"
                  onClick={props.onCreateMcpClient}
                />
              </div>
              {props.mcpPolicy.clients
                .filter((client) => !client.revokedAt)
                .map((client) => (
                  <div className="settings-row" key={client.id}>
                    <div className="settings-row-text">
                      <strong>{client.name}</strong>
                      <span>{client.scopes.join(", ")}</span>
                    </div>
                    <ActionButton
                      label="Revoke"
                      onClick={() => props.onRevokeMcpClient(client.id)}
                    />
                  </div>
                ))}
              {props.mcpCreatedToken && (
                <div className="settings-row settings-row-stack">
                  <div className="settings-row-text">
                    <strong>New client token</strong>
                    <span>Copy now; it is not shown again</span>
                  </div>
                  <code className="settings-mono">{props.mcpCreatedToken}</code>
                </div>
              )}
              {props.mcpCursorConfig && (
                <div className="settings-row settings-row-stack">
                  <div className="settings-row-text">
                    <strong>Cursor snippet</strong>
                    <span>Keep GalMail open with the live bridge running</span>
                  </div>
                  <pre className="settings-mono settings-pre">
                    {props.mcpCursorConfig}
                  </pre>
                </div>
              )}
            </div>
          </section>

          <section className="settings-section settings-advanced">
            <h3 className="settings-section-title">Advanced</h3>
            <div className="settings-group">
              <div className="settings-row settings-switch-row">
                <div className="settings-row-text">
                  <strong id="developer-mode-label">Developer mode</strong>
                  <span>Diagnostics and runtime state</span>
                </div>
                <label className="ios-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-labelledby="developer-mode-label"
                    checked={props.state.developerMode}
                    onChange={(event) =>
                      props.onChange({ developerMode: event.target.checked })
                    }
                  />
                  <span className="ios-switch-track" aria-hidden />
                </label>
              </div>
            </div>
            {props.state.developerMode && (
              <div className="diagnostics" aria-label="Developer diagnostics">
                {props.diagnostics.map((item) => (
                  <code key={item}>{item}</code>
                ))}
              </div>
            )}
          </section>
        </div>
      </section>
    </div>
  );
}
