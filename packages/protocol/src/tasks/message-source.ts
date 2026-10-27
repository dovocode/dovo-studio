import { Schema } from 'effect'
import { mutableStruct, maxValue, urlSchema } from '../shared/schema.js'
import { watchMessage } from './watch-message.js'

/** Runtime-authored display/navigation context. Never an authorization or permission grant. */
const messageSourceVariants = [
  mutableStruct({ kind: Schema.Literal('user') }),
  mutableStruct({
    kind: Schema.Literals(['pipeline', 'pull-request']),
    url: urlSchema({ protocol: /^https?$/ }),
  }),
  mutableStruct({
    kind: Schema.Literal('thread'),
    runtimeId: Schema.String,
    runtimeIdentity: Schema.optional(Schema.String),
    threadId: Schema.String,
    title: maxValue(Schema.String, 400),
    computerName: Schema.optional(maxValue(Schema.String, 200)),
  }),
  mutableStruct({
    kind: Schema.Literal('automation'),
    automationId: Schema.String,
    runId: Schema.String,
    title: maxValue(Schema.String, 400),
  }),
  mutableStruct({
    kind: Schema.Literal('system'),
    label: maxValue(Schema.String, 100),
  }),
] as const

export type MessageSource = Schema.Schema.Type<(typeof messageSourceVariants)[number]>
// Keep the named public type at this boundary instead of repeating the full union inside
// every message, task, workspace and sync-frame declaration.
export const messageSourceSchema: Schema.Codec<MessageSource, MessageSource> =
  Schema.Union(messageSourceVariants)

/** Older watcher messages predate typed provenance; keep their existing validated presentation. */
export function messageSourceFor(message: {
  id: string
  text: string
  source?: MessageSource
}): MessageSource | undefined {
  if (message.source) return message.source
  const watch = watchMessage(message)
  return watch ? { kind: watch.kind, url: watch.url } : undefined
}

export function messageSourceLabel(source?: MessageSource): string {
  if (!source) return 'You'
  switch (source.kind) {
    case 'user':
      return 'You'
    case 'pipeline':
      return 'Pipeline watch'
    case 'pull-request':
      return 'PR watch'
    case 'thread':
      return `${source.title || 'Thread'}${source.computerName ? ` · ${source.computerName}` : ''}`
    case 'automation':
      return `Automation · ${source.title || 'Untitled'}`
    case 'system':
      return source.label
  }
}
