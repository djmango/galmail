import { useEffect, useRef, useState } from "react";
import {
  LAYOUTS,
  SIDEBAR_LABELS,
  type LayoutMode,
  type SidebarMode,
} from "../lib/themes";

export interface SettingsState {
  theme: import("../lib/themes").ThemeId;
  layout: LayoutMode;
  sidebar: SidebarMode;
}

export function SettingsBar(props: {
  state: SettingsState;
  onChange: (next: Partial<SettingsState>) => void;
}) {
  const [open, setOpen] = useState<null | "layout">(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  const trigger = (which: "layout") => ({
    className: `btn menu-trigger ${open === which ? "active" : ""}`,
    type: "button" as const,
    onClick: () => setOpen((cur) => (cur === which ? null : which)),
  });

  return (
    <div className="settings-bar" ref={ref}>
      <div className="menu">
        <button {...trigger("layout")} title="Switch layout">
          <span aria-hidden>▦</span>
          <span>
            {LAYOUTS.find((l) => l.id === props.state.layout)?.label ?? "Layout"}
          </span>
          <span className="kbd">▾</span>
        </button>
        {open === "layout" && (
          <div className="menu-pop" role="menu">
            <div className="menu-section">Layout mode</div>
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`menu-item ${props.state.layout === l.id ? "active" : ""}`}
                onClick={() => {
                  props.onChange({ layout: l.id });
                  setOpen(null);
                }}
              >
                <span className="menu-text">
                  <div className="menu-title">{l.label}</div>
                  <div className="menu-blurb">{l.blurb}</div>
                </span>
                {props.state.layout === l.id && <span className="menu-check">✓</span>}
              </button>
            ))}
            {props.state.layout === "two-panel" && (
              <>
                <div className="menu-section">Sidebar</div>
                <div className="menu-sub">
                  {(["auto", "always"] as SidebarMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={props.state.sidebar === m ? "active" : ""}
                      onClick={() => props.onChange({ sidebar: m })}
                    >
                      {SIDEBAR_LABELS[m]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
