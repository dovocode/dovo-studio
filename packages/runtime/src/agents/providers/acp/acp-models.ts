import { Schema } from 'effect'
import { decodeResult, mutableArray, mutableStruct } from '@dovo/protocol'
import type { SessionConfigOption } from '@agentclientprotocol/sdk/unstable'

/** Antigravity also supports the model option ID without the optional ACP category. */
export function acpModelOption(options: readonly SessionConfigOption[] | null | undefined) {
  const option =
    options?.find((option) => option.type === 'select' && option.category === 'model') ??
    options?.find((option) => option.type === 'select' && option.id === 'model' && !option.category)
  return option?.type === 'select' ? option : undefined
}

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
