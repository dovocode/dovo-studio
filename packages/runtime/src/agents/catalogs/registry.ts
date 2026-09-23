import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode, decodeResult } from '@dovo/protocol'
import { createHash } from 'node:crypto'
import { Schema } from 'effect'
import {
  catalogSearchSchema,
  mcpServerSchema,
  registryCatalogSchema,
  type McpServer,
  type RegistryEntry,
} from '@dovo/protocol'
import { catalogJson } from './fetch.js'
const inputSchema = mutableStruct({
  name: Schema.optional(Schema.String),
  type: Schema.optional(Schema.String),
  valueHint: Schema.optional(Schema.String),
  value: Schema.optional(Schema.String),
  default: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  isRequired: Schema.optional(Schema.Boolean),
  isSecret: Schema.optional(Schema.Boolean),
  isRepeated: Schema.optional(Schema.Boolean),
  variables: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.Unknown,
      }),
    ),
  ),
})
const transportSchema = mutableStruct({
  type: Schema.String,
  url: Schema.optional(Schema.String),
  headers: Schema.optionalWith(mutableArray(inputSchema), {
    default: () => [],
  }),
  variables: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.Unknown,
      }),
    ),
  ),
})
const packageSchema = mutableStruct({
  registryType: Schema.String,
  identifier: Schema.String,
  version: Schema.optional(Schema.String),
  registryBaseUrl: Schema.optional(Schema.String),
  fileSha256: Schema.optional(Schema.String),
  runtimeHint: Schema.optional(Schema.String),
  transport: transportSchema,
  runtimeArguments: Schema.optionalWith(mutableArray(inputSchema), {
    default: () => [],
  }),
  packageArguments: Schema.optionalWith(mutableArray(inputSchema), {
    default: () => [],
  }),
  environmentVariables: Schema.optionalWith(mutableArray(inputSchema), {
    default: () => [],
  }),
})
const registryServerSchema = mutableStruct({
  name: Schema.String,
  title: Schema.optional(Schema.String),
  description: Schema.String,
  version: Schema.String,
  remotes: Schema.optionalWith(mutableArray(transportSchema), {
    default: () => [],
  }),
  packages: Schema.optionalWith(mutableArray(packageSchema), {
    default: () => [],
  }),
})
const marker = (name: string) => `__CONFIGURE_${name.replace(/[^a-zA-Z0-9_]/g, '_')}__`
const envName = (name: string) => `MCP_${name.replace(/[^a-zA-Z0-9_]/g, '_').toUpperCase()}`
export function registryEntry(value: unknown): RegistryEntry {
  const entry = decode(registryServerSchema, value)
  const sourceUrl = `https://registry.modelcontextprotocol.io/v0.1/servers/${encodeURIComponent(entry.name)}/versions/${encodeURIComponent(entry.version)}`
  const name = `${entry.name.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 65)}-${createHash('sha256').update(entry.name).digest('hex').slice(0, 8)}`
  const base = {
    name,
    enabled: true,
    sourceUrl,
    sourceRevision: entry.version,
  }
  const variants: RegistryEntry['variants'] = []
  const template = (value: string, variables?: Record<string, unknown>) =>
    value.replace(/\{([A-Za-z_][A-Za-z0-9_-]*)\}/g, (_match, key: string) => {
      const input = decodeResult(inputSchema, variables?.[key])
      return input.success && !input.data.isSecret
        ? (input.data.value ?? input.data.default ?? marker(key))
        : marker(key)
    })
  const variables = (
    inputs: Schema.Schema.Type<typeof inputSchema>[],
    server: McpServer,
    notes: string[],
    headers: boolean,
  ) => {
    for (const input of inputs) {
      if (!input.name) continue
      const value = input.value ?? input.default
      if (value === undefined && !input.isRequired) {
        notes.push(
          `Optional ${headers ? 'header' : 'environment variable'} omitted: ${input.name}. ${input.description ?? ''}`,
        )
        continue
      }
      if (value !== undefined && !input.isSecret && !/\{[A-Za-z_][A-Za-z0-9_-]*\}/.test(value)) {
        if (headers)
          server.headerValues = {
            ...server.headerValues,
            [input.name]: value,
          }
        else
          server.envValues = {
            ...server.envValues,
            [input.name]: value,
          }
      } else {
        const variable = headers ? envName(input.name) : input.name
        if (headers && input.name.toLowerCase() === 'authorization' && value?.startsWith('Bearer '))
          server.bearerTokenEnv = 'MCP_BEARER_TOKEN'
        else if (headers) server.headerEnv[input.name] = variable
        else server.env[input.name] = variable
        notes.push(
          `${input.name}${input.isRequired ? ' (required)' : ''}: ${input.description ?? 'Set the runtime environment variable binding.'}${headers ? (server.bearerTokenEnv && input.name.toLowerCase() === 'authorization' ? ' Set MCP_BEARER_TOKEN to the token without the Bearer prefix.' : ' The variable must contain the complete header value.') : ''}`,
        )
      }
    }
  }
  entry.remotes.forEach((remote, index) => {
    const id = `remote:${index}`,
      label = `${remote.type} · ${remote.url ?? 'Remote'}`
    if (remote.type !== 'streamable-http' || !remote.url) {
      variants.push({
        id,
        label,
        notes: ['This transport is not supported yet.'],
      })
      return
    }
    if (
      Object.values(remote.variables ?? {}).some(
        (value) => decodeResult(inputSchema, value).data?.isSecret,
      )
    ) {
      variants.push({
        id,
        label,
        notes: [
          'Secret URL parameters are not supported. Choose a variant using header authentication.',
        ],
      })
      return
    }
    const notes: string[] = []
    const server = decode(mcpServerSchema, {
      ...base,
      transport: 'http',
      url: template(remote.url, remote.variables),
    })
    if (server.url.includes('__CONFIGURE_'))
      notes.push('Replace each __CONFIGURE_…__ value in the server URL before saving.')
    variables(remote.headers, server, notes, true)
    variants.push({
      id,
      label,
      server,
      notes,
    })
  })
  entry.packages.forEach((pkg, index) => {
    const id = `package:${index}`,
      label = `${pkg.registryType} · ${pkg.identifier}${pkg.version ? `@${pkg.version}` : ''}`
    const runners: Record<string, string> = {
      npm: 'npx',
      pypi: 'uvx',
      oci: 'docker',
    }
    const runner = runners[pkg.registryType]
    const customRegistry =
      pkg.registryBaseUrl &&
      ![
        'https://registry.npmjs.org',
        'https://pypi.org',
        'https://docker.io',
        'https://registry.npmjs.org/',
        'https://pypi.org/',
      ].includes(pkg.registryBaseUrl)
    if (
      !runner ||
      pkg.transport.type !== 'stdio' ||
      pkg.fileSha256 ||
      (pkg.runtimeHint && pkg.runtimeHint !== runner) ||
      (customRegistry && pkg.registryType !== 'oci')
    ) {
      variants.push({
        id,
        label,
        notes: [
          'This package requires a transport, runtime, registry or integrity verification that is not supported by automatic import. Configure it manually.',
        ],
      })
      return
    }
    const notes: string[] = []
    const args = (inputs: Schema.Schema.Type<typeof inputSchema>[]) =>
      inputs.flatMap((input, i) => {
        if (
          input.isSecret ||
          Object.values(input.variables ?? {}).some(
            (value) => decodeResult(inputSchema, value).data?.isSecret,
          )
        )
          throw new Error(
            'Secret command-line arguments are not supported. Use an environment-based package variant.',
          )
        const value = input.value ?? input.default
        if (value === undefined && !input.isRequired) {
          notes.push(
            `Optional argument omitted: ${input.name ?? input.valueHint ?? i + 1}. ${input.description ?? ''}`,
          )
          return []
        }
        const resolved =
          value === undefined
            ? marker(input.name ?? input.valueHint ?? `argument_${i + 1}`)
            : template(value, input.variables)
        if (resolved?.includes('__CONFIGURE_'))
          notes.push(
            `${input.name ?? input.valueHint ?? `Argument ${i + 1}`}: ${input.description ?? 'Replace the configuration placeholder before saving.'}`,
          )
        if (input.type === 'named' && input.name)
          return [input.name, ...(resolved === undefined ? [] : [resolved])]
        return [resolved ?? marker(input.valueHint ?? `argument_${i + 1}`)]
      })
    try {
      const runtimeArgs = args(pkg.runtimeArguments),
        packageArgs = args(pkg.packageArguments)
      const identifier =
        pkg.registryType === 'npm'
          ? `${pkg.identifier}${pkg.version ? `@${pkg.version}` : ''}`
          : pkg.registryType === 'pypi'
            ? `${pkg.identifier}${pkg.version ? `==${pkg.version}` : ''}`
            : pkg.version &&
                !pkg.identifier.includes('@') &&
                !pkg.identifier.split('/').at(-1)?.includes(':')
              ? `${pkg.identifier}:${pkg.version}`
              : pkg.identifier
      const server = decode(mcpServerSchema, {
        ...base,
        transport: 'stdio',
        command: runner,
        args:
          pkg.registryType === 'oci'
            ? [
                'run',
                '--rm',
                '-i',
                ...runtimeArgs,
                ...pkg.environmentVariables.flatMap((input) =>
                  input.name ? ['-e', input.name] : [],
                ),
                identifier,
                ...packageArgs,
              ]
            : [...(runner === 'npx' ? ['-y'] : []), ...runtimeArgs, identifier, ...packageArgs],
      })
      variables(pkg.environmentVariables, server, notes, false)
      variants.push({
        id,
        label,
        server,
        notes,
      })
    } catch (error) {
      variants.push({
        id,
        label,
        notes: [error instanceof Error ? error.message : String(error)],
      })
    }
  })
  return {
    name: entry.name,
    description: entry.description,
    version: entry.version,
    url: sourceUrl,
    variants,
  }
}
export async function searchRegistry(input: unknown) {
  const { query, cursor } = decode(catalogSearchSchema, input)
  const params = new URLSearchParams({
    limit: '20',
    version: 'latest',
    ...(query
      ? {
          search: query,
        }
      : {}),
    ...(cursor
      ? {
          cursor,
        }
      : {}),
  })
  const result = decode(
    mutableStruct({
      servers: mutableArray(
        mutableStruct({
          server: Schema.Unknown,
          _meta: Schema.optional(
            Schema.mutable(
              Schema.Record({
                key: Schema.String,
                value: Schema.Unknown,
              }),
            ),
          ),
        }),
      ),
      metadata: Schema.optional(
        mutableStruct({
          nextCursor: Schema.optional(Schema.String),
        }),
      ),
    }),
    await catalogJson(`https://registry.modelcontextprotocol.io/v0.1/servers?${params}`),
  )
  return decode(registryCatalogSchema, {
    entries: result.servers
      .filter((item) => {
        const status = decodeResult(
          mutableStruct({
            status: Schema.optional(Schema.String),
          }),
          item._meta?.['io.modelcontextprotocol.registry/official'],
        )
        return !status.success || !status.data.status || status.data.status === 'active'
      })
      .map((item) => registryEntry(item.server)),
    cursor: result.metadata?.nextCursor,
  })
}
