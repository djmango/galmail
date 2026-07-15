import { useMemo, useState } from "react";
import type { CommandDef, CommandId } from "@galmail/keyboard";

export function CommandPalette(props: {
  commands: CommandDef[];
  onClose: () => void;
  onRun: (id: CommandId) => void;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return props.commands;
    return props.commands.filter(
      (c) =>
        c.title.toLowerCase().includes(needle) ||
        c.id.includes(needle) ||
        c.defaultKeys.some((k) => k.includes(needle)),
    );
  }, [props.commands, q]);

  return (
    <div className="modal" role="dialog" aria-label="Command palette">
      <div className="modal-card palette">
        <input
          autoFocus
          placeholder="Type a command…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              // App-level layered Escape handler owns dismiss + focus restore.
              e.preventDefault();
              return;
            }
            if (e.key === "Enter" && filtered[0]) props.onRun(filtered[0].id);
          }}
        />
        {filtered.map((c, i) => (
          <button
            key={c.id}
            type="button"
            className={`palette-item ${i === 0 ? "active" : ""}`}
            title={`${c.title} · ${c.defaultKeys.join(" · ")}`}
            onClick={() => props.onRun(c.id)}
          >
            <span>{c.title}</span>
            <span className="kbd">{c.defaultKeys.join(" · ")}</span>
          </button>
        ))}
        <button
          className="btn"
          type="button"
          title="Close · Esc"
          onClick={props.onClose}
        >
          Close
        </button>
      </div>
    </div>
  );
}
