import { z } from 'zod'
import type { AgentDiscovery, ModelCatalog } from '@dovo/protocol'
import { withCatalogRpc } from './rpc.js'
import { daybreakProgram, supportsCodexDaybreak } from '../codex-modes.js'
import { ResponseError } from 'vscode-jsonrpc/node'
const pageSchema = z.object({
  data: z.array(
    z.object({
      model: z.string(),
      displayName: z.string(),
      description: z.string(),
      isDefault: z.boolean(),
      hidden: z.boolean().optional(),
      modelSpecialty: z.string().nullish(),
      defaultReasoningEffort: z.string().optional(),
      defaultServiceTier: z.string().nullish(),
      additionalSpeedTiers: z.array(z.string()).optional(),
      serviceTiers: z
        .array(z.object({ id: z.string(), name: z.string(), description: z.string().optional() }))
        .optional(),
      supportedReasoningEfforts: z.array(
        z.object({ reasoningEffort: z.string(), description: z.string() }),
      ),
    }),
  ),
  nextCursor: z.string().nullish(),
})
export async function codexModels(agent: AgentDiscovery): Promise<ModelCatalog> {
  return withCatalogRpc(
    agent.endpoint || 'codex',
    ['app-server', '--listen', 'stdio://'],
    async (rpc) => {
      const initialized = await rpc.sendRequest('initialize', {
        clientInfo: { name: 'dovo_studio', version: '0.1.0' },
        capabilities: { experimentalApi: true },
      })
      await rpc.sendNotification('initialized', {})
      const requirements = z
        .object({
          requirements: z
            .object({
              featureRequirements: z.record(z.string(), z.boolean()).nullish(),
            })
            .nullish(),
        })
        .parse(
          await rpc.sendRequest('configRequirements/read', {}).catch((error: unknown) => {
            if (error instanceof ResponseError && error.code === -32601) return {}
            throw error
          }),
        )
      const fastModeBlocked = requirements.requirements?.featureRequirements?.fast_mode === false
      const account = z.object({ account: z.object({ type: z.string() }).nullish() }).parse(
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
        const page = pageSchema.parse(
          await rpc.sendRequest('model/list', {
            limit: 100,
            includeHidden: true,
            ...(cursor ? { cursor } : {}),
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
        codex: { daybreakPrograms: [...new Set(daybreakPrograms)], fastModeBlocked },
      }
    },
  )
}
