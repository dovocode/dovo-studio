import { Schema } from 'effect'
import { mutableStruct } from '../../shared/schema.js'

export const windowsRuntimeChoiceSchema = Schema.Union([
  mutableStruct({ mode: Schema.Literal('native') }),
  mutableStruct({
    mode: Schema.Literal('wsl'),
    distribution: Schema.String.pipe(
      Schema.check(Schema.isMinLength(1)),
      Schema.check(Schema.isMaxLength(256)),
    ),
  }),
])
export type WindowsRuntimeChoice = typeof windowsRuntimeChoiceSchema.Type
export const windowsRuntimeStatusSchema = mutableStruct({
  configured: Schema.Boolean,
  choice: windowsRuntimeChoiceSchema,
  distributions: Schema.Array(mutableStruct({ name: Schema.String, version: Schema.Number })),
  error: Schema.optional(Schema.String),
})
export type WindowsRuntimeStatus = typeof windowsRuntimeStatusSchema.Type

export const windowsSecurityEventSchema = mutableStruct({
  timeCreated: Schema.String,
  ruleId: Schema.String.pipe(Schema.check(Schema.isMaxLength(128))),
  processPath: Schema.String.pipe(Schema.check(Schema.isMaxLength(32768))),
  targetPath: Schema.String.pipe(Schema.check(Schema.isMaxLength(32768))),
})
export const windowsSecurityReportSchema = mutableStruct({
  checkedAt: Schema.String,
  status: Schema.Literals(['ok', 'access-denied', 'unavailable']),
  events: Schema.Array(windowsSecurityEventSchema).pipe(Schema.check(Schema.isMaxLength(20))),
})
export type WindowsSecurityReport = typeof windowsSecurityReportSchema.Type

/** Interpret the recorded rule, never infer one from an executable name alone. */
export function windowsAsrGuidance(ruleId: string) {
  switch (ruleId.replace(/[{}]/g, '').toLowerCase()) {
    case '9e6c4e1f-7d60-472f-ba1a-a39ef669e4b2':
      return 'LSASS memory access was blocked. This rule can name svchost.exe without stopping it. Check whether Dovo actually failed before changing permissions.'
    case 'd1e49aac-8f56-4280-b9ba-993a6d77406c':
      return 'Process creation through WMI or PsExec was blocked. Check the command or integration using it. Administrator access does not override this rule.'
    case '01443614-cd74-433a-b99e-2ecdc07bfc25':
      return 'An executable was blocked by its trust or reputation policy. Check the affected file with your Windows administrator.'
    default:
      return 'Use this rule ID and the affected paths to investigate the block. Administrator access does not override Defender policy.'
  }
}
export interface WindowsRuntimeBridge {
  read(): Promise<WindowsRuntimeStatus>
  connection(): Promise<{ address: string; token: string }>
  save(choice: WindowsRuntimeChoice): Promise<{ address: string; token: string }>
  security(): Promise<WindowsSecurityReport>
}
