/**
 * Fixed thread row heights for virtualization.
 * Must stay in sync with `--thread-row-h` in apps/web/src/styles/app.css.
 */
export const THREAD_ROW_HEIGHT_DESKTOP = 84;
export const THREAD_ROW_HEIGHT_MOBILE = 86;

export function threadRowHeightForLayout(isMobile: boolean): number {
  return isMobile ? THREAD_ROW_HEIGHT_MOBILE : THREAD_ROW_HEIGHT_DESKTOP;
}
