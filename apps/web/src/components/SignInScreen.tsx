import { ActionButton } from "./ActionButton";
import { Icons } from "./Icons";

export function SignInScreen(props: {
  connecting: boolean;
  error: string | null;
  canConnectGmail: boolean;
  onConnectGmail: () => void;
  onUseDemo: () => void;
  showDemoOption: boolean;
}) {
  return (
    <main className="sign-in" aria-labelledby="sign-in-title">
      <div className="sign-in-card">
        <p className="eyebrow">GalMail</p>
        <h1 id="sign-in-title">Sign in to your mail</h1>
        <p className="sign-in-copy">
          {props.canConnectGmail
            ? "Connect Gmail to sync your real inbox on this device. Mail stays local by default."
            : "Live Gmail sign-in needs the GalMail Mac app. You can browse the demo mailbox in the browser."}
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
          {props.showDemoOption && (
            <ActionButton
              label="Browse demo mailbox"
              variant={props.canConnectGmail ? "quiet" : "primary"}
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
        {props.canConnectGmail && (
          <p className="sign-in-hint">
            A browser window will open for Google. Approve access, then return
            here.
          </p>
        )}
      </div>
    </main>
  );
}
