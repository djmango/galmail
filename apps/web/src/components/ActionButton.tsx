import type { ButtonHTMLAttributes, ReactNode } from "react";
import {
  formatShortcutKeys,
  keysForCommand,
  shortcutTooltip,
  type CommandId,
} from "@galmail/keyboard";

type ActionButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "title"
> & {
  label: string;
  icon?: ReactNode;
  command?: CommandId;
  shortcutKeys?: string[];
  variant?: "default" | "primary" | "quiet";
  iconOnly?: boolean;
  showShortcut?: boolean;
  tooltip?: string;
};

function ariaShortcut(keys: string[]): string | undefined {
  if (keys.length === 0) return undefined;
  return keys
    .map((key) =>
      key
        .replace("meta", "Meta")
        .replace("ctrl", "Control")
        .replace("alt", "Alt")
        .replace("escape", "Escape")
        .replace("enter", "Enter")
        .split("+")
        .map((part) => (part.length === 1 ? part.toUpperCase() : part))
        .join("+"),
    )
    .join(" ");
}

export function ActionButton({
  label,
  icon,
  command,
  shortcutKeys,
  variant = "default",
  iconOnly = false,
  showShortcut = true,
  tooltip,
  className = "",
  children,
  ...buttonProps
}: ActionButtonProps) {
  const keys = shortcutKeys ?? (command ? keysForCommand(command) : []);
  const shortcut = formatShortcutKeys(keys);
  const title = tooltip ?? shortcutTooltip(label, keys);

  return (
    <button
      {...buttonProps}
      type={buttonProps.type ?? "button"}
      className={`ui-button ui-button-${variant} ${iconOnly ? "ui-icon-button" : ""} ${className}`}
      title={title}
      aria-label={iconOnly ? label : buttonProps["aria-label"]}
      aria-keyshortcuts={buttonProps["aria-keyshortcuts"] ?? ariaShortcut(keys)}
    >
      {icon && (
        <span className="ui-button-icon" aria-hidden>
          {icon}
        </span>
      )}
      {!iconOnly && <span>{children ?? label}</span>}
      {!iconOnly && showShortcut && shortcut && (
        <span className="kbd">{shortcut}</span>
      )}
    </button>
  );
}
