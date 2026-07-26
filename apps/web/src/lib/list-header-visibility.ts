/** Hide the mobile list header while scrolling down; reveal on scroll up. */
export function nextListHeaderHidden(input: {
  scrollTop: number;
  lastScrollTop: number;
  currentlyHidden: boolean;
}): boolean {
  const delta = input.scrollTop - input.lastScrollTop;
  if (input.scrollTop <= 8) return false;
  if (delta > 6) return true;
  if (delta < -6) return false;
  return input.currentlyHidden;
}
