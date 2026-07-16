import { ActionButton } from "./ActionButton";
import { Icons } from "./Icons";

export function SignInScreen(props: {
  connecting: boolean;
  error: string | null;
  canConnectGmail: boolean;
  canConnectMicrosoft: boolean;
  onConnectGmail: () => void;
  onConnectMicrosoft: () => void;
  onUseDemo: () => void;
  showDemoOption: boolean;
}) {
  const canConnectLive = props.canConnectGmail || props.canConnectMicrosoft;
  return (
    <main className="sign-in" aria-labelledby="sign-in-title">
      <div className="sign-in-card">
        <p className="eyebrow">GalMail</p>
        <h1 id="sign-in-title">Sign in to your mail</h1>
        <p className="sign-in-copy">
          {canConnectLive
            ? "Connect Gmail or Microsoft 365 to sync on this device. Mail stays local by default."
            : "Live sign-in needs the GalMail Mac app and a configured provider client ID. You can browse the demo mailbox in the browser."}
        </p>
        <div className="sign-in-actions">
          {props.canConnectGmail && (
            <ActionButton
              label={
                props.connecting ? "Waiting for Google…" : "Sign in with Google"
              }
              icon={<Icons.google />}
              variant="primary"
              reveal={false}
              showShortcut={false}
              disabled={props.connecting}
              onClick={props.onConnectGmail}
            />
          )}
          {props.canConnectMicrosoft && (
            <ActionButton
              label={
                props.connecting
                  ? "Waiting for Microsoft…"
                  : "Sign in with Microsoft"
              }
              icon={<Icons.microsoft />}
              variant={props.canConnectGmail ? "quiet" : "primary"}
              reveal={false}
              showShortcut={false}
              disabled={props.connecting}
              onClick={props.onConnectMicrosoft}
            />
          )}
          {props.showDemoOption && (
            <ActionButton
              label="Browse demo mailbox"
              variant={canConnectLive ? "quiet" : "primary"}
              showShortcut={false}
              disabled={props.connecting}
              onClick={props.onUseDemo}
            />
          )}
        </div>
        {props.error && (
          <p className="settings-note" role="alert">
            {props.error}
          </p>
        )}
        {canConnectLive && (
          <p className="sign-in-hint">
            A browser window will open for sign-in. Approve access, then return
            here.
          </p>
        )}
      </div>
    </main>
  );
}
