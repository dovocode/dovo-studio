import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'
import { Schema } from 'effect'
import {
  decode,
  decodeResult,
  mutableArray,
  mutableStruct,
  type HarnessPluginComponents,
  type HarnessPluginEntry,
} from '@dovo/protocol'
import { catalogBytes, catalogJson } from '../catalogs/fetch.js'

/**
 * Reads GitHub plugin marketplaces as data. Nothing from the repository is executed here: the
 * runtime reads JSON manifests and file listings, and writes files into an immutable snapshot.
 */
export interface MarketplaceFetch {
  json(url: string, maxBytes?: number): Promise<unknown>
  bytes(url: string, maxBytes?: number): Promise<Buffer>
}
export const githubFetch: MarketplaceFetch = {
  json: (url, maxBytes) => catalogJson(url, maxBytes),
  bytes: (url, maxBytes) => catalogBytes(url, maxBytes),
}

const MAX_FILES = 2000
const MAX_BYTES = 32_000_000
const MANIFEST_BYTES = 512_000

const treeSchema = mutableStruct({
  truncated: Schema.Boolean,
  tree: mutableArray(
    mutableStruct({
      path: Schema.String,
      type: Schema.String,
      mode: Schema.String,
      size: Schema.optional(Schema.Number),
    }),
  ),
})
type TreeEntry = (typeof treeSchema.Type)['tree'][number]
export interface RepositorySnapshot {
  repository: string
  revision: string
  tree: TreeEntry[]
}

const rawUrl = (repository: string, revision: string, path: string) =>
  `https://raw.githubusercontent.com/${repository}/${revision}/${path.split('/').map(encodeURIComponent).join('/')}`

export async function resolveRepository(
  fetcher: MarketplaceFetch,
  repository: string,
  ref?: string,
): Promise<RepositorySnapshot> {
  const api = `https://api.github.com/repos/${repository}`
  const commit = decode(
    mutableStruct({ sha: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)) }),
    await fetcher.json(`${api}/commits/${encodeURIComponent(ref ?? 'HEAD')}`),
  )
  return readRevision(fetcher, repository, commit.sha)
}

export async function readRevision(
  fetcher: MarketplaceFetch,
  repository: string,
  revision: string,
): Promise<RepositorySnapshot> {
  const tree = decode(
    treeSchema,
    await fetcher.json(
      `https://api.github.com/repos/${repository}/git/trees/${revision}?recursive=1`,
      8_000_000,
    ),
  )
  if (tree.truncated)
    throw new Error('This repository is too large to read as a plugin marketplace')
  return { repository, revision, tree: tree.tree }
}

async function readJson(fetcher: MarketplaceFetch, snapshot: RepositorySnapshot, path: string) {
  const file = snapshot.tree.find((entry) => entry.path === path && entry.type === 'blob')
  if (!file) return undefined
  const bytes = await fetcher.bytes(
    rawUrl(snapshot.repository, snapshot.revision, path),
    MANIFEST_BYTES,
  )
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new Error(`${path} is not valid JSON`)
  }
}

/** Repository-relative folder, or undefined for absolute, parent or empty paths. */
function relativeFolder(base: string, path: string) {
  if (path.includes('\\') || path.startsWith('/')) return undefined
  const joined = posix.normalize(posix.join(base, path)).replace(/\/+$/, '')
  if (joined.startsWith('../') || joined === '..') return undefined
  return joined
}

const optionalText = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
const pluginName = /^[a-z0-9][a-z0-9._-]{0,63}$/i

const claudeMarketplaceSchema = mutableStruct({
  name: Schema.optional(Schema.String),
  metadata: Schema.optional(mutableStruct({ pluginRoot: Schema.optional(Schema.String) })),
  plugins: mutableArray(
    mutableStruct({
      name: Schema.String,
      source: Schema.Unknown,
      description: Schema.optional(Schema.Unknown),
      version: Schema.optional(Schema.Unknown),
      category: Schema.optional(Schema.Unknown),
    }),
  ),
})
const codexMarketplaceSchema = mutableStruct({
  name: Schema.optional(Schema.String),
  plugins: mutableArray(
    mutableStruct({
      name: Schema.String,
      source: Schema.Unknown,
      category: Schema.optional(Schema.Unknown),
    }),
  ),
})

type Located = Omit<HarnessPluginEntry, 'path' | 'unsupported'> & {
  path?: string
  unsupported?: string
}

function claudeSource(source: unknown, pluginRoot: string): Pick<Located, 'path' | 'unsupported'> {
  if (typeof source === 'string') {
    // A bare name resolves under metadata.pluginRoot, like Claude Code.
    const base = source.startsWith('./') || source.startsWith('../') ? '.' : pluginRoot
    const path = relativeFolder(base, source)
    return path ? { path } : { unsupported: 'The plugin folder is outside the repository' }
  }
  const kind =
    source && typeof source === 'object' && 'source' in source ? String(source.source) : 'unknown'
  return { unsupported: `The ${kind.slice(0, 40)} source type is not supported. Use a folder.` }
}

function codexSource(source: unknown): Pick<Located, 'path' | 'unsupported'> {
  const parsed = decodeResult(
    mutableStruct({ source: Schema.Literal('local'), path: Schema.String }),
    source,
  )
  if (!parsed.success) return { unsupported: 'Only local folder sources are supported' }
  const path = relativeFolder('.', parsed.data.path)
  return path ? { path } : { unsupported: 'The plugin folder is outside the repository' }
}

export async function readCatalog(fetcher: MarketplaceFetch, snapshot: RepositorySnapshot) {
  const claude = await readJson(fetcher, snapshot, '.claude-plugin/marketplace.json')
  const codex = await readJson(fetcher, snapshot, '.agents/plugins/marketplace.json')
  if (claude === undefined && codex === undefined)
    throw new Error(
      'No plugin marketplace found. Expected .claude-plugin/marketplace.json or .agents/plugins/marketplace.json',
    )
  const entries = new Map<string, Located>()
  const add = (entry: Located) => {
    if (!pluginName.test(entry.name)) return
    const existing = entries.get(entry.name)
    if (!existing) return void entries.set(entry.name, entry)
    if (existing.path !== entry.path)
      entries.set(entry.name, {
        ...existing,
        path: undefined,
        unsupported: 'The Claude and Codex manifests list different folders for this plugin',
      })
  }
  let name: string | undefined
  if (claude !== undefined) {
    const manifest = decodeResult(claudeMarketplaceSchema, claude)
    if (!manifest.success) throw new Error('.claude-plugin/marketplace.json has an invalid format')
    name = optionalText(manifest.data.name, 100)
    const root = relativeFolder('.', manifest.data.metadata?.pluginRoot ?? '.') ?? '.'
    for (const plugin of manifest.data.plugins.slice(0, 500))
      add({
        name: plugin.name,
        description: optionalText(plugin.description, 1000),
        version: optionalText(plugin.version, 100),
        category: optionalText(plugin.category, 100),
        ...claudeSource(plugin.source, root),
      })
  }
  if (codex !== undefined) {
    const manifest = decodeResult(codexMarketplaceSchema, codex)
    if (!manifest.success) throw new Error('.agents/plugins/marketplace.json has an invalid format')
    name ??= optionalText(manifest.data.name, 100)
    for (const plugin of manifest.data.plugins.slice(0, 500))
      add({
        name: plugin.name,
        category: optionalText(plugin.category, 100),
        ...codexSource(plugin.source),
      })
  }
  const folders = new Set(
    snapshot.tree.filter((entry) => entry.type === 'tree').map((entry) => entry.path),
  )
  const plugins = [...entries.values()].map((entry): HarnessPluginEntry => {
    if (entry.path && entry.path !== '.' && !folders.has(entry.path))
      return { ...entry, path: undefined, unsupported: 'The plugin folder is missing' }
    return entry
  })
  return {
    name: name ?? snapshot.repository,
    formats: [
      ...(claude !== undefined ? (['claude'] as const) : []),
      ...(codex !== undefined ? (['codex'] as const) : []),
    ],
    plugins: plugins.sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/** Plugin files at the revision. Symlinks, submodules and parent paths are refused. */
function pluginFiles(snapshot: RepositorySnapshot, folder: string) {
  const prefix = folder === '.' ? '' : `${folder}/`
  const files = snapshot.tree.filter(
    (entry) => entry.path.startsWith(prefix) && entry.type !== 'tree',
  )
  for (const file of files)
    if (file.type !== 'blob' || !['100644', '100755'].includes(file.mode))
      throw new Error('Plugins must contain regular files only, without symlinks or submodules')
  const bytes = files.reduce((total, file) => total + (file.size ?? 0), 0)
  if (files.length > MAX_FILES || bytes > MAX_BYTES)
    throw new Error(`Plugins are limited to ${MAX_FILES} files and ${MAX_BYTES / 1_000_000} MB`)
  return { prefix, files, bytes }
}

const manifestSchema = mutableStruct({
  name: Schema.optional(Schema.Unknown),
  description: Schema.optional(Schema.Unknown),
  version: Schema.optional(Schema.Unknown),
  hooks: Schema.optional(Schema.Unknown),
  mcpServers: Schema.optional(Schema.Unknown),
})

export async function previewPlugin(
  fetcher: MarketplaceFetch,
  snapshot: RepositorySnapshot,
  entry: HarnessPluginEntry,
) {
  if (!entry.path) throw new Error(entry.unsupported ?? 'This plugin cannot be installed')
  const { prefix, files, bytes } = pluginFiles(snapshot, entry.path)
  const relative = files.map((file) => file.path.slice(prefix.length))
  const manifests = []
  for (const path of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    const value = await readJson(fetcher, snapshot, prefix + path)
    if (value === undefined) continue
    const parsed = decodeResult(manifestSchema, value)
    if (!parsed.success) throw new Error(`${path} has an invalid format`)
    manifests.push(parsed.data)
  }
  const names = (pattern: RegExp) =>
    [...new Set(relative.flatMap((path) => pattern.exec(path)?.[1] ?? []))].sort().slice(0, 200)
  const servers = new Set<string>()
  const addServers = (value: unknown) => {
    const record =
      value && typeof value === 'object' && 'mcpServers' in value ? value.mcpServers : value
    if (record && typeof record === 'object' && !Array.isArray(record))
      for (const key of Object.keys(record).slice(0, 100)) servers.add(key.slice(0, 100))
  }
  if (relative.includes('.mcp.json'))
    addServers(await readJson(fetcher, snapshot, `${prefix}.mcp.json`))
  for (const manifest of manifests) {
    if (typeof manifest.mcpServers === 'string') {
      const path = relativeFolder('.', manifest.mcpServers)
      if (path && relative.includes(path))
        addServers(await readJson(fetcher, snapshot, prefix + path))
    } else addServers(manifest.mcpServers)
  }
  const components: HarnessPluginComponents = {
    skills: names(/^skills\/([^/]+)\/SKILL\.md$/),
    commands: names(/^commands\/(?:.*\/)?([^/]+)\.md$/),
    agents: names(/^agents\/([^/]+)\.md$/),
    hooks: relative.includes('hooks/hooks.json') || manifests.some((item) => !!item.hooks),
    mcpServers: [...servers].sort(),
  }
  const described = manifests.find((item) => typeof item.description === 'string')
  const versioned = manifests.find((item) => typeof item.version === 'string')
  return {
    plugin: {
      ...entry,
      description: entry.description ?? optionalText(described?.description, 1000),
      version: entry.version ?? optionalText(versioned?.version, 100),
    },
    components,
    files: files.length,
    bytes,
  }
}

/** Name of the local marketplace that holds one reviewed plugin snapshot. */
export function snapshotName(repository: string, revision: string, folder: string) {
  return `dovo-${createHash('sha256').update(`${repository}:${revision}:${folder}`).digest('hex').slice(0, 12)}`
}

/**
 * Writes `<root>/<name>/plugin/...` and a one-entry Codex marketplace beside it. The snapshot is
 * immutable: a second install of the same revision reuses the folder.
 */
export async function writeSnapshot(
  fetcher: MarketplaceFetch,
  snapshot: RepositorySnapshot,
  entry: HarnessPluginEntry,
  root: string,
) {
  if (!entry.path) throw new Error(entry.unsupported ?? 'This plugin cannot be installed')
  const { prefix, files } = pluginFiles(snapshot, entry.path)
  const name = snapshotName(snapshot.repository, snapshot.revision, entry.path)
  const destination = join(root, name)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const staging = await mkdtemp(join(root, '.install-'))
  try {
    let written = 0
    for (let index = 0; index < files.length; index += 4) {
      const results = await Promise.allSettled(
        files.slice(index, index + 4).map(async (file) => {
          const contents = await fetcher.bytes(
            rawUrl(snapshot.repository, snapshot.revision, file.path),
            8_000_000,
          )
          written += contents.length
          if (written > MAX_BYTES) throw new Error('Plugin exceeds the size limit')
          const path = join(staging, 'plugin', file.path.slice(prefix.length))
          await mkdir(dirname(path), { recursive: true })
          await writeFile(path, contents, {
            mode: file.mode === '100755' ? 0o700 : 0o600,
            flag: 'wx',
          })
        }),
      )
      for (const result of results) if (result.status === 'rejected') throw result.reason
    }
    await mkdir(join(staging, '.agents', 'plugins'), { recursive: true })
    await writeFile(
      join(staging, '.agents', 'plugins', 'marketplace.json'),
      JSON.stringify({
        name,
        plugins: [{ name: entry.name, source: { source: 'local', path: './plugin' } }],
      }),
      { mode: 0o600 },
    )
    try {
      await rename(staging, destination)
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        !['EEXIST', 'ENOTEMPTY'].includes(String(error.code))
      )
        throw error
      // The same revision is already on disk.
    }
    return { name, directory: destination }
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}
