import { LAYOUTS, type LayoutMode } from "../lib/themes";
import { Icons } from "./Icons";

export interface SettingsState {
  theme: import("../lib/themes").ThemeId;
  layout: LayoutMode;
  developerMode: boolean;
  /** Request read receipts on send. Off by default. */
  requestReadReceipt: boolean;
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
