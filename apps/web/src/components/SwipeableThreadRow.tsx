import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  resolveSwipeAction,
  SWIPE_FAR_PX,
  SWIPE_NEAR_PX,
  swipeActionLabel,
  swipeActionTone,
  type SwipeActionSettings,
  type SwipeMailAction,
} from "../lib/swipe-actions";
import { Icons } from "./Icons";

function actionIcon(action: SwipeMailAction) {
  switch (action) {
    case "archive":
      return <Icons.archive />;
    case "trash":
      return <Icons.trash />;
    case "spam":
      return <Icons.warning />;
    case "star":
      return <Icons.star />;
    case "mark_read":
      return <Icons.mailOpen />;
    case "mark_unread":
      return <Icons.mail />;
    default:
      return null;
  }
}

export function SwipeableThreadRow(props: {
  enabled: boolean;
  settings: SwipeActionSettings;
  onAction: (action: SwipeMailAction) => void;
  children: ReactNode;
}) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef<"undecided" | "x" | "y">("undecided");
  const pointerId = useRef<number | null>(null);
  const offsetRef = useRef(0);

  if (!props.enabled) {
    return <>{props.children}</>;
  }

  const pending = resolveSwipeAction(offset, props.settings);
  const revealLeft = offset > 0;
  const revealAction = pending && pending !== "none" ? pending : null;
  const progress = Math.min(1, Math.abs(offset) / SWIPE_FAR_PX);
  const atFar = Math.abs(offset) >= SWIPE_FAR_PX;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    pointerId.current = event.pointerId;
    startX.current = event.clientX;
    startY.current = event.clientY;
    axis.current = "undecided";
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    const dx = event.clientX - startX.current;
    const dy = event.clientY - startY.current;
    if (axis.current === "undecided") {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
      axis.current = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      if (axis.current === "y") return;
    }
    if (axis.current !== "x") return;
    event.preventDefault();
    const next = Math.max(-SWIPE_FAR_PX - 24, Math.min(SWIPE_FAR_PX + 24, dx));
    offsetRef.current = next;
    setOffset(next);
  };

  const finish = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointerId.current !== event.pointerId) return;
    pointerId.current = null;
    setDragging(false);
    const action =
      axis.current === "x"
        ? resolveSwipeAction(offsetRef.current, props.settings)
        : null;
    offsetRef.current = 0;
    setOffset(0);
    axis.current = "undecided";
    if (action && action !== "none") {
      props.onAction(action);
    }
  };

  return (
    <div
      className={`swipe-row${dragging ? " is-dragging" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    >
      <div
        className={`swipe-reveal swipe-reveal-left tone-${swipeActionTone(
          props.settings.rightNear,
        )}${revealLeft && revealAction ? " is-active" : ""}`}
        aria-hidden
        data-far={revealLeft && atFar ? "true" : "false"}
        style={{ opacity: revealLeft ? Math.max(0.35, progress) : 0 }}
      >
        <span className="swipe-reveal-icon">
          {actionIcon(
            revealLeft && revealAction
              ? revealAction
              : Math.abs(offset) >= SWIPE_NEAR_PX
                ? props.settings.rightNear
                : props.settings.rightFar,
          )}
        </span>
        <span className="swipe-reveal-label">
          {swipeActionLabel(
            revealLeft && revealAction
              ? revealAction
              : props.settings.rightNear,
          )}
        </span>
      </div>
      <div
        className={`swipe-reveal swipe-reveal-right tone-${swipeActionTone(
          props.settings.leftNear,
        )}${!revealLeft && revealAction ? " is-active" : ""}`}
        aria-hidden
        data-far={!revealLeft && atFar ? "true" : "false"}
        style={{ opacity: !revealLeft && offset < 0 ? Math.max(0.35, progress) : 0 }}
      >
        <span className="swipe-reveal-icon">
          {actionIcon(
            !revealLeft && revealAction
              ? revealAction
              : props.settings.leftNear,
          )}
        </span>
        <span className="swipe-reveal-label">
          {swipeActionLabel(
            !revealLeft && revealAction
              ? revealAction
              : props.settings.leftNear,
          )}
        </span>
      </div>
      <div
        className="swipe-row-content"
        style={{
          transform: `translate3d(${offset}px, 0, 0)`,
          transition: dragging ? "none" : "transform 180ms ease",
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
