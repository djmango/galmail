import { useEffect, useRef, useState } from "react";
import {
  LAYOUTS,
  SIDEBAR_LABELS,
  THEMES,
  type LayoutMode,
  type SidebarMode,
  type ThemeId,
} from "../lib/themes";

export interface SettingsState {
  theme: ThemeId;
  layout: LayoutMode;
  sidebar: SidebarMode;
}

export function SettingsBar(props: {
  state: SettingsState;
  onChange: (next: Partial<SettingsState>) => void;
}) {
  const [open, setOpen] = useState<null | "theme" | "layout">(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  const trigger = (which: "theme" | "layout") => ({
    className: `btn menu-trigger ${open === which ? "active" : ""}`,
    type: "button" as const,
    onClick: () => setOpen((cur) => (cur === which ? null : which)),
  });

  return (
    <div className="settings-bar" ref={ref}>
      <div className="menu">
        <button {...trigger("theme")} title="Switch theme">
          <span aria-hidden>🎨</span>
          <span>{THEMES.find((t) => t.id === props.state.theme)?.label ?? "Theme"}</span>
          <span className="kbd">▾</span>
        </button>
        {open === "theme" && (
          <div className="menu-pop" role="menu">
            <div className="menu-section">Theme — design principles</div>
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`menu-item ${props.state.theme === t.id ? "active" : ""}`}
                onClick={() => {
                  props.onChange({ theme: t.id });
                  setOpen(null);
                }}
              >
                <span className="swatch">
                  {t.swatch.map((c, i) => (
                    <span key={i} style={{ background: c }} />
                  ))}
                </span>
                <span className="menu-text">
                  <div className="menu-title">{t.label}</div>
                  <div className="menu-blurb">{t.blurb}</div>
                </span>
                {props.state.theme === t.id && <span className="menu-check">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>

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
