import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { title?: string };

function Svg({
  title,
  children,
  ...props
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

export const Icons = {
  inbox: (props: IconProps) => (
    <Svg {...props}>
      <path d="M4 6h16v12H4z" />
      <path d="M4 10h4l2 3h4l2-3h4" />
    </Svg>
  ),
  archive: (props: IconProps) => (
    <Svg {...props}>
      <path d="M3 7h18v3H3z" />
      <path d="M5 10v9h14v-9" />
      <path d="M10 14h4" />
    </Svg>
  ),
  star: (props: IconProps) => (
    <Svg {...props}>
      <path d="M12 3l2.6 5.3L20 9.2l-4 3.9.9 5.5L12 16.3 7.1 18.6 8 13.1 4 9.2l5.4-.9L12 3z" />
    </Svg>
  ),
  trash: (props: IconProps) => (
    <Svg {...props}>
      <path d="M5 7h14" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 12h8l1-12" />
    </Svg>
  ),
  warning: (props: IconProps) => (
    <Svg {...props}>
      <path d="M12 4l9 16H3L12 4z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </Svg>
  ),
  tag: (props: IconProps) => (
    <Svg {...props}>
      <path d="M4 12l8-8h8v8l-8 8-8-8z" />
      <path d="M16 8h.01" />
    </Svg>
  ),
  settings: (props: IconProps) => (
    <Svg {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Svg>
  ),
  drafts: (props: IconProps) => (
    <Svg {...props}>
      <path d="M5 5h10l4 4v10H5V5z" />
      <path d="M15 5v4h4" />
      <path d="M8 13h8M8 17h5" />
    </Svg>
  ),
  compose: (props: IconProps) => (
    <Svg {...props}>
      <path d="M4 20h4L20 8l-4-4L4 16v4z" />
      <path d="M13 7l4 4" />
    </Svg>
  ),
  command: (props: IconProps) => (
    <Svg {...props}>
      {/* Command palette: panel + prompt caret + input line */}
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <path d="M7.5 9.5l2.75 2.5-2.75 2.5" />
      <path d="M12.25 14.5H16.5" />
    </Svg>
  ),
  search: (props: IconProps) => (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16.5 16.5L21 21" />
    </Svg>
  ),
  minimize: (props: IconProps) => (
    <Svg {...props}>
      <path d="M6 12h12" />
    </Svg>
  ),
  expand: (props: IconProps) => (
    <Svg {...props}>
      <path d="M9 5H5v4M15 5h4v4M15 19h4v-4M9 19H5v-4" />
    </Svg>
  ),
  close: (props: IconProps) => (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  ),
  send: (props: IconProps) => (
    <Svg {...props}>
      <path d="M4 12l16-8-6 16-2-6-8-2z" />
    </Svg>
  ),
  clock: (props: IconProps) => (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </Svg>
  ),
  paperclip: (props: IconProps) => (
    <Svg {...props}>
      <path d="M21.4 11.6l-8.5 8.5a5 5 0 0 1-7.1-7.1l9.2-9.2a3.2 3.2 0 0 1 4.5 4.5l-9.2 9.1a1.4 1.4 0 0 1-2-2l8.1-8.1" />
    </Svg>
  ),
  back: (props: IconProps) => (
    <Svg {...props}>
      <path d="M14 6l-6 6 6 6" />
    </Svg>
  ),
  chevronUp: (props: IconProps) => (
    <Svg {...props}>
      <path d="M6 14l6-6 6 6" />
    </Svg>
  ),
  chevronDown: (props: IconProps) => (
    <Svg {...props}>
      <path d="M6 10l6 6 6-6" />
    </Svg>
  ),
  chevronLeft: (props: IconProps) => (
    <Svg {...props}>
      <path d="M14 6l-6 6 6 6" />
    </Svg>
  ),
  chevronRight: (props: IconProps) => (
    <Svg {...props}>
      <path d="M10 6l6 6-6 6" />
    </Svg>
  ),
  menu: (props: IconProps) => (
    <Svg {...props}>
      <path d="M4 7h16" />
      <path d="M4 12h16" />
      <path d="M4 17h16" />
    </Svg>
  ),
  moreHorizontal: (props: IconProps) => (
    <Svg {...props}>
      <circle cx="5" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.25" fill="currentColor" stroke="none" />
    </Svg>
  ),
  moreVertical: (props: IconProps) => (
    <Svg {...props}>
      <circle cx="12" cy="5" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" stroke="none" />
      <circle cx="12" cy="19" r="1.25" fill="currentColor" stroke="none" />
    </Svg>
  ),
  info: (props: IconProps) => (
    <Svg {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6" />
      <path d="M12 7h.01" />
    </Svg>
  ),
  layoutSingle: (props: IconProps) => (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
    </Svg>
  ),
  layoutSplit: (props: IconProps) => (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M12 4v16" />
    </Svg>
  ),
  layoutThree: (props: IconProps) => (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
      <path d="M9 4v16M15 4v16" />
    </Svg>
  ),
  google: (props: IconProps) => (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden={props.title ? undefined : true}
      role={props.title ? "img" : undefined}
      {...props}
    >
      {props.title ? <title>{props.title}</title> : null}
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  ),
  microsoft: (props: IconProps) => (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      aria-hidden={props.title ? undefined : true}
      role={props.title ? "img" : undefined}
      {...props}
    >
      {props.title ? <title>{props.title}</title> : null}
      <path fill="#F25022" d="M3 3h8.5v8.5H3z" />
      <path fill="#7FBA00" d="M12.5 3H21v8.5h-8.5z" />
      <path fill="#00A4EF" d="M3 12.5h8.5V21H3z" />
      <path fill="#FFB900" d="M12.5 12.5H21V21h-8.5z" />
    </svg>
  ),
  calendar: (props: IconProps) => (
    <Svg {...props}>
      <rect x="3" y="5" width="18" height="16" rx="1.5" />
      <path d="M3 10h18" />
      <path d="M8 3v4M16 3v4" />
    </Svg>
  ),
  reply: (props: IconProps) => (
    <Svg {...props}>
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-2" />
    </Svg>
  ),
  replyAll: (props: IconProps) => (
    <Svg {...props}>
      <path d="M7 14L2 9l5-5" />
      <path d="M12 14L7 9l5-5" />
      <path d="M2 9h12a6 6 0 0 1 0 12h-2" />
    </Svg>
  ),
  forward: (props: IconProps) => (
    <Svg {...props}>
      <path d="M15 14l5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h2" />
    </Svg>
  ),
  mail: (props: IconProps) => (
    <Svg {...props}>
      <path d="M4 6h16v12H4z" />
      <path d="M4 8l8 6 8-6" />
    </Svg>
  ),
  mailOpen: (props: IconProps) => (
    <Svg {...props}>
      <path d="M4 10l8-5 8 5v8H4v-8z" />
      <path d="M4 10l8 5 8-5" />
    </Svg>
  ),
  snooze: (props: IconProps) => (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </Svg>
  ),
  unsubscribe: (props: IconProps) => (
    <Svg {...props}>
      <path d="M4 6h16v12H4z" />
      <path d="M4 8l8 6 8-6" />
      <path d="M7 17l10-10" />
    </Svg>
  ),
};
