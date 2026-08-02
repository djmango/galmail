# Mobile UX end-to-end artifacts

Fixture-backed Playwright coverage for the mobile shell (Pixel 7 / Chromium
`hasTouch`). Use this loop when changing inbox gestures, the mail reader,
safe-area chrome, or undo snackbars.

## Quick commands

```bash
# Full suite (desktop quality gates + mobile UX)
bun run e2e

# Mobile project only (faster agent loop)
bun run e2e:mobile

# Re-publish gallery/videos from the last Playwright outputDir
bun run e2e:mobile:artifacts
```

Optional env:

| Variable                   | Purpose                                     |
| -------------------------- | ------------------------------------------- |
| `GALMAIL_E2E_ARTIFACT_DIR` | Override screenshot/video gallery directory |

Default artifact directory:

1. `/opt/cursor/artifacts/mobile-ux` when writable (Cursor cloud agents)
2. otherwise `apps/web/test-results/mobile-ux`

## What you get

After `e2e:mobile` (or full `e2e`):

| Path                          | Contents                             |
| ----------------------------- | ------------------------------------ |
| `$ARTIFACT_DIR/index.html`    | Browsable screenshot + video gallery |
| `$ARTIFACT_DIR/manifest.json` | Machine-readable shot/video index    |
| `$ARTIFACT_DIR/*.png`         | Numbered full-page captures          |
| `$ARTIFACT_DIR/videos/*.webm` | Copied Playwright recordings         |
| `apps/web/playwright-report/` | Playwright HTML report               |
| `apps/web/test-results/`      | Raw traces/videos per test           |

Open the gallery:

```bash
# cloud agent host path
xdg-open /opt/cursor/artifacts/mobile-ux/index.html

# local fallback
xdg-open apps/web/test-results/mobile-ux/index.html
```

Agents can `Read` the PNGs directly (vision) and skim `manifest.json` for titles.

## Coverage map

`apps/web/e2e/mobile-gestures.e2e.ts` (project `mobile-chrome`):

- Icons-only bottom nav, pull-to-refresh, search focus
- Edge-flush inbox scrollport (scrollbar not inset)
- Swipe archive/trash/star + timed Undo snackbar
- Settings privacy + swipe actions
- Styled HTML fixture mail (author CSS + data image) in sandboxed iframe
- Notch safe-area fallback on the reading header
- Swipe-back starting from the left third of the screen
- Thread truncation / hover hygiene
- Archive from the thread action bar + Undo

Desktop gates stay in `quality-gates.e2e.ts` (project `chromium`).

## Fixture data

Mobile HTML fidelity uses the demo mailbox in
`packages/providers/src/gmail/small.json` (thread **Styled product update
(HTML mail)**). Playwright boots Vite with
`VITE_GALMAIL_PROVIDER_MODE=fixture` so no OAuth is required.

## CI

The `e2e` job uploads:

- `mobile-ux-artifacts` (`apps/web/test-results/mobile-ux/`)
- `playwright-report` (`apps/web/playwright-report/`)
- `playwright-test-results` (`apps/web/test-results/` excluding the gallery copy when present)

Download those from the Actions run when validating a PR without a local browser.

## Notes

- This is Chromium device emulation, not WKWebView/TestFlight. Keep native IPA
  validation on `ios-testflight`; use this suite for fast UX regression loops.
- Gestures use mouse drags + synthetic `TouchEvent`s where Playwright's touch
  pipeline is insufficient (pull-to-refresh resistance / swipe-back).
- Videos are always on for `mobile-chrome` only; desktop uses
  `retain-on-failure` to keep CI artifacts smaller.
