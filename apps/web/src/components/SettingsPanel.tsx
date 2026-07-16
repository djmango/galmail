import type { RemoteProcessingConsent } from "@galmail/core-api";
import { ActionButton } from "./ActionButton";
import { SettingsBar, type SettingsState } from "./SettingsBar";

export type SettingsAccount = {
  email: string;
  provider: "gmail" | "microsoft" | "fixture";
  live: boolean;
};

export function SettingsPanel(props: {
  state: SettingsState;
  consent: RemoteProcessingConsent | null;
  diagnostics: string[];
  inviteCode: string | null;
  accounts: SettingsAccount[];
  providerMode: "fixture" | "live";
  canConnectGmail: boolean;
  gmailConnecting: boolean;
  connectError: string | null;
  onChange: (next: Partial<SettingsState>) => void;
  onClose: () => void;
  onOpenRemoteProcessing: () => void;
  onLinkDevice: () => void;
  onConnectGmail: () => void;
  onDisconnectGmail?: () => void;
}) {
  const liveGmail = props.accounts.find(
    (account) => account.provider === "gmail" && account.live,
  );
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
        <div className="settings-head">
          <div>
            <p className="eyebrow">Account</p>
            <h2 id="settings-title">Settings</h2>
          </div>
          <ActionButton
            label="Close settings"
            icon="×"
            iconOnly
            onClick={props.onClose}
          />
        </div>

        <div className="settings-section">
          <h3>Accounts and devices</h3>
          <p className="settings-copy">
            {props.providerMode === "live"
              ? "Using live provider accounts on this device."
              : "Showing fixture mail until you connect a real account."}
          </p>
          {props.accounts.map((account) => (
            <div
              className="account-row"
              key={`${account.provider}:${account.email}`}
            >
              <div>
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
          {props.canConnectGmail && !liveGmail && (
            <ActionButton
              label={
                props.gmailConnecting ? "Waiting for Google…" : "Connect Gmail"
              }
              variant="primary"
              disabled={props.gmailConnecting}
              onClick={props.onConnectGmail}
            />
          )}
          {liveGmail && props.onDisconnectGmail && (
            <ActionButton
              label="Disconnect Gmail"
              onClick={props.onDisconnectGmail}
            />
          )}
          {props.connectError && (
            <p className="settings-note" role="alert">
              {props.connectError}
            </p>
          )}
          <ActionButton
            label="Link another device"
            onClick={props.onLinkDevice}
          />
          {props.inviteCode && (
            <p className="settings-note" role="status">
              Device code <strong>{props.inviteCode}</strong> expires in 15
              minutes.
            </p>
          )}
        </div>

        <div className="settings-section">
          <h3>Appearance</h3>
          <div className="settings-control">
            <span>Theme</span>
            <div className="settings-choice" role="group" aria-label="Theme">
              {(["dark", "light"] as const).map((theme) => (
                <ActionButton
                  key={theme}
                  label={theme === "dark" ? "Dark" : "Light"}
                  aria-pressed={props.state.theme === theme}
                  variant={props.state.theme === theme ? "primary" : "default"}
                  onClick={() => props.onChange({ theme })}
                />
              ))}
            </div>
          </div>
          <div className="settings-control settings-layout-control">
            <span>Inbox layout</span>
            <SettingsBar state={props.state} onChange={props.onChange} />
          </div>
        </div>

        <div className="settings-section">
          <h3>Privacy</h3>
          <p className="settings-copy">
            Mail stays on your devices by default. Remote features can be
            enabled separately for each account.
          </p>
          <div className="settings-control">
            <div>
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
        </div>

        <div className="settings-section settings-advanced">
          <div className="settings-control">
            <div>
              <h3>Advanced</h3>
              <span>Developer diagnostics and runtime state</span>
            </div>
            <label className="toggle-label">
              <input
                type="checkbox"
                checked={props.state.developerMode}
                onChange={(event) =>
                  props.onChange({ developerMode: event.target.checked })
                }
              />
              Developer mode
            </label>
          </div>
          {props.state.developerMode && (
            <div className="diagnostics" aria-label="Developer diagnostics">
              {props.diagnostics.map((item) => (
                <code key={item}>{item}</code>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
