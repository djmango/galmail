/**
 * Drain unread terminal query replies (OSC 11 / CPR / DA) and reset TTY
 * modes after a child exits. Without this, Ctrl+C can leave responses like
 * `]11;rgb:...` / `[row;colR` / `[?...c` painted into the next shell prompt.
 */
export function restoreTerminal(): void {
  if (!process.stdin.isTTY && !process.stdout.isTTY) return;

  // Timed non-canonical drain: read whatever is already queued, then stop.
  // Blocking readSync(/dev/tty) would hang when the buffer is empty.
  Bun.spawnSync(
    [
      "bash",
      "-c",
      [
        "exec </dev/tty 2>/dev/null || exit 0",
        'old=$(stty -g 2>/dev/null) || exit 0',
        "stty -echo -icanon min 0 time 1 2>/dev/null || true",
        "dd bs=1024 count=8 of=/dev/null 2>/dev/null || true",
        'stty "$old" 2>/dev/null || stty sane 2>/dev/null || true',
      ].join("; "),
    ],
    {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    },
  );

  try {
    // Show cursor; clear common leftover mouse / bracketed-paste modes.
    process.stdout.write(
      "\x1b[?25h\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[0m",
    );
  } catch {
    // stdout may be closed
  }
}
