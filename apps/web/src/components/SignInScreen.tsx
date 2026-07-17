import brandMark from "../assets/galmail-mark.png";
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
  /** Tauri / native shell (Mac or iOS). */
  nativeShell?: boolean;
}) {
  const canConnectLive = props.canConnectGmail || props.canConnectMicrosoft;
  const configCopy = !canConnectLive
    ? props.nativeShell
      ? "Provider client IDs are not configured for this build. Set VITE_GOOGLE_DESKTOP_CLIENT_ID / VITE_GOOGLE_IOS_CLIENT_ID and VITE_MICROSOFT_CLIENT_ID, or browse the demo mailbox."
      : "Live sign-in needs the GalMail app (Mac or iOS) with a configured provider client ID. You can browse the demo mailbox in the browser."
    : null;

  return (
    <main className="sign-in" aria-labelledby="sign-in-title">
      <div className="sign-in-card">
        <img
          className="sign-in-logo"
          src={brandMark}
          alt=""
          width={56}
          height={56}
          decoding="async"
        />
        <p className="eyebrow">GalMail</p>
        <h1 id="sign-in-title">Sign in to your mail</h1>
        {configCopy && <p className="sign-in-copy">{configCopy}</p>}
        <div className="sign-in-actions">
          {props.canConnectGmail && (
            <ActionButton
              label={
                props.connecting ? "Waiting for Google…" : "Sign in with Google"
              }
              icon={<Icons.google />}
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
      </div>
    </main>
  );
}
