/** A short buzz on key actions, like native finance apps (Android; ignored where unsupported). */
export function haptic(ms = 10) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // no vibration support
  }
}
