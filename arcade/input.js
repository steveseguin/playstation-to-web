// Some mobile browsers (and device emulators) report zero touch points.
// Use multiple UI capability hints; this is not an authentication decision.
export function wantsTouchControls() {
  return navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}
