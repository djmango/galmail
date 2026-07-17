import {
  useCallback,
  useRef,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import {
  formatShortcutKeys,
  keysForCommand,
  shortcutTooltip,
  type CommandId,
} from "@galmail/keyboard";

type TipSide = "top" | "bottom" | "right";

type ActionButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "title"
> & {
  label: string;
  icon?: ReactNode;
  command?: CommandId;
  shortcutKeys?: string[];
  variant?: "default" | "primary" | "quiet";
  /** Force a compact icon control with no in-flow label (flyout tip still shows). */
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

const TIP_GAP = 6;
const TIP_EDGE = 8;

function placeFlyoutTip(
  button: HTMLElement,
  tip: HTMLElement,
): { side: TipSide; top: number; left: number } | null {
  // Expanded sidebar keeps the label in-flow — no flyout to place.
  if (getComputedStyle(tip).position === "static") return null;

  const br = button.getBoundingClientRect();
  const prev = {
    position: tip.style.position,
    top: tip.style.top,
    left: tip.style.left,
    right: tip.style.right,
    bottom: tip.style.bottom,
    transform: tip.style.transform,
    opacity: tip.style.opacity,
    visibility: tip.style.visibility,
  };
  tip.style.position = "fixed";
  tip.style.top = "0";
  tip.style.left = "0";
  tip.style.right = "auto";
  tip.style.bottom = "auto";
  tip.style.transform = "none";
  tip.style.opacity = "0";
  tip.style.visibility = "hidden";
  const tr = tip.getBoundingClientRect();
  tip.style.position = prev.position;
  tip.style.top = prev.top;
  tip.style.left = prev.left;
  tip.style.right = prev.right;
  tip.style.bottom = prev.bottom;
  tip.style.transform = prev.transform;
  tip.style.opacity = prev.opacity;
  tip.style.visibility = prev.visibility;

  const inSidebar = Boolean(button.closest(".sidebar"));
  const collapsedSidebar =
    inSidebar &&
    button.closest('.app[data-sidebar="collapsed"]') != null;

  let side: TipSide = "top";
  if (collapsedSidebar) {
    side = "right";
  } else if (br.top < tr.height + TIP_GAP + TIP_EDGE) {
    side = "bottom";
  }

  let top = 0;
  let left = 0;
  if (side === "top") {
    top = br.top - tr.height - TIP_GAP;
    left = br.left + br.width / 2 - tr.width / 2;
  } else if (side === "bottom") {
    top = br.bottom + TIP_GAP;
    left = br.left + br.width / 2 - tr.width / 2;
  } else {
    top = br.top + br.height / 2 - tr.height / 2;
    left = br.right + TIP_GAP;
  }

  left = Math.max(TIP_EDGE, Math.min(left, window.innerWidth - tr.width - TIP_EDGE));
  top = Math.max(TIP_EDGE, Math.min(top, window.innerHeight - tr.height - TIP_EDGE));

  return { side, top, left };
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
  onPointerEnter,
  onFocus,
  ...buttonProps
}: ActionButtonProps) {
  const keys = shortcutKeys ?? (command ? keysForCommand(command) : []);
  const shortcut = formatShortcutKeys(keys);
  const tipText = tooltip ?? shortcutTooltip(label, keys);
  const useReveal = !iconOnly && (reveal ?? Boolean(icon));
  /** Styled flyout tip (replaces native title tooltips). */
  const useFlyoutTip = useReveal || iconOnly;
  const labelText = children ?? label;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);

  const updateTipPlacement = useCallback(() => {
    const button = buttonRef.current;
    const tip = tipRef.current;
    if (!button || !tip || !useFlyoutTip) return;
    const placed = placeFlyoutTip(button, tip);
    if (!placed) {
      button.style.removeProperty("--tip-top");
      button.style.removeProperty("--tip-left");
      button.removeAttribute("data-tip-side");
      button.removeAttribute("data-tip-fixed");
      return;
    }
    button.style.setProperty("--tip-top", `${placed.top}px`);
    button.style.setProperty("--tip-left", `${placed.left}px`);
    button.setAttribute("data-tip-side", placed.side);
    button.setAttribute("data-tip-fixed", "true");
  }, [useFlyoutTip]);

  return (
    <button
      {...buttonProps}
      ref={buttonRef}
      type={buttonProps.type ?? "button"}
      className={[
        "ui-button",
        `ui-button-${variant}`,
        iconOnly ? "ui-icon-button" : "",
        useFlyoutTip ? "ui-button-reveal" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      // Prefer the styled flyout; native title fights it and looks worse.
      title={useFlyoutTip ? undefined : tipText}
      aria-label={
        iconOnly || useReveal ? label : buttonProps["aria-label"]
      }
      aria-keyshortcuts={buttonProps["aria-keyshortcuts"] ?? ariaShortcut(keys)}
      onPointerEnter={(event) => {
        updateTipPlacement();
        onPointerEnter?.(event);
      }}
      onFocus={(event) => {
        updateTipPlacement();
        onFocus?.(event);
      }}
    >
      {icon && (
        <span className="ui-button-icon" aria-hidden>
          {icon}
        </span>
      )}
      {useFlyoutTip || !iconOnly ? (
        <span
          ref={tipRef}
          className="ui-button-copy"
          // Decorative when flyout; in-flow labels remain readable.
          aria-hidden={useFlyoutTip ? true : undefined}
        >
          <span className="ui-button-copy-clip">
            <span className="ui-button-label">{labelText}</span>
            {showShortcut && shortcut ? (
              <span className="kbd">{shortcut}</span>
            ) : null}
          </span>
        </span>
      ) : null}
    </button>
  );
}
