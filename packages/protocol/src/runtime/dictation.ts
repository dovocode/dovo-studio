import { Schema } from 'effect'
import { dictationLanguageSchema } from '../desktop-dictation.js'
import { mutableStruct, maxValue, minValue } from '../shared/schema.js'
export const runtimeDictationInputSchema = mutableStruct({
  id: maxValue(minValue(Schema.String, 1), 100),
  taskId: maxValue(minValue(Schema.String, 1), 200),
  language: dictationLanguageSchema,
  format: Schema.Literals(['pcm', 'encoded']),
  data: maxValue(minValue(Schema.String, 1), 12800000),
})
export const runtimeDictationResultSchema = mutableStruct({ text: maxValue(Schema.String, 100000) })
