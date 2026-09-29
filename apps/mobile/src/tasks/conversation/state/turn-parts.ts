import type { ThreadMessage } from '@assistant-ui/react-native'

/** Footer controls stay available independently of the work disclosure. */
export function turnPartBoundaries(content: ThreadMessage['content'], running: boolean) {
  const finalIndex = running
    ? -1
    : content.reduce((last, part, index) => (part.type === 'text' ? index : last), -1)
  const footer = content.findIndex(
    (part) =>
      part.type === 'data' &&
      (part.name === 'dovo.checkpoint' || part.name === 'dovo.turn-summary'),
  )
  return { finalIndex, end: footer < 0 ? content.length : footer }
}
