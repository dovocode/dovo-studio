import { Schema } from 'effect'
import { mutableStruct, minValue, maxValue } from '@dovo/protocol/agent-tools'
import { browserObservationSchema } from './browser-observation.js'

const text = maxValue(minValue(Schema.String, 1), 16000)
export const agentBrowserCommandSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('evaluate'), script: text }),
  mutableStruct({ action: Schema.Literal('navigate'), url: maxValue(text, 4096) }),
  mutableStruct({
    action: Schema.Literals(['snapshot', 'screenshot', 'back', 'forward', 'reload', 'close']),
  }),
  mutableStruct({ action: Schema.Literal('click'), selector: text }),
  mutableStruct({
    action: Schema.Literal('fill'),
    selector: text,
    text: maxValue(Schema.String, 16000),
  }),
  mutableStruct({
    action: Schema.Literal('key'),
    key: maxValue(text, 40),
    selector: Schema.optional(text),
  }),
  mutableStruct({
    action: Schema.Literal('scroll'),
    selector: Schema.optional(text),
    deltaY: Schema.Number.pipe(
      Schema.check(Schema.isFinite()),
      Schema.check(Schema.isBetween({ minimum: -4000, maximum: 4000 })),
    ),
  }),
])
export const agentBrowserRequestSchema = mutableStruct({
  taskId: maxValue(minValue(Schema.String, 1), 200),
  command: agentBrowserCommandSchema,
})
export type AgentBrowserCommand = Schema.Schema.Type<typeof agentBrowserCommandSchema>

// Keep structured observations intact at the MCP boundary.
export const agentBrowserResultSchema = mutableStruct({
  ok: Schema.Literal(true),
  url: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  snapshot: Schema.optional(Schema.String),
  snapshotTruncated: Schema.optional(Schema.Boolean),
  elements: Schema.optional(browserObservationSchema.fields.elements),
  elementsTruncated: Schema.optional(Schema.Boolean),
  image: Schema.optional(Schema.String),
  result: Schema.optional(Schema.Unknown),
})
