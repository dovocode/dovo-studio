import type { ThreadMessage } from '@assistant-ui/react-native'
import { artifactReferences, decodeResult, mutableStruct } from '@dovo/protocol'
import { Schema } from 'effect'

const groupSchema = mutableStruct({ groupKey: Schema.String })
const payloadSchema = mutableStruct({ payload: Schema.String })

export function toolPartArtifacts(part: ThreadMessage['content'][number]) {
  return part.type === 'tool-call'
    ? artifactReferences(decodeResult(payloadSchema, part.artifact).data?.payload)
    : []
}

/** Keep the activity boundaries produced by the shared desktop/native timeline. */
export function toolPartGroupEnd(content: ThreadMessage['content'], start: number, end: number) {
  const first = content[start]
  if (first?.type !== 'tool-call') return start
  const key = decodeResult(groupSchema, first.artifact).data?.groupKey
  if (!key) return start
  let last = start
  while (last + 1 < end) {
    const next = content[last + 1]
    if (
      next?.type !== 'tool-call' ||
      decodeResult(groupSchema, next.artifact).data?.groupKey !== key
    )
      break
    last++
  }
  return last
}

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

/** Keep failures and created artifacts available when the turn is folded. */
export function foldedTurnPartRanges(
  content: ThreadMessage['content'],
  finalIndex: number,
  end: number,
) {
  const ranges: { start: number; end: number }[] = []
  for (let index = 0; index < end; index++) {
    if (content[index]?.type === 'tool-call') {
      const last = toolPartGroupEnd(content, index, end)
      if (
        content
          .slice(index, last + 1)
          .some(
            (part) =>
              (part.type === 'tool-call' && part.isError) || toolPartArtifacts(part).length > 0,
          )
      )
        ranges.push({ start: index, end: last + 1 })
      index = last
    } else if (index === finalIndex) ranges.push({ start: index, end: index + 1 })
  }
  return ranges
}
