import { Schema } from 'effect'
import { decodeResult, mutableArray, mutableStruct } from '@dovo/protocol'
/** Older stable ACP hosts, including Grok, may still advertise session.models. */
export function legacyAcpModels(session: unknown) {
  return decodeResult(
    mutableStruct({
      models: mutableStruct({
        currentModelId: Schema.String,
        availableModels: mutableArray(
          mutableStruct({
            modelId: Schema.String,
            name: Schema.String,
            description: Schema.optional(Schema.NullOr(Schema.String)),
          }),
        ),
      }),
    }),
    session,
  ).data?.models
}
