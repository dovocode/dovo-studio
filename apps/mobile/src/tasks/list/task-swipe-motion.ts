/** Gesture decisions use points and points/second, matching native gesture events. */
export function swipeTarget(position: number, velocity: number, revealedWidth: number) {
  'worklet'
  if (velocity > 500) return 0
  if (velocity < -500) return -revealedWidth
  return position < -revealedWidth / 2 ? -revealedWidth : 0
}

export function fullSwipe(
  position: number,
  velocity: number,
  width: number,
  revealedWidth: number,
) {
  'worklet'
  return position <= -Math.max(revealedWidth + 48, width * 0.72) && velocity <= 0
}

export function swipeTranslation(position: number, revealedWidth: number, width: number) {
  'worklet'
  if (position >= 0) return 0
  const distance = -position
  const resisted =
    distance <= revealedWidth ? distance : revealedWidth + (distance - revealedWidth) * 0.65
  return -Math.min(width, resisted)
}
