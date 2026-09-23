import { mutableStruct } from './schema.js'
import { maxValue, minValue } from './schema.js'
import { Schema } from 'effect'
import { agentSchema } from './workspace.js'
export const titleGenerationSettingsSchema = mutableStruct({
  harness: Schema.optional(agentSchema.pick('provider', 'endpoint', 'args')),
  agentId: Schema.optionalWith(maxValue(Schema.String, 200), {
    default: () => '',
  }),
  model: Schema.optionalWith(maxValue(Schema.String, 300), {
    default: () => '',
  }),
  reasoning: Schema.optionalWith(maxValue(Schema.String, 100), {
    default: () => '',
  }),
})
export const generateTitleSchema = mutableStruct({
  text: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 120000),
})
export const generatedTitleSchema = mutableStruct({
  title: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 120),
})
export const cleanupDictationSchema = mutableStruct({
  text: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 12000),
}).annotations({
  parseOptions: {
    onExcessProperty: 'error',
  },
})
export const cleanedDictationSchema = mutableStruct({
  text: maxValue(minValue(Schema.String.pipe(Schema.compose(Schema.Trim)), 1), 16000),
}).annotations({
  parseOptions: {
    onExcessProperty: 'error',
  },
})
export type TitleGenerationSettings = Schema.Schema.Type<typeof titleGenerationSettingsSchema>
