import { LAYOUTS, type LayoutMode } from "../lib/themes";

export interface SettingsState {
  theme: import("../lib/themes").ThemeId;
  layout: LayoutMode;
  developerMode: boolean;
}

export function SettingsBar(props: {
  state: SettingsState;
  onChange: (next: Partial<SettingsState>) => void;
}) {
  return (
    <div className="layout-switcher" role="group" aria-label="Inbox layout">
      {LAYOUTS.map((layout) => (
        <button
          key={layout.id}
          type="button"
          className="layout-option"
          aria-label={layout.label}
          aria-pressed={props.state.layout === layout.id}
          title={`${layout.label}: ${layout.blurb}`}
          onClick={() => props.onChange({ layout: layout.id })}
        >
          <span aria-hidden>{layout.icon}</span>
          <span className="layout-option-label">{layout.shortLabel}</span>
        </button>
      ))}
    </div>
  );
}
