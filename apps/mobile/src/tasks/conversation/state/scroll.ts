/** Keep following intent separate from native scroll echoes and asynchronous cell measurements. */
export function createConversationScroll({ inverted = false }: { inverted?: boolean } = {}) {
  let contentHeight = 0
  let viewportHeight = 0
  let following = true
  let interacting = false
  let mayDecelerate = false
  const nearBottom = 80
  const bottom = () => (inverted ? 0 : Math.max(0, contentHeight - viewportHeight))
  const isNearBottom = (offset: number) =>
    inverted ? offset <= nearBottom : bottom() - offset <= nearBottom
  const target = () => (following && !interacting && viewportHeight > 0 ? bottom() : undefined)
  return {
    get following() {
      return following
    },
    content(height: number) {
      if (height === contentHeight) return undefined
      contentHeight = height
      return target()
    },
    viewport(height: number) {
      if (height === viewportHeight) return undefined
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
      if (interacting) following = isNearBottom(offset)
    },
    endInteraction(offset: number) {
      if (interacting) following = isNearBottom(offset)
      interacting = false
      mayDecelerate = false
    },
    endDrag(offset: number, velocity = 0, targetOffset = offset) {
      if (!interacting) return
      following = isNearBottom(offset)
      // iOS announces the destination before momentum begins. Keep ownership
      // through that gap so a stream update cannot interrupt an upward flick.
      interacting = Math.abs(velocity) > 0.01 || Math.abs(targetOffset - offset) > 1
    },
    pause() {
      following = false
      interacting = false
      mayDecelerate = false
    },
    latest() {
      following = true
      interacting = false
      mayDecelerate = false
      return target()
    },
  }
}
