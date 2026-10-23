import { Schema } from 'effect'
import { mutableArray, mutableStruct } from '../../shared/schema.js'

const candidates = mutableStruct({
  host: Schema.Number,
  srflx: Schema.Number,
  prflx: Schema.Number,
  relay: Schema.Number,
})
export const peerSessionDiagnosticsSchema = mutableStruct({
  startedAt: Schema.String,
  state: Schema.String,
  relay: Schema.String,
  route: Schema.NullOr(Schema.Literals(['direct', 'relay'])),
  localCandidates: candidates,
  remoteCandidates: candidates,
  roundTripMs: Schema.NullOr(Schema.Number),
  error: Schema.NullOr(Schema.String),
})
export type PeerSessionDiagnostics = typeof peerSessionDiagnosticsSchema.Type
export const peerDiagnosticsSchema = mutableStruct({
  signaling: mutableStruct({
    configured: Schema.Number,
    online: Schema.Number,
    reconnecting: Schema.Number,
    lastError: Schema.NullOr(Schema.String),
  }),
  active: Schema.Number,
  recent: mutableArray(peerSessionDiagnosticsSchema),
})
