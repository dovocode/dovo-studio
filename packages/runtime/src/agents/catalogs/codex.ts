import { mutableArray, mutableStruct } from '@dovo/protocol'
import { decode, isFastServiceTier } from '@dovo/protocol'
import { Schema } from 'effect'
import type { AgentDiscovery, ModelCatalog } from '@dovo/protocol'
import { withCatalogRpc } from './rpc.js'
import { codexProviderModels } from './codex-provider-models.js'
import { daybreakProgram, supportsCodexDaybreak } from '../configuration/codex-modes.js'
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

type CodexRequest = (method: string, params: object) => Promise<unknown>

export async function codexFastModeBlocked(request: CodexRequest) {
  const requirements = decode(
    mutableStruct({
      requirements: Schema.optional(
        Schema.NullOr(
          mutableStruct({
            featureRequirements: Schema.optional(
              Schema.NullOr(Schema.Record(Schema.String, Schema.mutableKey(Schema.Boolean))),
            ),
          }),
        ),
      ),
    }),
    await request('configRequirements/read', {}).catch((error: unknown) => {
      if (error instanceof ResponseError && error.code === -32601) return {}
      throw error
    }),
  )
  return requirements.requirements?.featureRequirements?.fast_mode === false
}

async function* codexModelRows(request: CodexRequest) {
  let cursor: string | null | undefined
  const seen = new Set<string>()
  do {
    const page = decode(
      pageSchema,
      await request('model/list', {
        limit: 100,
        includeHidden: true,
        ...(cursor ? { cursor } : {}),
      }),
    )
    yield* page.data
    cursor = page.nextCursor
    if (cursor && seen.has(cursor)) throw new Error('Model discovery returned a repeated page')
    if (cursor) seen.add(cursor)
  } while (cursor)
}

const configuredDefaults = mutableStruct({
  config: Schema.optional(
    mutableStruct({
      model: Schema.optional(Schema.NullOr(Schema.String)),
      model_reasoning_effort: Schema.optional(Schema.NullOr(Schema.String)),
    }),
  ),
})

/** A loaded thread can retain the last turn's model and effort when fields are omitted. */
export async function codexTurnDefaults(
  request: CodexRequest,
  cwd: string,
  model: string,
  effort: string | undefined,
) {
  const { config } = decode(
    configuredDefaults,
    await request('config/read', { cwd, includeLayers: false }).catch((error: unknown) => {
      if (error instanceof ResponseError && error.code === -32601) return {}
      throw error
    }),
  )
  const selectedModel = model || config?.model || undefined
  const selectedEffort = effort || config?.model_reasoning_effort || undefined
  if (selectedModel && selectedEffort) return { model: selectedModel, effort: selectedEffort }
  for await (const row of codexModelRows(request)) {
    if (selectedModel ? row.model === selectedModel : row.isDefault)
      return { model: row.model, effort: selectedEffort ?? row.defaultReasoningEffort }
  }
  return { model: selectedModel, effort: selectedEffort }
}
/** Ask the configured app-server, so separate CODEX_HOME and API-key logins
 * and custom providers are checked with the same configuration used to run a conversation. */
export async function codexAuthenticated(agent: AgentDiscovery): Promise<boolean> {
  try {
    return await withCatalogRpc(
      agent.endpoint || 'codex',
      ['app-server', '--listen', 'stdio://', ...(agent.args ?? [])],
      async (rpc) => {
        await rpc.sendRequest('initialize', {
          clientInfo: { name: 'dovo_studio', version: '0.1.0' },
        })
        await rpc.sendNotification('initialized', {})
        const response: unknown = await rpc
          .sendRequest('account/read', { refreshToken: false })
          .catch((error: unknown) => {
            if (error instanceof ResponseError && error.code === -32601) return undefined
            throw error
          })
        // An older app-server cannot report its account, yet it answered the
        // handshake like the model catalog expects; keep it selectable.
        if (response === undefined) return true
        const result = decode(
          mutableStruct({
            account: Schema.NullOr(mutableStruct({ type: Schema.String })),
            requiresOpenaiAuth: Schema.optional(Schema.Boolean),
          }),
          response,
        )
        // Custom providers can authenticate with their own bearer rather than an OpenAI login.
        return (
          result.requiresOpenaiAuth === false ||
          result.account?.type === 'chatgpt' ||
          result.account?.type === 'apiKey'
        )
      },
      agent.env,
    )
  } catch {
    // Missing, signed-out and unresponsive harnesses are not ready to run.
    return false
  }
}
export async function codexModels(agent: AgentDiscovery): Promise<ModelCatalog> {
  return withCatalogRpc(
    agent.endpoint || 'codex',
    ['app-server', '--listen', 'stdio://', ...(agent.args ?? [])],
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
      const fastModeBlocked = await codexFastModeBlocked((method, params) =>
        rpc.sendRequest(method, params),
      )
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
      let reasoning: ModelCatalog['reasoning'] = []
      for await (const model of codexModelRows((method, params) =>
        rpc.sendRequest(method, params),
      )) {
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
          )?.filter((tier) => !fastModeBlocked || !isFastServiceTier(tier.id)),
          reasoning: efforts,
        })
        if (model.isDefault) reasoning = efforts
      }
      const daybreakPrograms =
        supportsCodexDaybreak(initialized) && account.account?.type === 'chatgpt'
          ? models.flatMap((model) => {
              const program = daybreakProgram(model.id)
              return program ? [program] : []
            })
          : []
      return {
        models: await codexProviderModels(rpc, agent, models),
        reasoning,
        codex: {
          daybreakPrograms: [...new Set(daybreakPrograms)],
          fastModeBlocked,
        },
      }
    },
    agent.env,
  )
}
