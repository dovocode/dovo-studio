import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  harnessPluginMarketplaceSchema,
  installedHarnessPluginSchema,
  mutableStruct,
  parseGithubRepository,
  type HarnessPluginCatalog,
  type HarnessPluginCommand,
  type HarnessPluginHarness,
  type HarnessPluginMarketplace,
  type HarnessPluginPreview,
  type HarnessPluginState,
  type ResourceSettings,
  activePlugins,
} from '@dovo/protocol'
import { HttpError } from '../../errors.js'
import { withCatalogRpc } from '../catalogs/rpc.js'
import {
  githubFetch,
  previewPlugin,
  readCatalog,
  readRevision,
  resolveRepository,
  snapshotName,
  writeSnapshot,
  type MarketplaceFetch,
} from './marketplace.js'

/** Codex keeps installed plugins in its own home. Dovo uses only the app-server plugin API. */
export interface CodexPluginHost {
  install(snapshot: string, plugin: string): Promise<void>
  setEnabled(pluginId: string, enabled: boolean): Promise<void>
  remove(pluginId: string, marketplace: string): Promise<void>
}

export function codexAppServerPlugins(
  executable = 'codex',
  env?: Record<string, string>,
): CodexPluginHost {
  const call = (
    operations: (request: (method: string, params: object) => Promise<unknown>) => Promise<void>,
  ) =>
    withCatalogRpc(
      executable,
      ['app-server', '--listen', 'stdio://'],
      async (rpc) => {
        await rpc.sendRequest('initialize', {
          clientInfo: { name: 'dovo_studio', version: '0.1.0' },
          capabilities: { experimentalApi: true },
        })
        await rpc.sendNotification('initialized', {})
        await operations((method, params) => rpc.sendRequest(method, params))
      },
      env,
    )
  return {
    install: (snapshot, plugin) =>
      call(async (request) => {
        await request('marketplace/add', { source: snapshot })
        await request('plugin/install', {
          pluginName: plugin,
          marketplacePath: join(snapshot, '.agents', 'plugins', 'marketplace.json'),
        })
      }),
    setEnabled: (pluginId, enabled) =>
      call(async (request) => {
        await request('config/value/write', {
          keyPath: `plugins.${JSON.stringify(pluginId)}.enabled`,
          value: enabled,
          mergeStrategy: 'upsert',
        })
      }),
    remove: (pluginId, marketplace) =>
      call(async (request) => {
        await request('plugin/uninstall', { pluginId })
        await request('marketplace/remove', { marketplaceName: marketplace })
      }),
  }
}

const installedRecordSchema = mutableStruct({
  ...installedHarnessPluginSchema.fields,
  /** Repository folder of the plugin at the installed revision. */
  folder: Schema.String,
})
type InstalledRecord = typeof installedRecordSchema.Type

const marketplaceId = (repository: string) =>
  `gh-${createHash('sha256').update(repository.toLowerCase()).digest('hex').slice(0, 12)}`

export class HarnessPlugins {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly catalogs = new Map<string, Promise<Omit<HarnessPluginCatalog, 'marketplace'>>>()
  constructor(
    private readonly db: Database.Database,
    private readonly root: string,
    private readonly codex: CodexPluginHost = codexAppServerPlugins(),
    private readonly fetcher: MarketplaceFetch = githubFetch,
    private readonly now = () => new Date(),
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS harness_plugin_marketplaces (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS harness_plugins (id TEXT PRIMARY KEY, value TEXT NOT NULL);`)
  }

  state(): HarnessPluginState {
    return {
      marketplaces: this.marketplaces(),
      plugins: this.installed().map(({ folder: _folder, ...plugin }) => plugin),
    }
  }

  /** Claude Code plugin folders active for a thread, after its project and organization choices. */
  claudePluginPaths(resources: Pick<ResourceSettings, 'plugins'>) {
    const claude = this.installed().filter((plugin) => plugin.harness === 'claude')
    const active = new Set(activePlugins(claude, resources))
    return claude
      .filter((plugin) => active.has(plugin.id))
      .map((plugin) => this.pluginFolder(plugin))
  }

  command(
    command: HarnessPluginCommand,
  ): Promise<HarnessPluginState | HarnessPluginCatalog | HarnessPluginPreview> {
    switch (command.action) {
      case 'list':
        return Promise.resolve(this.state())
      case 'catalog':
        return this.catalog(command.marketplaceId)
      case 'preview':
        return this.preview(command.marketplaceId, command.plugin)
      case 'add-marketplace':
        return this.serial(() => this.addMarketplace(command.repository, command.ref))
      case 'refresh-marketplace':
        return this.serial(() => this.refreshMarketplace(command.marketplaceId))
      case 'remove-marketplace':
        return this.serial(() => this.removeMarketplace(command.marketplaceId))
      case 'install':
        return this.serial(() => this.install(command))
      case 'set-enabled':
        return this.serial(() => this.setEnabled(command.id, command.enabled))
      case 'remove':
        return this.serial(() => this.remove(command.id))
    }
  }

  /** Mutations run one at a time, so repeated clicks see the result of the earlier action. */
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.catch(() => undefined)
    return next
  }

  private marketplaces(): HarnessPluginMarketplace[] {
    return this.db
      .prepare('SELECT value FROM harness_plugin_marketplaces ORDER BY id')
      .pluck()
      .all()
      .map((value) => decode(harnessPluginMarketplaceSchema, JSON.parse(String(value))))
  }
  private marketplace(id: string) {
    const found = this.marketplaces().find((entry) => entry.id === id)
    if (!found) throw new HttpError(404, 'Marketplace not found. Reload the list.')
    return found
  }
  private saveMarketplace(marketplace: HarnessPluginMarketplace) {
    this.db
      .prepare(
        'INSERT INTO harness_plugin_marketplaces VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(marketplace.id, JSON.stringify(marketplace))
  }
  private installed(): InstalledRecord[] {
    return this.db
      .prepare('SELECT value FROM harness_plugins ORDER BY id')
      .pluck()
      .all()
      .map((value) => decode(installedRecordSchema, JSON.parse(String(value))))
  }
  private plugin(id: string) {
    const found = this.installed().find((plugin) => plugin.id === id)
    if (!found) throw new HttpError(404, 'Plugin not found. Reload the list.')
    return found
  }
  private savePlugin(plugin: InstalledRecord) {
    this.db
      .prepare(
        'INSERT INTO harness_plugins VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',
      )
      .run(plugin.id, JSON.stringify(plugin))
  }
  private snapshot(plugin: Pick<InstalledRecord, 'repository' | 'revision' | 'folder'>) {
    return snapshotName(plugin.repository, plugin.revision, plugin.folder)
  }
  private pluginFolder(plugin: InstalledRecord) {
    return join(this.root, this.snapshot(plugin), 'plugin')
  }

  private async addMarketplace(input: string, ref?: string) {
    const repository = parseGithubRepository(input)
    if (!repository) throw new HttpError(400, 'Enter a GitHub repository as owner/repo')
    const id = marketplaceId(repository)
    const existing = this.marketplaces().find((entry) => entry.id === id)
    if (existing && existing.ref === ref) return this.state()
    await this.resolve(id, repository, ref, existing?.addedAt)
    return this.state()
  }
  private async refreshMarketplace(id: string) {
    const marketplace = this.marketplace(id)
    await this.resolve(id, marketplace.repository, marketplace.ref, marketplace.addedAt)
    return this.state()
  }
  private async resolve(id: string, repository: string, ref?: string, addedAt?: string) {
    const snapshot = await resolveRepository(this.fetcher, repository, ref).catch(
      (error: unknown) => {
        throw new HttpError(
          502,
          `Could not read ${repository}: ${error instanceof Error ? error.message : String(error)}`,
        )
      },
    )
    const catalog = await readCatalog(this.fetcher, snapshot).catch((error: unknown) => {
      throw new HttpError(422, error instanceof Error ? error.message : String(error))
    })
    this.catalogs.set(snapshot.revision, Promise.resolve(catalog))
    this.saveMarketplace({
      id,
      repository,
      ...(ref ? { ref } : {}),
      revision: snapshot.revision,
      name: catalog.name,
      addedAt: addedAt ?? this.now().toISOString(),
    })
  }
  private async removeMarketplace(id: string) {
    const count = this.installed().filter((plugin) => plugin.marketplaceId === id).length
    if (count)
      throw new HttpError(
        409,
        `Remove the ${count} installed plugin(s) from this marketplace first`,
      )
    this.db.prepare('DELETE FROM harness_plugin_marketplaces WHERE id=?').run(id)
    return this.state()
  }

  private async catalog(id: string): Promise<HarnessPluginCatalog> {
    const marketplace = this.marketplace(id)
    return { marketplace, ...(await this.catalogAt(marketplace)) }
  }
  private catalogAt(marketplace: HarnessPluginMarketplace) {
    let catalog = this.catalogs.get(marketplace.revision)
    if (!catalog) {
      catalog = readRevision(this.fetcher, marketplace.repository, marketplace.revision).then(
        (snapshot) => readCatalog(this.fetcher, snapshot),
      )
      this.catalogs.set(marketplace.revision, catalog)
      catalog.catch(() => this.catalogs.delete(marketplace.revision))
    }
    return catalog
  }
  private async entry(marketplace: HarnessPluginMarketplace, name: string) {
    const entry = (await this.catalogAt(marketplace)).plugins.find((item) => item.name === name)
    if (!entry) throw new HttpError(404, `${name} is not in this marketplace revision`)
    return entry
  }
  private async preview(id: string, name: string): Promise<HarnessPluginPreview> {
    const marketplace = this.marketplace(id)
    const entry = await this.entry(marketplace, name)
    const snapshot = await readRevision(this.fetcher, marketplace.repository, marketplace.revision)
    const preview = await previewPlugin(this.fetcher, snapshot, entry).catch((error: unknown) => {
      throw new HttpError(422, error instanceof Error ? error.message : String(error))
    })
    return {
      marketplaceId: id,
      repository: marketplace.repository,
      revision: marketplace.revision,
      ...preview,
    }
  }

  private async install(command: Extract<HarnessPluginCommand, { action: 'install' }>) {
    const marketplace = this.marketplace(command.marketplaceId)
    if (marketplace.revision !== command.revision)
      throw new HttpError(
        409,
        'The marketplace changed since this review. Review the plugin again before installing.',
      )
    const id = `${command.plugin}@${marketplace.id}:${command.harness}`
    const previous = this.installed().find((plugin) => plugin.id === id)
    // Repeating a reviewed install is a no-op; activation changes go through set-enabled.
    if (previous?.revision === command.revision) return this.state()
    const entry = await this.entry(marketplace, command.plugin)
    const snapshot = await readRevision(this.fetcher, marketplace.repository, marketplace.revision)
    const preview = await previewPlugin(this.fetcher, snapshot, entry)
    const written = await writeSnapshot(this.fetcher, snapshot, entry, this.root)
    if (command.harness === 'codex') {
      // An update registers the new revision before retiring the old one.
      await this.codex.install(written.directory, entry.name)
      // Codex enables new plugins; an installation without activation turns it off again.
      if (!command.enabled) await this.codex.setEnabled(`${entry.name}@${written.name}`, false)
      if (previous) await this.retireCodex(previous)
    }
    const record: InstalledRecord = {
      id,
      marketplaceId: marketplace.id,
      repository: marketplace.repository,
      revision: marketplace.revision,
      name: entry.name,
      ...(preview.plugin.version ? { version: preview.plugin.version } : {}),
      harness: command.harness,
      enabled: command.enabled,
      components: preview.components,
      installedAt: this.now().toISOString(),
      folder: entry.path ?? '.',
    }
    this.savePlugin(record)
    if (previous) await this.discardSnapshot(previous)
    return this.state()
  }

  private async setEnabled(id: string, enabled: boolean) {
    const plugin = this.plugin(id)
    if (plugin.enabled === enabled) return this.state()
    if (plugin.harness === 'codex')
      await this.codex.setEnabled(`${plugin.name}@${this.snapshot(plugin)}`, enabled)
    this.savePlugin({ ...plugin, enabled })
    return this.state()
  }

  private async remove(id: string) {
    const plugin = this.installed().find((entry) => entry.id === id)
    if (!plugin) return this.state()
    if (plugin.harness === 'codex') await this.retireCodex(plugin)
    this.db.prepare('DELETE FROM harness_plugins WHERE id=?').run(id)
    await this.discardSnapshot(plugin)
    return this.state()
  }
  private retireCodex(plugin: InstalledRecord) {
    const marketplace = this.snapshot(plugin)
    return this.codex.remove(`${plugin.name}@${marketplace}`, marketplace)
  }
  /** Another harness may still use the same revision's snapshot. */
  private async discardSnapshot(plugin: InstalledRecord) {
    const name = this.snapshot(plugin)
    if (this.installed().some((entry) => entry.id !== plugin.id && this.snapshot(entry) === name))
      return
    await rm(join(this.root, name), { recursive: true, force: true })
  }
}

export type { HarnessPluginHarness }
