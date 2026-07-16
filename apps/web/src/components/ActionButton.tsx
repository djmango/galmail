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
  /** Force a compact icon control with no hover reveal. */
  iconOnly?: boolean;
  /**
   * Icon-first control; label flyout on hover/focus (transform + opacity).
   * Defaults to true whenever an icon is provided (unless iconOnly).
   * Sidebar nav keeps labels open when the rail is expanded.
   */
  reveal?: boolean;
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
  reveal,
  showShortcut = true,
  tooltip,
  className = "",
  children,
  ...buttonProps
}: ActionButtonProps) {
  const keys = shortcutKeys ?? (command ? keysForCommand(command) : []);
  const shortcut = formatShortcutKeys(keys);
  const title = tooltip ?? shortcutTooltip(label, keys);
  const useReveal = !iconOnly && (reveal ?? Boolean(icon));
  const labelText = children ?? label;

  return (
    <button
      {...buttonProps}
      type={buttonProps.type ?? "button"}
      className={[
        "ui-button",
        `ui-button-${variant}`,
        iconOnly ? "ui-icon-button" : "",
        useReveal ? "ui-button-reveal" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      title={title}
      aria-label={iconOnly || useReveal ? label : buttonProps["aria-label"]}
      aria-keyshortcuts={buttonProps["aria-keyshortcuts"] ?? ariaShortcut(keys)}
    >
      {icon && (
        <span className="ui-button-icon" aria-hidden>
          {icon}
        </span>
      )}
      {!iconOnly && (
        <span className="ui-button-copy">
          <span className="ui-button-copy-clip">
            <span className="ui-button-label">{labelText}</span>
            {showShortcut && shortcut ? (
              <span className="kbd">{shortcut}</span>
            ) : null}
          </span>
        </span>
      )}
    </button>
  );
}
