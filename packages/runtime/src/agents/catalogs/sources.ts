import { createHash } from 'node:crypto'
import { Schema } from 'effect'
import {
  catalogSearchSchema,
  decode,
  decodeResult,
  mutableArray,
  mutableStruct,
  mcpServerSchema,
  registryCatalogSchema,
  type RegistryEntry,
} from '@dovo/protocol'
import { catalogJson } from './fetch.js'

type Search = typeof catalogSearchSchema.Type
const count = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
)
const page = (cursor: string | undefined) => {
  if (cursor && !/^[1-9]\d{0,3}$/.test(cursor)) throw new Error('Invalid registry cursor')
  return Number(cursor ?? 1)
}
export async function searchSmithery({ query, cursor, server }: Search) {
  if (server) {
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/.test(server))
      throw new Error('Invalid Smithery server name')
    const result = decode(
      mutableStruct({
        qualifiedName: Schema.String,
        displayName: Schema.optional(Schema.String),
        description: Schema.String,
        connections: Schema.optional(
          mutableArray(
            mutableStruct({
              type: Schema.String,
              deploymentUrl: Schema.optional(Schema.String),
              configSchema: Schema.optional(Schema.Unknown),
            }),
          ),
        ),
      }),
      await catalogJson(
        `https://registry.smithery.ai/servers/${server.split('/').map(encodeURIComponent).join('/')}`,
      ),
    )
    const entry = smitheryEntry(result)
    entry.variants = (result.connections ?? []).map((connection, index) => {
      // Provider-specific config schemas cannot be converted into credentials safely.
      const config = decodeResult(
        mutableStruct({
          required: Schema.optional(mutableArray(Schema.String)),
          oneOf: Schema.optional(mutableArray(Schema.Unknown)),
          properties: Schema.optional(
            Schema.Record(Schema.String, Schema.mutableKey(Schema.Unknown)),
          ),
        }),
        connection.configSchema,
      )
      const configurable =
        !!connection.configSchema &&
        (!config.success ||
          Object.keys(config.data.properties ?? {}).length > 0 ||
          !!config.data.required?.length ||
          !!config.data.oneOf?.length)
      const candidate =
        !configurable && connection.type === 'http'
          ? decodeResult(mcpServerSchema, {
              name: `smithery-${createHash('sha256').update(server).digest('hex').slice(0, 16)}`,
              enabled: true,
              transport: 'http',
              url: connection.deploymentUrl,
              sourceUrl: entry.url,
            })
          : undefined
      return {
        id: String(index),
        label: connection.type === 'http' ? 'Hosted HTTP' : connection.type,
        ...(candidate?.success ? { server: candidate.data } : {}),
        notes: configurable
          ? [
              'This server needs provider-specific setup. Open its Smithery listing to configure it, then add its MCP configuration manually.',
            ]
          : candidate?.success
            ? ['Review the endpoint and authentication settings before saving.']
            : ['Open the Smithery listing for installation instructions.'],
      }
    })
    return decode(registryCatalogSchema, { entries: [entry] })
  }
  const current = page(cursor)
  const params = new URLSearchParams({
    page: String(current),
    pageSize: '20',
    ...(query ? { q: query } : {}),
  })
  const result = decode(
    mutableStruct({
      servers: mutableArray(
        mutableStruct({
          qualifiedName: Schema.String,
          displayName: Schema.optional(Schema.String),
          description: Schema.String,
          verified: Schema.optional(Schema.Boolean),
          useCount: Schema.optional(count),
          inactive: Schema.optional(Schema.Boolean),
        }),
      ),
      pagination: mutableStruct({ currentPage: count, totalPages: count }),
    }),
    await catalogJson(`https://registry.smithery.ai/servers?${params}`),
  )
  return decode(registryCatalogSchema, {
    entries: result.servers
      .filter((entry) => !entry.inactive)
      .map((entry) => ({
        ...smitheryEntry(entry),
        uses: entry.useCount,
        verified: entry.verified,
      })),
    cursor:
      result.pagination.currentPage < result.pagination.totalPages
        ? String(current + 1)
        : undefined,
  })
}
function smitheryEntry(entry: {
  qualifiedName: string
  displayName?: string
  description: string
}): RegistryEntry {
  return {
    name: entry.displayName ?? entry.qualifiedName,
    description: entry.description,
    version: '',
    url: `https://smithery.ai/servers/${entry.qualifiedName.split('/').map(encodeURIComponent).join('/')}`,
    provider: 'smithery',
    providerId: entry.qualifiedName,
    variants: [],
  }
}
export async function searchGlama({ query, cursor }: Search) {
  const key = process.env.GLAMA_API_KEY?.trim()
  if (!key)
    throw new Error(
      'Glama requires an API key. Set GLAMA_API_KEY in this computer’s runtime environment, then restart the runtime. Create a key at https://glama.ai/settings/api-keys.',
    )
  const params = new URLSearchParams({
    first: '20',
    sort: 'added-at:desc',
    ...(query ? { query } : {}),
    ...(cursor ? { after: cursor } : {}),
  })
  const result = decode(
    mutableStruct({
      servers: mutableArray(
        mutableStruct({
          name: Schema.String,
          namespace: Schema.String,
          slug: Schema.String,
          description: Schema.String,
          url: Schema.String,
          qualityScore: Schema.optional(Schema.NullOr(count)),
          isBoosted: Schema.optional(Schema.Boolean),
        }),
      ),
      pageInfo: mutableStruct({
        hasNextPage: Schema.Boolean,
        endCursor: Schema.NullOr(Schema.String),
      }),
    }),
    await catalogJson(`https://glama.ai/api/mcp/v1/servers?${params}`, 4_000_000, {
      headers: { Authorization: `Bearer ${key}` },
    }),
  )
  return decode(registryCatalogSchema, {
    entries: result.servers.map((entry) => ({
      name: entry.name,
      description: entry.description,
      version: '',
      url: glamaListing(entry.url),
      provider: 'glama',
      providerId: `${entry.namespace}/${entry.slug}`,
      qualityScore: entry.qualityScore ?? undefined,
      promoted: entry.isBoosted,
      variants: [],
    })),
    cursor: result.pageInfo.hasNextPage ? (result.pageInfo.endCursor ?? undefined) : undefined,
  })
}

function glamaListing(value: string) {
  const url = new URL(value)
  if (
    url.origin !== 'https://glama.ai' ||
    url.username ||
    url.password ||
    !url.pathname.startsWith('/mcp/servers/')
  )
    throw new Error('Glama returned an invalid listing URL')
  return url.href
}
