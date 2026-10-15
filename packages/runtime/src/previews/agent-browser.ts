import { Schema } from 'effect'
import { mutableStruct, minValue, maxValue } from '@dovo/protocol'

const text = maxValue(minValue(Schema.String, 1), 16000)
const agentBrowserCommandSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('evaluate'), script: text }),
  mutableStruct({ action: Schema.Literal('navigate'), url: maxValue(text, 4096) }),
  mutableStruct({ action: Schema.Literals(['snapshot', 'back', 'forward', 'reload', 'close']) }),
  mutableStruct({ action: Schema.Literal('click'), selector: text }),
  mutableStruct({
    action: Schema.Literal('fill'),
    selector: text,
    text: maxValue(Schema.String, 16000),
  }),
  mutableStruct({ action: Schema.Literal('key'), key: maxValue(text, 40) }),
  mutableStruct({
    action: Schema.Literal('scroll'),
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
