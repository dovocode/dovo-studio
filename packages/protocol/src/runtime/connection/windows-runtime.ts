import { Schema } from 'effect'
import { mutableStruct } from '../../shared/schema.js'

export const windowsRuntimeChoiceSchema = Schema.Union(
  mutableStruct({ mode: Schema.Literal('native') }),
  mutableStruct({
    mode: Schema.Literal('wsl'),
    distribution: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(256)),
  }),
)
export type WindowsRuntimeChoice = typeof windowsRuntimeChoiceSchema.Type
export const windowsRuntimeStatusSchema = mutableStruct({
  configured: Schema.Boolean,
  choice: windowsRuntimeChoiceSchema,
  distributions: Schema.Array(mutableStruct({ name: Schema.String, version: Schema.Number })),
  error: Schema.optional(Schema.String),
})
export type WindowsRuntimeStatus = typeof windowsRuntimeStatusSchema.Type
export interface WindowsRuntimeBridge {
  read(): Promise<WindowsRuntimeStatus>
  connection(): Promise<{ address: string; token: string }>
  save(choice: WindowsRuntimeChoice): Promise<{ address: string; token: string }>
}
