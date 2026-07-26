import {
  LAYOUTS,
  type LayoutMode,
  type RemoteImagePolicy,
  type ThemePreference,
} from "../lib/themes";
import type { SwipeActionSettings } from "../lib/swipe-actions";
import { Icons } from "./Icons";

export interface SettingsState {
  theme: ThemePreference;
  layout: LayoutMode;
  developerMode: boolean;
  /** Request read receipts on send. Off by default. */
  requestReadReceipt: boolean;
  /** Load remote images in the reading pane by default. On by default. */
  loadRemoteImages: boolean;
  /** Remote-image approval: never, ask per message, or allow all. */
  remoteImagePolicy: RemoteImagePolicy;
  /** Move the message to Trash after a successful unsubscribe. On by default. */
  trashAfterUnsubscribe: boolean;
  /** Mobile swipe gesture bindings for the thread list. */
  swipeActions: SwipeActionSettings;
}

const layoutIcons = {
  layoutSingle: Icons.layoutSingle,
  layoutSplit: Icons.layoutSplit,
  layoutThree: Icons.layoutThree,
} as const;

export function SettingsBar(props: {
  state: SettingsState;
  onChange: (next: Partial<SettingsState>) => void;
}) {
  return (
    <div className="layout-switcher" role="group" aria-label="Inbox layout">
      {LAYOUTS.map((layout) => {
        const Icon = layoutIcons[layout.icon];
        return (
          <button
            key={layout.id}
            type="button"
            className="layout-option"
            aria-label={layout.label}
            aria-pressed={props.state.layout === layout.id}
            title={`${layout.label}: ${layout.blurb}`}
            onClick={() => props.onChange({ layout: layout.id })}
          >
            <span aria-hidden>
              <Icon />
            </span>
            <span className="layout-option-label">{layout.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}
