/** Keep following intent separate from native scroll echoes and asynchronous cell measurements. */
export function createConversationScroll() {
  let contentHeight = 0
  let viewportHeight = 0
  let following = true
  let interacting = false
  let mayDecelerate = false
  const bottom = () => Math.max(0, contentHeight - viewportHeight)
  const target = () => (following && !interacting && viewportHeight > 0 ? bottom() : undefined)
  return {
    get following() {
      return following
    },
    content(height: number) {
      contentHeight = height
      return target()
    },
    viewport(height: number) {
      viewportHeight = height
      return target()
    },
    beginInteraction() {
      interacting = true
      mayDecelerate = true
    },
    beginMomentum() {
      if (mayDecelerate) interacting = true
    },
    scroll(offset: number) {
      // Keyboard/content layout corrections can move upwards too. Only a user's
      // drag or momentum changes their intention to follow the conversation.
      if (interacting) following = bottom() - offset <= 24
    },
    endInteraction(offset: number) {
      if (interacting) following = bottom() - offset <= 24
      interacting = false
      mayDecelerate = false
    },
    endDrag(offset: number, velocity = 0, targetOffset = offset) {
      if (!interacting) return
      following = bottom() - offset <= 24
      // iOS announces the destination before momentum begins. Keep ownership
      // through that gap so a stream update cannot interrupt an upward flick.
      interacting = Math.abs(velocity) > 0.01 || Math.abs(targetOffset - offset) > 1
    },
    latest() {
      following = true
      interacting = false
      mayDecelerate = false
      return target()
    },
  }
}
