import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../shared/schema.js'
export const adapterDiagnosticSchema = mutableStruct({
  id: Schema.String,
  name: Schema.String,
  provider: Schema.Literal(
    'codex',
    'claude',
    'opencode',
    'hermes',
    'copilot',
    'grok',
    'muse',
    'acp',
    'mcp',
  ),
  kind: Schema.Literal('executable', 'sdk', 'server'),
  available: Schema.Boolean,
  installedVersion: Schema.NullOr(Schema.String),
  latestVersion: Schema.NullOr(Schema.String),
  updateStatus: Schema.Literal('not-checked', 'current', 'update-available', 'ahead', 'unknown'),
  detail: Schema.String,
  guidance: Schema.String,
  documentationUrl: Schema.String,
})
export const adapterDiagnosticsSchema = mutableArray(adapterDiagnosticSchema)
export type AdapterDiagnostic = typeof adapterDiagnosticSchema.Type
