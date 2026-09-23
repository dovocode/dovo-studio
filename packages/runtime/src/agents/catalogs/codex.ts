import { mutableArray, mutableStruct } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { Schema } from 'effect'
import type { AgentDiscovery, ModelCatalog } from '@dovo/protocol'
import { withCatalogRpc } from './rpc.js'
import { daybreakProgram, supportsCodexDaybreak } from '../codex-modes.js'
import { ResponseError } from 'vscode-jsonrpc/node'
const pageSchema = mutableStruct({
  data: mutableArray(
    mutableStruct({
      model: Schema.String,
      displayName: Schema.String,
      description: Schema.String,
      isDefault: Schema.Boolean,
      hidden: Schema.optional(Schema.Boolean),
      modelSpecialty: Schema.optional(Schema.NullOr(Schema.String)),
      defaultReasoningEffort: Schema.optional(Schema.String),
      defaultServiceTier: Schema.optional(Schema.NullOr(Schema.String)),
      additionalSpeedTiers: Schema.optional(mutableArray(Schema.String)),
      serviceTiers: Schema.optional(
        mutableArray(
          mutableStruct({
            id: Schema.String,
            name: Schema.String,
            description: Schema.optional(Schema.String),
          }),
        ),
      ),
      supportedReasoningEfforts: mutableArray(
        mutableStruct({
          reasoningEffort: Schema.String,
          description: Schema.String,
        }),
      ),
    }),
  ),
  nextCursor: Schema.optional(Schema.NullOr(Schema.String)),
})
export async function codexModels(agent: AgentDiscovery): Promise<ModelCatalog> {
  return withCatalogRpc(
    agent.endpoint || 'codex',
    ['app-server', '--listen', 'stdio://'],
    async (rpc) => {
      const initialized = await rpc.sendRequest('initialize', {
        clientInfo: {
          name: 'dovo_studio',
          version: '0.1.0',
        },
        capabilities: {
          experimentalApi: true,
        },
      })
      await rpc.sendNotification('initialized', {})
      const requirements = decode(
        mutableStruct({
          requirements: Schema.optional(
            Schema.NullOr(
              mutableStruct({
                featureRequirements: Schema.optional(
                  Schema.NullOr(
                    Schema.mutable(
                      Schema.Record({
                        key: Schema.String,
                        value: Schema.Boolean,
                      }),
                    ),
                  ),
                ),
              }),
            ),
          ),
        }),
        await rpc.sendRequest('configRequirements/read', {}).catch((error: unknown) => {
          if (error instanceof ResponseError && error.code === -32601) return {}
          throw error
        }),
      )
      const fastModeBlocked = requirements.requirements?.featureRequirements?.fast_mode === false
      const account = decode(
        mutableStruct({
          account: Schema.optional(
            Schema.NullOr(
              mutableStruct({
                type: Schema.String,
              }),
            ),
          ),
        }),
        await rpc.sendRequest('account/read', {}).catch((error: unknown) => {
          if (error instanceof ResponseError && error.code === -32601) return {}
          throw error
        }),
      )
      const models: ModelCatalog['models'] = []
      let cursor: string | null | undefined,
        reasoning: ModelCatalog['reasoning'] = []
      const seen = new Set<string>()
      do {
        const page = decode(
          pageSchema,
          await rpc.sendRequest('model/list', {
            limit: 100,
            includeHidden: true,
            ...(cursor
              ? {
                  cursor,
                }
              : {}),
          }),
        )
        for (const model of page.data) {
          const efforts = model.supportedReasoningEfforts.map((e) => ({
            id: e.reasoningEffort,
            name: e.reasoningEffort,
          }))
          models.push({
            id: model.model,
            name: model.displayName,
            description: model.description,
            isDefault: model.isDefault,
            hidden: model.hidden,
            specialty: model.modelSpecialty ?? undefined,
            defaultReasoning: model.defaultReasoningEffort,
            defaultServiceTier: model.defaultServiceTier ?? undefined,
            // Older Codex catalogs used additionalSpeedTiers. Modern IDs are authoritative:
            // e.g. priority is the app-server ID, even when the CLI flag is named fast.
            serviceTiers: (
              model.serviceTiers ??
              model.additionalSpeedTiers?.map((id) => ({
                id,
                name: id === 'fast' ? 'Fast' : id,
                description: id === 'fast' ? 'Faster responses, increased usage' : undefined,
              }))
            )?.filter((tier) => !fastModeBlocked || !['fast', 'priority'].includes(tier.id)),
            reasoning: efforts,
          })
          if (model.isDefault) reasoning = efforts
        }
        cursor = page.nextCursor
        if (cursor && seen.has(cursor)) throw new Error('Model discovery returned a repeated page')
        if (cursor) seen.add(cursor)
      } while (cursor)
      const daybreakPrograms =
        supportsCodexDaybreak(initialized) && account.account?.type === 'chatgpt'
          ? models.flatMap((model) => {
              const program = daybreakProgram(model.id)
              return program ? [program] : []
            })
          : []
      return {
        models,
        reasoning,
        codex: {
          daybreakPrograms: [...new Set(daybreakPrograms)],
          fastModeBlocked,
        },
      }
    },
  )
}
