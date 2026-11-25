import { Schema } from 'effect'
import { maxValue, minValue, mutableStruct, refine } from '../shared/schema.js'

const webAddress = refine(
  maxValue(minValue(Schema.String, 1), 4096),
  (value) => {
    const url = URL.canParse(value) ? new URL(value) : undefined
    return (
      !!url &&
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password
    )
  },
  'Expected a web address without credentials',
)

export const automationRunSubjectSchema = Schema.Union([
  mutableStruct({
    kind: Schema.Literal('thread'),
    threadId: maxValue(minValue(Schema.String, 1), 200),
  }),
  mutableStruct({
    kind: Schema.Literal('url'),
    url: webAddress,
  }),
])
export type AutomationRunSubject = typeof automationRunSubjectSchema.Type

export function automationRunSubjectKey(subject: AutomationRunSubject) {
  if (subject.kind === 'thread') return `thread:${subject.threadId}`
  const url = new URL(subject.url)
  url.hash = ''
  return url.href
}
