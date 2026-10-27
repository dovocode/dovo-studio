import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { decode, modelDisplayName, type AgentDiscovery, type ModelCatalog } from '@dovo/protocol'
import { Schema } from 'effect'
import type { MessageConnection } from 'vscode-jsonrpc/node'
import { ResponseError } from 'vscode-jsonrpc/node'
import { processEnvironment } from '../../process.js'
import { catalogJson } from './fetch.js'

const optionalString = Schema.optional(Schema.NullOr(Schema.String))
const headersSchema = Schema.optional(Schema.NullOr(Schema.Record(Schema.String, Schema.String)))
const configuration = Schema.Struct({
  config: Schema.optional(
    Schema.Struct({
      model_provider: optionalString,
      model_catalog_json: optionalString,
      model_providers: Schema.optional(
        Schema.NullOr(
          Schema.Record(
            Schema.String,
            Schema.Struct({
              base_url: optionalString,
              model_catalog_url: optionalString,
              env_key: optionalString,
              experimental_bearer_token: optionalString,
              requires_openai_auth: Schema.optional(Schema.Boolean),
              http_headers: headersSchema,
              env_http_headers: headersSchema,
              query_params: headersSchema,
            }),
          ),
        ),
      ),
    }),
  ),
})
const credentials = Schema.Struct({
  auth_mode: optionalString,
  OPENAI_API_KEY: optionalString,
  tokens: Schema.optional(Schema.NullOr(Schema.Struct({ access_token: optionalString }))),
})
const providerModels = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String.pipe(Schema.check(Schema.isMaxLength(200))),
      name: optionalString,
      description: optionalString,
    }),
  ).pipe(Schema.check(Schema.isMaxLength(10000))),
})

// A proxy can serve several vendors/modalities. Supplement only versioned families already
// advertised by Codex (e.g. gpt-5.6-terra -> gpt-6.1-terra), without guessing capabilities.
const family = (id: string) => {
  const match = /^([a-z][a-z-]*)-\d+(?:\.\d+)?(-[a-z][a-z0-9-]*)?$/i.exec(id)
  return match ? `${match[1]}:${match[2] ?? ''}` : undefined
}

/** Custom Responses providers can advertise new releases before Codex's bundled catalog. */
export async function codexProviderModels(
  rpc: MessageConnection,
  agent: AgentDiscovery,
  models: ModelCatalog['models'],
): Promise<ModelCatalog['models']> {
  try {
    const response: unknown = await rpc
      .sendRequest('config/read', { includeLayers: false })
      .catch((error: unknown) => {
        if (error instanceof ResponseError && error.code === -32601) return {}
        throw error
      })
    const { config } = decode(configuration, response)
    const provider = config?.model_providers?.[config.model_provider ?? 'openai']
    // Explicit catalogs remain authoritative; default OpenAI discovery stays with app-server.
    if (!provider?.base_url || provider.model_catalog_url || config?.model_catalog_json)
      return models
    const url = new URL(provider.base_url)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      throw new Error('Invalid configured provider URL')
    url.pathname = `${url.pathname.replace(/\/$/, '')}/models`
    for (const [key, value] of Object.entries(provider.query_params ?? {}))
      url.searchParams.set(key, value)
    const env = processEnvironment(agent.env)
    const headers = new Headers(provider.http_headers ?? {})
    for (const [key, name] of Object.entries(provider.env_http_headers ?? {})) {
      if (!env[name]) throw new Error('Missing provider header environment variable')
      headers.set(key, env[name])
    }
    let token = provider.experimental_bearer_token
    if (provider.env_key) {
      token = env[provider.env_key]
      if (!token) throw new Error('Missing provider credential environment variable')
    } else if (!token && provider.requires_openai_auth && !headers.has('Authorization')) {
      // Use the same file-backed login as this configured Codex process, never another CODEX_HOME.
      const auth = decode(
        credentials,
        JSON.parse(
          await readFile(join(env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json'), 'utf8'),
        ),
      )
      token =
        auth.auth_mode === 'apikey'
          ? auth.OPENAI_API_KEY
          : (auth.tokens?.access_token ?? auth.OPENAI_API_KEY)
      if (!token) throw new Error('Codex credentials are not available from its auth file')
    }
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const { data } = decode(
      providerModels,
      await catalogJson(url.href, 4_000_000, {
        headers,
        // Never forward configured credentials through a redirect to another server.
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      }),
    )
    const known = new Set(models.map((model) => model.id))
    const families = new Set(
      models.map((model) => family(model.id)).filter((value) => value !== undefined),
    )
    const additional: ModelCatalog['models'] = []
    for (const model of data) {
      if (known.has(model.id) || !families.has(family(model.id) ?? '')) continue
      known.add(model.id)
      additional.push({
        id: model.id,
        name: model.name || modelDisplayName(model.id),
        description: model.description ?? undefined,
        reasoning: [],
        serviceTiers: [],
      })
    }
    return [...models, ...additional]
  } catch {
    // Do not log request/decoding errors: configuration and auth-file errors can contain secrets.
    console.warn(
      'Could not refresh configured Codex provider models; using the app-server catalog.',
    )
    return models
  }
}
