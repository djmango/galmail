import type { RemoteProcessingConsent } from "@galmail/core-api";
import type { ThemePreference } from "../lib/themes";
import { ActionButton } from "./ActionButton";
import { Icons } from "./Icons";
import { SettingsBar, type SettingsState } from "./SettingsBar";

export type SettingsAccount = {
  email: string;
  provider: "gmail" | "microsoft" | "fixture";
  live: boolean;
};

const THEME_OPTIONS: { id: ThemePreference; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "Auto" },
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
  onChange: (next: Partial<SettingsState>) => void;
  onClose: () => void;
  onOpenRemoteProcessing: () => void;
  onLinkDevice: () => void;
  onConnectGmail: () => void;
  onConnectMicrosoft: () => void;
  onDisconnectGmail?: () => void;
  onDisconnectMicrosoft?: () => void;
}) {
  const liveGmail = props.accounts.find(
    (account) => account.provider === "gmail" && account.live,
  );
  const liveMicrosoft = props.accounts.find(
    (account) => account.provider === "microsoft" && account.live,
  );
  const connecting = props.gmailConnecting || props.microsoftConnecting;

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
                ? "Using live provider accounts on this device."
                : "Showing fixture mail until you connect a real account."}
            </p>
            <div className="settings-group">
              {props.accounts.map((account) => (
                <div
                  className="settings-row account-row"
                  key={`${account.provider}:${account.email}`}
                >
                  <div className="settings-row-text">
                    <strong>{account.email}</strong>
                    <span>
                      {account.provider === "gmail"
                        ? "Gmail"
                        : account.provider === "microsoft"
                          ? "Microsoft 365"
                          : "Fixture"}
                      {account.live ? " · live" : " · demo"}
                    </span>
                  </div>
                  <span className="account-state">
                    {account.live ? "Connected" : "Demo"}
                  </span>
                </div>
              ))}
            </div>
            <div className="settings-actions">
              {props.canConnectGmail && !liveGmail && (
                <ActionButton
                  label={
                    props.gmailConnecting
                      ? "Waiting for Google…"
                      : "Sign in with Google"
                  }
                  icon={<Icons.google />}
                  variant="primary"
                  reveal={false}
                  showShortcut={false}
                  disabled={connecting}
                  onClick={props.onConnectGmail}
                />
              )}
              {props.canConnectMicrosoft && !liveMicrosoft && (
                <ActionButton
                  label={
                    props.microsoftConnecting
                      ? "Waiting for Microsoft…"
                      : "Sign in with Microsoft"
                  }
                  icon={<Icons.microsoft />}
                  variant={liveGmail || !props.canConnectGmail ? "primary" : "quiet"}
                  reveal={false}
                  showShortcut={false}
                  disabled={connecting}
                  onClick={props.onConnectMicrosoft}
                />
              )}
              {liveGmail && props.onDisconnectGmail && (
                <ActionButton
                  label="Disconnect Gmail"
                  onClick={props.onDisconnectGmail}
                />
              )}
              {liveMicrosoft && props.onDisconnectMicrosoft && (
                <ActionButton
                  label="Disconnect Microsoft"
                  onClick={props.onDisconnectMicrosoft}
                />
              )}
              <ActionButton
                label="Link another device"
                onClick={props.onLinkDevice}
              />
            </div>
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
              <div className="settings-row settings-row-stack">
                <div className="settings-row-text">
                  <strong id="layout-label">Inbox layout</strong>
                  <span>How threads and reading panes are arranged</span>
                </div>
                <SettingsBar state={props.state} onChange={props.onChange} />
              </div>
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
              <div className="settings-row settings-switch-row">
                <div className="settings-row-text">
                  <strong id="load-remote-images-label">
                    Load remote images
                  </strong>
                  <span>
                    Allow images hosted off-device when opening mail; can still
                    toggle per message
                  </span>
                </div>
                <label className="ios-switch">
                  <input
                    type="checkbox"
                    role="switch"
                    aria-labelledby="load-remote-images-label"
                    checked={props.state.loadRemoteImages}
                    onChange={(event) =>
                      props.onChange({
                        loadRemoteImages: event.target.checked,
                      })
                    }
                  />
                  <span className="ios-switch-track" aria-hidden />
                </label>
              </div>
            </div>
          </section>

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
                    {props.consent?.enabled ? "Enabled for Gmail" : "Off"}
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
