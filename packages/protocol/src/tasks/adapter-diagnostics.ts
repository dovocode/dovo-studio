import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../shared/schema.js'
export const adapterDiagnosticSchema = mutableStruct({
  id: Schema.String,
  name: Schema.String,
  provider: Schema.Literals([
    'codex',
    'claude',
    'opencode',
    'hermes',
    'copilot',
    'grok',
    'muse',
    'cursor',
    'acp',
    'mcp',
  ]),
  kind: Schema.Literals(['executable', 'sdk', 'server']),
  available: Schema.Boolean,
  installedVersion: Schema.NullOr(Schema.String),
  latestVersion: Schema.NullOr(Schema.String),
  updateStatus: Schema.Literals(['not-checked', 'current', 'update-available', 'ahead', 'unknown']),
  detail: Schema.String,
  guidance: Schema.String,
  documentationUrl: Schema.String,
})
export const adapterDiagnosticsSchema = mutableArray(adapterDiagnosticSchema)
export type AdapterDiagnostic = typeof adapterDiagnosticSchema.Type
