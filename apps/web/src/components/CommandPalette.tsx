import { Command } from "cmdk";
import type { CommandDef, CommandId } from "@galmail/keyboard";
import { formatShortcutKeys } from "@galmail/keyboard";

export function CommandPalette(props: {
  open: boolean;
  commands: CommandDef[];
  onClose: () => void;
  onRun: (id: CommandId) => void;
}) {
  return (
    <Command.Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      label="Command palette"
      overlayClassName="cmdk-overlay"
      contentClassName="cmdk-content"
      loop
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          // App-level layered Escape handler owns dismiss + focus restore.
          e.preventDefault();
        }
      }}
    >
      <Command.Input
        className="field-input"
        placeholder="Type a command or search…"
        autoFocus
      />
      <Command.List>
        <Command.Empty>No matching commands.</Command.Empty>
        <Command.Group heading="Commands">
          {props.commands.map((command) => (
            <Command.Item
              key={command.id}
              value={`${command.title} ${command.id} ${command.defaultKeys.join(" ")}`}
              keywords={[command.id, ...command.defaultKeys]}
              onSelect={() => props.onRun(command.id)}
            >
              <span>{command.title}</span>
              <span className="kbd">
                {formatShortcutKeys(command.defaultKeys)}
              </span>
            </Command.Item>
          ))}
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
