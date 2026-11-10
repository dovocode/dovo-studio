import { Schema } from 'effect'
import { mutableStruct, maxValue, minValue } from '../shared/schema.js'
import { agentSecretReferenceSchema } from './secret-references.js'

export const textGeneratorSchema = mutableStruct({
  model: maxValue(minValue(Schema.String, 1), 300),
  kind: Schema.Literals(['openai', 'anthropic']),
  baseUrl: maxValue(minValue(Schema.String, 1), 2000).pipe(
    Schema.check(
      Schema.makeFilter((value) => {
        try {
          const url = new URL(value)
          return (
            ['http:', 'https:'].includes(url.protocol) &&
            !url.username &&
            !url.password &&
            !url.search &&
            !url.hash
          )
        } catch {
          return false
        }
      }),
    ),
  ),
  apiKey: Schema.optional(agentSecretReferenceSchema),
})
export type TextGenerator = typeof textGeneratorSchema.Type
