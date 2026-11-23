import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  extensionViewResultIds,
  isStudioDataSource,
  studioDataSourceIssue,
  extensionViewComponents,
  extensionViewLimits,
  mutableStruct,
  marketplaceOriginSchema,
  marketplaceNeedsSource,
  type MarketplaceOrigin,
  type StudioMarketplaceRequest,
  studioExtensionEntrySchema,
  studioExtensionManifestSchema,
  studioMarketplaceRequestSchema,
  type ExtensionContribution,
  type StudioExtensionCommand,
  type StudioExtensionComponentVersion,
  type StudioExtensionEntry,
  type StudioExtensionManifest,
  type StudioExtensionPageLink,
  type StudioSourcePolicyRequest,
} from '@dovo/protocol'
import type { McpApps } from '../mcp-apps/bridge.js'
import { HttpError } from '../errors.js'
import { readStudioData, type DataSourceDirectory } from '../dashboards/data-sources.js'
import { exactMarketplaceRelease, marketplaceCatalog } from './marketplace.js'
import { SourcePolicies, sourcePolicyTarget } from '../studio/source-policies.js'
import { RecentSourceReadings } from '../studio/recent-source-readings.js'

const row = mutableStruct({ id: Schema.String, revision: Schema.Number, entry: Schema.String })
const object = Schema.Record(Schema.String, Schema.Unknown)

function argumentsFor(source = '{}') {
  try {
    return decode(object, JSON.parse(source))
  } catch {
    throw new HttpError(400, 'Tool arguments must be a JSON object.')
  }
}

function settingsFor(
  manifest: StudioExtensionManifest | undefined,
  saved: StudioExtensionEntry['settings'],
) {
  return Object.fromEntries(
    (manifest?.settings ?? []).map((field) => {
      const value = Object.hasOwn(saved, field.id) ? saved[field.id] : undefined
      return [
        field.id,
        value !== undefined && typeof value === typeof field.default ? value : field.default,
      ]
    }),
  )
}

function validate(manifest: StudioExtensionManifest) {
  const settings = new Set(manifest.settings?.map((field) => field.id))
  for (const contribution of manifest.contributions) {
    if (isStudioDataSource(contribution)) {
      const issue = studioDataSourceIssue(contribution)
      if (issue) throw new HttpError(400, `${contribution.title}: ${issue}`)
    }
    if (contribution.kind !== 'tool') continue
    argumentsFor(contribution.arguments)
    if (contribution.server === 'dovo_task')
      throw new HttpError(400, 'Choose a configured MCP server for the extension tool.')
    for (const key of Object.values(contribution.inputs ?? {}))
      if (!settings.has(key)) throw new HttpError(400, `Unknown extension setting: ${key}`)
  }
}

function viewNeedsVersion3(item: Extract<ExtensionContribution, { kind: 'view' }>) {
  return item.placement === 'page' || item.view.nodes.some((node) => node.kind === 'data-grid')
}

function requiredComponentVersion(
  manifest?: StudioExtensionManifest,
): 0 | StudioExtensionComponentVersion {
  if (
    manifest?.contributions.some(
      (item) => isStudioDataSource(item) || (item.kind === 'view' && viewNeedsVersion3(item)),
    )
  )
    return 3
  let version: 0 | 1 = 0
  for (const item of manifest?.contributions ?? []) {
    if (item.kind !== 'view') continue
    if (
      item.view.nodes.some((node) => node.kind === 'custom' && node.component.props !== undefined)
    )
      return 2
    version = 1
  }
  return version
}

function projectContribution(item: ExtensionContribution, version: number): ExtensionContribution {
  if (item.kind !== 'view' || version >= 2) return item
  return {
    ...item,
    view: {
      ...item.view,
      nodes: item.view.nodes.map((node) => {
        if (node.kind !== 'custom' || node.component.props === undefined) return node
        const { props: _props, ...component } = node.component
        return { ...node, component }
      }),
    },
  }
}

function projectEntry(
  entry: StudioExtensionEntry,
  version: StudioExtensionComponentVersion | 0 = 0,
): StudioExtensionEntry {
  const project = (manifest: StudioExtensionManifest | undefined) => {
    if (requiredComponentVersion(manifest) <= version || !manifest) return manifest
    const sources = new Set(manifest.contributions.filter(isStudioDataSource).map(({ id }) => id))
    const contributions = manifest.contributions
      .filter(
        (item) =>
          !isStudioDataSource(item) &&
          (item.kind !== 'view' ||
            (version > 0 &&
              !viewNeedsVersion3(item) &&
              ![...extensionViewResultIds(item.view)].some((id) => sources.has(id)))),
      )
      .map((item) => projectContribution(item, version))
    return { ...manifest, contributions }
  }
  return {
    ...entry,
    installed: project(entry.installed),
    draft: project(entry.draft),
    error:
      requiredComponentVersion(entry.draft) > version
        ? 'Update Studio to review and install this extension draft.'
        : entry.error,
  }
}

const uiSdk = {
  version: 1,
  module: '@dovo/protocol/studio-extension-sdk',
  helpers: [
    'defineExtension',
    'view',
    'page',
    'apiSource',
    'cliSource',
    'sourceControls',
    'dataGrid',
    'setting',
    'result',
  ],
  manifestContract: { action: 'catalog', component: 'manifest' },
  guide: { tool: 'dovo_help', action: 'search', query: 'typed UI SDK' },
  help: 'Use the TypeScript module in the Studio workspace. In other projects, use the manifest JSON Schema for editor or TypeScript checking. Run validate before stage.',
}

type ExtensionAgent = { taskId: string; readOnly: boolean }

type DataContribution = Extract<ExtensionContribution, { kind: 'api' | 'cli' }>

type ActiveCall = {
  controller: AbortController
  id: string
  source?: DataContribution
  tool?: string
}

/** The fields that decide what a data source reads. Titles and displays do not. */
function dataTarget(source: DataContribution) {
  return JSON.stringify(
    source.kind === 'api'
      ? [source.id, source.kind, source.url, source.pointer]
      : [source.id, source.kind, source.repositoryId, source.command, source.pointer],
  )
}

type DataRead = { data: unknown; updatedAt: number }

/** One read of an installed data source, shared by every paired caller that asks for it. */
type SharedRead = { read: Promise<DataRead>; callers: Set<() => void> }

export class StudioExtensions {
  private readonly policies: SourcePolicies
  private readonly recent = new RecentSourceReadings()
  private ready = false
  private generation = 0
  private pageCache?: { revision: number; pages: StudioExtensionPageLink[] }

  get revision() {
    return this.generation
  }
  private readonly calls = new Set<ActiveCall>()
  private readonly sourceReads = new Map<string, SharedRead>()
  private readonly shutdown = new AbortController()
  constructor(
    private db: Database.Database,
    private mcp: Pick<McpApps, 'feedRead' | 'marketplaceSources'> &
      Partial<Pick<McpApps, 'extensionSourceIdentity' | 'extensionAppIdentity'>>,
    private requireActiveThread: (id: string) => void,
    private dataDirectory?: DataSourceDirectory,
  ) {
    this.policies = new SourcePolicies(db, 'extension')
  }

  private policyTarget(entry: StudioExtensionEntry, source: ExtensionContribution, cwd?: string) {
    if (source.kind === 'tool')
      return sourcePolicyTarget([
        source,
        this.mcp.extensionSourceIdentity?.(source.taskId, source.server),
        Object.values(source.inputs ?? {}).map((id) => entry.settings[id]),
      ])
    if (source.kind === 'app')
      return sourcePolicyTarget([
        source,
        this.mcp.extensionAppIdentity?.(source.taskId, source.appId),
      ])
    return sourcePolicyTarget([source, cwd])
  }

  private policySource(id: string, sourceId: string, revision?: number) {
    const entry = this.get(id)?.extension
    const source = entry?.installed?.contributions.find((item) => item.id === sourceId)
    if (
      !entry?.enabled ||
      !source ||
      (source.kind !== 'tool' && source.kind !== 'app' && !isStudioDataSource(source))
    )
      throw new HttpError(404, 'This extension source is unavailable.')
    if (revision !== undefined && entry.revision !== revision)
      throw new HttpError(409, 'The extension changed. Reload its sources.')
    return { entry, source }
  }

  async sourcePolicy(input: StudioSourcePolicyRequest, authorize: () => void) {
    const { entry, source } = this.policySource(input.id, input.sourceId, input.expectedRevision)
    if (input.policy?.access === 'off') {
      authorize()
      this.policies.clear(input.id, input.sourceId)
      this.recent.clear(input.id, input.sourceId)
      return { access: 'off' as const, autoLoad: false }
    }
    const cwd =
      source.kind === 'cli' ? await this.dataDirectory?.(source.repositoryId, authorize) : undefined
    authorize()
    this.policySource(input.id, input.sourceId, input.expectedRevision)
    const target = this.policyTarget(entry, source, cwd)
    if (input.policy) this.recent.clear(input.id, input.sourceId)
    return input.policy
      ? this.policies.save(input.id, input.sourceId, target, input.policy)
      : this.policies.read(input.id, input.sourceId, target)
  }

  authorizeAppTools(id: string, sourceId: string, taskId: string, appId: string) {
    const { entry, source } = this.policySource(id, sourceId)
    if (
      source.kind !== 'app' ||
      source.taskId !== taskId ||
      source.appId !== appId ||
      this.policies.read(id, sourceId, this.policyTarget(entry, source)).access === 'off'
    )
      throw new HttpError(403, 'Allow this extension to use the MCP App tools first.')
  }

  private storage() {
    if (!this.ready) {
      this.db.exec(
        `CREATE TABLE IF NOT EXISTS studio_extensions(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, entry TEXT NOT NULL);
         CREATE TABLE IF NOT EXISTS studio_extension_page_pins(extension TEXT NOT NULL, page TEXT NOT NULL, PRIMARY KEY(extension, page));
         CREATE TABLE IF NOT EXISTS studio_extension_preferences(id INTEGER PRIMARY KEY CHECK(id=1), agent_install INTEGER NOT NULL);
         CREATE TABLE IF NOT EXISTS studio_extension_revision(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL);
         INSERT OR IGNORE INTO studio_extension_revision
           SELECT 1, COALESCE(MAX(revision), 0) FROM studio_extensions;`,
      )
      this.ready = true
    }
    return this.db
  }

  pinnedPages(): StudioExtensionPageLink[] {
    if (this.pageCache?.revision === this.generation) return this.pageCache.pages
    const schema = mutableStruct({ extension: Schema.String, page: Schema.String })
    const hasPins =
      this.ready ||
      this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='studio_extension_page_pins'").get()
    const pins = hasPins
      ? this.storage()
          .prepare('SELECT extension,page FROM studio_extension_page_pins ORDER BY rowid')
          .all()
      : []
    const installed = new Map<string, StudioExtensionEntry | undefined>()
    const pages = pins.flatMap((value) => {
      const pin = decode(schema, value)
      if (!installed.has(pin.extension))
        installed.set(pin.extension, this.get(pin.extension)?.extension)
      const entry = installed.get(pin.extension)
      if (!entry?.enabled) return []
      const page = entry.installed?.contributions.find((item) => item.id === pin.page)
      return page?.kind === 'view' && page.placement === 'page'
        ? [{ extensionId: pin.extension, pageId: page.id, title: page.title }]
        : []
    })
    this.pageCache = { revision: this.generation, pages }
    return pages
  }

  private pinPage(input: Extract<StudioExtensionCommand, { action: 'pin-page' }>) {
    const entry = this.get(input.id)?.extension
    if (
      !entry?.enabled ||
      !entry.installed?.contributions.some(
        (item) =>
          item.id === input.contributionId && item.kind === 'view' && item.placement === 'page',
      )
    )
      throw new HttpError(404, 'This extension page is unavailable.')
    if (entry.revision !== input.expectedRevision)
      throw new HttpError(409, 'The extension changed. Reload it before changing its sidebar pins.')
    const sql = input.pinned
      ? 'INSERT OR IGNORE INTO studio_extension_page_pins VALUES(?,?)'
      : 'DELETE FROM studio_extension_page_pins WHERE extension=? AND page=?'
    if (this.storage().prepare(sql).run(input.id, input.contributionId).changes) this.generation++
    return { ok: true as const }
  }

  private allowsAgentInstall() {
    const pref = this.storage()
      .prepare('SELECT agent_install FROM studio_extension_preferences WHERE id=1')
      .get()
    return (
      pref !== undefined &&
      decode(mutableStruct({ agent_install: Schema.Number }), pref).agent_install === 1
    )
  }

  private decodeRow(value: unknown) {
    const saved = decode(row, value)
    try {
      const stored = decode(
        mutableStruct({
          extension: studioExtensionEntrySchema,
          previous: Schema.optional(studioExtensionEntrySchema),
          draftTaskId: Schema.optional(Schema.String),
          installedTaskId: Schema.optional(Schema.String),
          previousTaskId: Schema.optional(Schema.String),
          draftRelease: Schema.optional(marketplaceOriginSchema),
          installedRelease: Schema.optional(marketplaceOriginSchema),
          previousRelease: Schema.optional(marketplaceOriginSchema),
        }),
        JSON.parse(saved.entry),
      )
      if (stored.extension.id !== saved.id || stored.extension.revision !== saved.revision)
        throw new Error('Extension identity changed')
      return stored
    } catch {
      return {
        extension: {
          id: saved.id,
          revision: saved.revision,
          enabled: false,
          settings: {},
          canRollback: false,
          error:
            'The stored extension could not be loaded. Remove it or stage a replacement manifest.',
        } satisfies StudioExtensionEntry,
        previous: undefined,
        draftTaskId: undefined,
        installedTaskId: undefined,
        previousTaskId: undefined,
        draftRelease: undefined,
        installedRelease: undefined,
        previousRelease: undefined,
      }
    }
  }

  private get(id: string) {
    const found = this.storage().prepare('SELECT * FROM studio_extensions WHERE id=?').get(id)
    return found === undefined ? undefined : this.decodeRow(found)
  }

  /** The installed, enabled data source that still reads the same target, if any. */
  private currentSource(id: string, source: DataContribution) {
    const entry = this.get(id)?.extension
    const saved = entry?.enabled
      ? entry.installed?.contributions.find((item) => item.id === source.id)
      : undefined
    return saved && isStudioDataSource(saved) && dataTarget(saved) === dataTarget(source)
  }

  /**
   * Cancels tool calls after any change. A data read continues while its source reads the same
   * target, so a settings save does not cancel it.
   */
  private stop(id: string) {
    for (const call of this.calls)
      if (call.id === id && (!call.source || !this.currentSource(id, call.source)))
        call.controller.abort(new HttpError(409, 'The extension changed during the call.'))
  }

  command(input: StudioExtensionCommand, authorize: () => void, agent?: ExtensionAgent) {
    authorize()
    return input.action === 'marketplace'
      ? this.marketplace(input.marketplace, authorize, agent)
      : this.execute(input, authorize, agent)
  }

  private async marketplace(
    input: StudioMarketplaceRequest,
    authorize: () => void,
    agent?: ExtensionAgent,
  ) {
    if (input.action === 'list') {
      const query = input.query?.trim().toLowerCase() ?? ''
      return {
        packages: marketplaceCatalog().flatMap(({ package: release, digest }) => {
          const {
            manifest: { id, name },
            description,
            version,
            publisher,
          } = release
          if (
            ![id, name, publisher, description].some((value) => value.toLowerCase().includes(query))
          )
            return []
          const saved = this.get(id)
          return [
            {
              id,
              name,
              description,
              version,
              publisher,
              digest,
              ...(saved?.installedRelease && { installed: saved.installedRelease }),
              ...(saved?.draftRelease && { draft: saved.draftRelease }),
            },
          ]
        }),
      }
    }
    const sources = (given?: string) => {
      const taskId = given ?? agent?.taskId
      if (!taskId) throw new HttpError(400, 'Choose a source thread on this computer.')
      if (agent && taskId !== agent.taskId)
        throw new HttpError(403, 'An agent can only bind sources in its own thread.')
      this.requireActiveThread(taskId)
      return { taskId, ...this.mcp.marketplaceSources(taskId) }
    }
    if (input.action === 'sources') {
      const { servers, apps } = sources(input.taskId)
      return { servers, apps }
    }
    if (input.action === 'read') return exactMarketplaceRelease(input.id, input.digest)
    if (agent?.readOnly) throw new HttpError(403, 'This agent cannot stage an extension.')
    const { package: release, digest } = exactMarketplaceRelease(input.id, input.digest)
    const pending = new Map(input.bindings.map((binding) => [binding.contributionId, binding]))
    if (pending.size !== input.bindings.length)
      throw new HttpError(400, 'Each marketplace contribution can have one binding.')
    const cached = new Map<string | undefined, ReturnType<typeof sources>>()
    const contributions = await Promise.all(
      release.manifest.contributions.map(async (item) => {
        if (!marketplaceNeedsSource(item)) return item
        const binding = pending.get(item.id)
        if (!binding) throw new HttpError(400, `Choose a source for ${item.title}.`)
        pending.delete(item.id)
        if (item.kind === 'cli') {
          if (!this.dataDirectory || binding.taskId)
            throw new HttpError(400, 'Choose a project on this computer for the command.')
          await this.dataDirectory(binding.source, authorize)
          return { ...item, repositoryId: binding.source }
        }
        const selected = cached.get(binding.taskId) ?? sources(binding.taskId)
        cached.set(binding.taskId, selected)
        if (item.kind === 'tool') {
          if (!selected.servers.includes(binding.source))
            throw new HttpError(400, 'Choose an enabled MCP server in the source thread.')
          return { ...item, taskId: selected.taskId, server: binding.source }
        }
        if (!selected.apps.some((app) => app.id === binding.source))
          throw new HttpError(400, 'Choose a saved MCP App in the source thread.')
        return { ...item, taskId: selected.taskId, appId: binding.source }
      }),
    )
    authorize()
    if (pending.size)
      throw new HttpError(400, 'One or more bindings do not belong to this package.')
    return this.execute(
      {
        action: 'stage',
        expectedRevision: input.expectedRevision,
        manifest: { ...release.manifest, contributions },
      },
      authorize,
      agent,
      { version: release.version, digest },
    )
  }

  private execute(
    input: Exclude<StudioExtensionCommand, { action: 'marketplace' }>,
    authorize: () => void,
    agent?: ExtensionAgent,
    release?: MarketplaceOrigin,
  ) {
    if (input.action === 'catalog') {
      const options = {
        onExcessProperty: 'error' as const,
        includeAnnotationKey: (key: string) => key === 'pattern',
      }
      if (input.component === 'marketplace')
        return {
          action: 'marketplace',
          inputKey: 'marketplace',
          schema: Schema.toJsonSchemaDocument(
            Schema.toType(studioMarketplaceRequestSchema),
            options,
          ),
        }
      if (input.component === 'manifest') {
        const document = Schema.toJsonSchemaDocument(
          Schema.toType(studioExtensionManifestSchema),
          options,
        )
        return {
          sdk: uiSdk,
          schema: {
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            ...document.schema,
            $defs: document.definitions,
          },
        }
      }
      const component = Object.entries(extensionViewComponents).find(
        ([kind]) => kind === input.component,
      )
      if (component) {
        const [kind, schema] = component
        return {
          component: kind,
          viewVersion: 1,
          schema: Schema.toJsonSchemaDocument(Schema.toType(schema), options),
        }
      }
      return {
        format: 'Studio extension manifest v1',
        sdk: uiSdk,
        marketplace: {
          browse: { action: 'marketplace', marketplace: { action: 'list' } },
          contract: { action: 'catalog', component: 'marketplace' },
        },
        views: {
          version: 1,
          placements: ['settings', 'tool', 'page'],
          components: Object.keys(extensionViewComponents),
          limits: extensionViewLimits,
          discovery: 'Call catalog with component set to a kind for its property schema.',
          bindings:
            'Use {setting: id} or {result: contributionId, path: ["field", "0"]}. Buttons and menus call declared tool contributions on a click. Views that bind an API or CLI result show refresh controls. Use sourceControls to place refresh controls and dataGrid to show multiple displays from one result. Edit controls bind to settings. A custom component requires a Studio fallback. Custom type diagram renders bounded rect, circle and text shapes. Other types render the fallback.',
        },
        example: {
          id: 'example.delivery',
          version: 1,
          name: 'Delivery',
          settings: [{ id: 'branch', title: 'Branch', default: 'main' }],
          contributions: [
            { kind: 'studio', id: 'pipelines', title: 'Open pull requests', destination: 'pulls' },
            {
              kind: 'tool',
              id: 'status',
              title: 'Service status',
              taskId: 'THREAD_ID',
              server: 'service',
              tool: 'status',
              arguments: '{}',
              inputs: { branch: 'branch' },
            },
            { kind: 'app', id: 'details', title: 'Details', taskId: 'THREAD_ID', appId: 'APP_ID' },
            {
              kind: 'view',
              id: 'status-view',
              title: 'Status view',
              placement: 'settings',
              view: {
                version: 1,
                root: 'main',
                nodes: [
                  { id: 'main', kind: 'stack', children: ['branch-input', 'run', 'result'] },
                  { id: 'branch-input', kind: 'input', label: 'Branch', setting: 'branch' },
                  { id: 'run', kind: 'button', label: 'Read status', action: 'status' },
                  { id: 'result', kind: 'badge', value: { result: 'status', path: ['status'] } },
                ],
              },
            },
          ],
        },
        pages: {
          placement: 'page',
          sdk: 'page({ id, title, root })',
          help: 'A page opens in the main workspace. Paired Studio users choose which pages to pin.',
        },
        dataSources: {
          kinds: ['api', 'cli'],
          refreshSeconds:
            'Optional integer from 30 to 86400. Paired users start and stop timed refresh in Studio.',
          example: {
            kind: 'cli',
            id: 'metrics',
            title: 'Metrics',
            repositoryId: 'PROJECT_ID',
            command: 'your-cli --json',
            pointer: '',
            chart: 'table',
            refreshSeconds: 60,
          },
        },
        destinations: ['tasks', 'terminal', 'browser', 'dashboards', 'jobs', 'pulls'],
        help: 'Use unique lowercase IDs. Settings support text and booleans. Studio displays settings on the extension page. A dashboard tile references the extension ID and contribution ID. Agents can stage a draft. A paired user installs it by default. Agents can install their own drafts if the computer enables agent installation. A paired user must install a draft with a CLI data source.',
      }
    }
    if (input.action === 'list') {
      const extensions = this.storage()
        .prepare('SELECT * FROM studio_extensions ORDER BY id')
        .all()
        .map((value) => this.decodeRow(value).extension)
      if (!agent)
        return {
          extensions: extensions.map((entry) => projectEntry(entry, input.componentVersion)),
          allowAgentInstall: this.allowsAgentInstall(),
        }
      return {
        allowAgentInstall: !agent.readOnly && this.allowsAgentInstall(),
        extensions: extensions.map(({ id, revision, enabled, installed, draft }) => ({
          id,
          revision,
          enabled,
          name: installed?.name ?? draft?.name ?? id,
          draft: !!draft,
          tools: enabled
            ? (installed?.contributions.flatMap((entry) =>
                entry.kind === 'tool' && entry.taskId === agent.taskId
                  ? [{ id: entry.id, title: entry.title }]
                  : [],
              ) ?? [])
            : [],
        })),
      }
    }
    if (input.action === 'read') {
      if (!agent) throw new HttpError(403, 'Read extension manifests from an agent thread.')
      const saved = this.get(input.id)
      const installed =
        saved?.installedTaskId === agent.taskId ? saved?.extension.installed : undefined
      const draft = saved?.draftTaskId === agent.taskId ? saved?.extension.draft : undefined
      if (!saved || (!installed && !draft))
        throw new HttpError(404, 'This thread has no manifest for this extension.')
      return {
        id: input.id,
        revision: saved.extension.revision,
        enabled: saved.extension.enabled,
        installed,
        draft,
      }
    }
    if (input.action === 'agent-install-policy') {
      if (agent) throw new HttpError(403, 'Set agent installation from paired Studio settings.')
      this.storage()
        .prepare(
          'INSERT INTO studio_extension_preferences VALUES(1,?) ON CONFLICT(id) DO UPDATE SET agent_install=excluded.agent_install',
        )
        .run(input.enabled ? 1 : 0)
      this.generation++
      return { ok: true }
    }
    if (input.action === 'validate') {
      validate(input.manifest)
      return { ok: true }
    }
    if (input.action === 'open') {
      if (agent) throw new HttpError(403, 'Open extension views from a paired Studio client.')
      const entry = this.get(input.id)?.extension
      const contribution = entry?.installed?.contributions.find(
        (item) => item.id === input.contributionId,
      )
      if (
        !entry?.enabled ||
        !contribution ||
        contribution.kind === 'tool' ||
        isStudioDataSource(contribution)
      )
        throw new HttpError(404, 'This extension view is unavailable.')
      if (entry.revision !== input.expectedRevision)
        throw new HttpError(409, 'The extension changed. Reload it before opening the view.')
      if (contribution.kind === 'view' && (input.componentVersion ?? 0) < 3) {
        const results = extensionViewResultIds(contribution.view)
        if (
          viewNeedsVersion3(contribution) ||
          entry.installed?.contributions.some(
            (item) => isStudioDataSource(item) && results.has(item.id),
          )
        )
          throw new HttpError(409, 'Update Studio to open this extension view.')
      }
      if (
        input.automatic &&
        (contribution.kind !== 'app' ||
          !this.policies.read(entry.id, contribution.id, this.policyTarget(entry, contribution))
            .autoLoad)
      )
        throw new HttpError(403, 'Enable automatic loading for this app first.')
      return { contribution: projectContribution(contribution, input.componentVersion ?? 0) }
    }
    if (input.action === 'call') return this.call(input, authorize, agent?.taskId)
    if (input.action === 'read-data') {
      if (agent) throw new HttpError(403, 'Read extension data from a paired Studio client.')
      return this.readData(input, authorize)
    }
    if (input.action === 'pin-page') {
      if (agent) throw new HttpError(403, 'Pin extension pages from a paired Studio client.')
      return this.pinPage(input)
    }

    if (agent) {
      if (agent.readOnly || (input.action !== 'stage' && input.action !== 'install'))
        throw new HttpError(403, 'This agent cannot perform this extension action.')
      if (input.action === 'install' && !this.allowsAgentInstall())
        throw new HttpError(403, 'Agent installation is off for this computer.')
    }
    const id = input.action === 'stage' ? input.manifest.id : input.id
    const stored = this.get(id)
    const current: StudioExtensionEntry = stored?.extension ?? {
      id,
      revision: 0,
      enabled: false,
      settings: {},
      canRollback: false,
    }
    if (input.expectedRevision !== current.revision)
      throw new HttpError(409, 'The extension changed. Reload it before you continue.')
    if (!stored && input.action !== 'stage') throw new HttpError(404, 'Extension not found.')
    let next = { ...current }
    let previous = stored?.previous
    let draftTaskId = stored?.draftTaskId
    let installedTaskId = stored?.installedTaskId
    let previousTaskId = stored?.previousTaskId
    let draftRelease = stored?.draftRelease
    let installedRelease = stored?.installedRelease
    let previousRelease = stored?.previousRelease
    switch (input.action) {
      case 'stage':
        if (release && current.installed && !installedRelease)
          throw new HttpError(
            409,
            'An extension with this ID was installed outside the marketplace.',
          )
        if (release && current.draft)
          throw new HttpError(
            409,
            'Review or discard the existing draft before staging this release.',
          )
        if (agent && current.draft && draftTaskId !== agent.taskId)
          throw new HttpError(
            403,
            'A draft already belongs to another author. Ask a paired user to discard it first.',
          )
        if (
          !stored &&
          this.storage().prepare('SELECT id FROM studio_extensions LIMIT 64').all().length >= 64
        )
          throw new HttpError(409, 'This computer already has 64 extension entries.')
        validate(input.manifest)
        draftTaskId = agent?.taskId
        draftRelease = release
        next = { ...next, draft: input.manifest, error: undefined }
        break
      case 'discard':
        next.draft = undefined
        draftTaskId = undefined
        draftRelease = undefined
        if (current.installed) break
        this.storage().prepare('DELETE FROM studio_extensions WHERE id=?').run(id)
        this.generation++
        return { ok: true }
      case 'install':
        if (!current.draft) throw new HttpError(409, 'There is no draft to install.')
        if (!agent && (input.componentVersion ?? 0) < requiredComponentVersion(current.draft))
          throw new HttpError(409, 'Update Studio to review and install this extension draft.')
        if (
          agent &&
          (draftTaskId !== agent.taskId ||
            (current.installed && installedTaskId !== agent.taskId) ||
            current.draft.contributions.some(
              (item) =>
                (item.kind === 'app' || item.kind === 'tool') && item.taskId !== agent.taskId,
            ))
        )
          throw new HttpError(
            403,
            'Agents can only install their own extension drafts with sources in this thread.',
          )
        if (agent && current.draft.contributions.some((item) => item.kind === 'cli'))
          throw new HttpError(
            403,
            'This draft runs a command on this computer. A paired user must review and install it.',
          )
        previousTaskId = current.installed ? installedTaskId : undefined
        previousRelease = current.installed ? installedRelease : undefined
        installedRelease = draftRelease
        draftRelease = undefined
        installedTaskId = draftTaskId
        draftTaskId = undefined
        previous = current.installed ? { ...current, draft: undefined } : undefined
        next = {
          ...next,
          installed: current.draft,
          draft: undefined,
          enabled: current.installed ? current.enabled : true,
          settings: settingsFor(current.draft, current.settings),
        }
        break
      case 'enable':
      case 'disable':
        if (!current.installed) throw new HttpError(409, 'Install the extension first.')
        next.enabled = input.action === 'enable'
        break
      case 'rollback':
        if (!previous) throw new HttpError(409, 'There is no earlier installed version.')
        if ((input.componentVersion ?? 0) < requiredComponentVersion(previous.installed))
          throw new HttpError(409, 'Update Studio to restore this extension version.')
        next = { ...next, installed: previous.installed, settings: previous.settings }
        previous = undefined
        installedTaskId = previousTaskId
        previousTaskId = undefined
        installedRelease = previousRelease
        previousRelease = undefined
        break
      case 'settings': {
        if (!current.installed) throw new HttpError(409, 'Install the extension first.')
        const updated = { ...current.settings }
        for (const [key, value] of Object.entries(input.settings)) {
          const field = current.installed.settings?.find((entry) => entry.id === key)
          if (!field || typeof value !== typeof field.default)
            throw new HttpError(400, `Invalid extension setting: ${key}`)
          updated[key] = value
        }
        next.settings = updated
        break
      }
      case 'remove': {
        const storage = this.storage()
        storage.transaction(() => {
          storage.prepare('DELETE FROM studio_extension_page_pins WHERE extension=?').run(id)
          storage.prepare('DELETE FROM studio_extensions WHERE id=?').run(id)
          this.policies.clear(id)
        })()
        this.generation++
        this.stop(id)
        return { ok: true }
      }
    }
    next.canRollback = !!previous
    const storage = this.storage()
    storage.transaction(() => {
      if (input.action === 'install' || input.action === 'rollback') {
        const pageIds =
          next.installed?.contributions
            .filter((item) => item.kind === 'view' && item.placement === 'page')
            .map((item) => item.id) ?? []
        const slots = pageIds.map(() => '?').join(',')
        storage
          .prepare(
            `DELETE FROM studio_extension_page_pins WHERE extension=? AND page NOT IN (${slots})`,
          )
          .run(id, ...pageIds)
      }
      const allocated = storage
        .prepare(
          'UPDATE studio_extension_revision SET revision=revision+1 WHERE id=1 RETURNING revision',
        )
        .get()
      next.revision = decode(mutableStruct({ revision: Schema.Number }), allocated).revision
      storage
        .prepare(
          'INSERT INTO studio_extensions VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision, entry=excluded.entry',
        )
        .run(
          id,
          next.revision,
          JSON.stringify({
            extension: next,
            previous,
            draftTaskId,
            installedTaskId,
            previousTaskId,
            draftRelease,
            installedRelease,
            previousRelease,
          }),
        )
    })()
    this.generation++
    if (input.action !== 'stage' && input.action !== 'discard') this.stop(id)
    if (!agent)
      return {
        extension: projectEntry(next, 'componentVersion' in input ? input.componentVersion : 0),
      }
    return input.action === 'stage'
      ? { id, revision: next.revision, staged: true }
      : { id, revision: next.revision, installed: true }
  }

  /**
   * Reads one installed data source of the revision the client shows. Identical reads in flight
   * share one request. Each caller is checked when it joins and again before it receives data.
   */
  private async readData(
    input: Extract<StudioExtensionCommand, { action: 'read-data' }>,
    authorize: () => void,
  ): Promise<DataRead> {
    if (this.shutdown.signal.aborted) throw new HttpError(503, 'The runtime is stopping.')
    const entry = this.get(input.id)?.extension
    const source = entry?.installed?.contributions.find((item) => item.id === input.contributionId)
    if (!entry?.enabled || !source || !isStudioDataSource(source))
      throw new HttpError(404, 'This extension data source is unavailable.')
    authorize()
    if (entry.revision !== input.expectedRevision)
      throw new HttpError(409, 'The extension changed. Reload its data sources.')
    const interval = (source.refreshSeconds ?? 0) * 1000
    const sharedReading = input.automatic || interval
    const cwd =
      sharedReading && source.kind === 'cli'
        ? await this.dataDirectory?.(source.repositoryId, authorize)
        : undefined
    const target = sharedReading ? this.policyTarget(entry, source, cwd) : undefined
    const check = () => {
      authorize()
      if (target && !this.currentSource(input.id, source))
        throw new HttpError(409, 'The extension changed. Reload its data sources.')
      if (input.automatic && target && !this.policies.read(input.id, source.id, target).autoLoad)
        throw new HttpError(403, 'Enable automatic loading for this extension source first.')
    }
    check()
    if (input.automatic && target && interval) {
      const recent = this.recent.read(input.id, source.id, target, interval)
      if (recent) return recent
    }
    const key = JSON.stringify([input.id, dataTarget(source), !!input.automatic, target])
    let shared = this.sourceReads.get(key)
    if (shared) shared.callers.add(check)
    else {
      if (this.calls.size >= 8) throw new HttpError(429, 'The extension data source is busy.')
      shared = this.startRead(input.id, source, key, check, cwd)
    }
    try {
      const result = await shared.read
      check()
      if (!this.currentSource(input.id, source))
        throw new HttpError(409, 'The extension changed. Reload its data sources.')
      if (target && interval && this.policies.read(input.id, source.id, target).autoLoad) {
        const reading = this.recent.remember(input.id, source.id, target, interval, result)
        if (input.automatic) return reading
      }
      return result
    } catch (error) {
      // A caller without access gets its own access error, not the shared result.
      authorize()
      throw error
    } finally {
      shared.callers.delete(check)
    }
  }

  private startRead(
    id: string,
    source: DataContribution,
    key: string,
    authorize: () => void,
    cwd?: string,
  ) {
    const active: ActiveCall = { id, source, controller: new AbortController() }
    const signal = AbortSignal.any([active.controller.signal, this.shutdown.signal])
    const callers = new Set([authorize])
    // The command or request continues while at least one waiting caller keeps access.
    const check = () => {
      signal.throwIfAborted()
      let denied: unknown = new HttpError(401, 'No paired client is waiting for this data.')
      if (
        ![...callers].some((caller) => {
          try {
            caller()
            return true
          } catch (error) {
            denied = error
            return false
          }
        })
      )
        throw denied
      if (!this.currentSource(id, source))
        throw new HttpError(409, 'The extension changed. Reload its data sources.')
    }
    this.calls.add(active)
    const read = readStudioData(source, signal, check, this.dataDirectory, cwd)
      .then((data) => {
        check()
        return { data, updatedAt: Date.now() }
      })
      .finally(() => {
        this.calls.delete(active)
        this.sourceReads.delete(key)
      })
    const shared = { read, callers }
    this.sourceReads.set(key, shared)
    return shared
  }

  private async call(
    input: Extract<StudioExtensionCommand, { action: 'call' }>,
    authorize: () => void,
    taskId?: string,
  ) {
    const current = this.get(input.id)?.extension
    const target = current?.installed?.contributions.find(
      (entry) => entry.id === input.contributionId,
    )
    if (!current?.enabled || target?.kind !== 'tool')
      throw new HttpError(404, 'This extension tool is unavailable.')
    if (current.revision !== input.expectedRevision)
      throw new HttpError(409, 'The extension changed. Reload it before running the tool.')
    if (taskId && taskId !== target.taskId)
      throw new HttpError(403, 'This tool belongs to a different thread.')
    if (
      this.calls.size >= 8 ||
      [...this.calls].some((entry) => entry.id === input.id && entry.tool === target.id)
    )
      throw new HttpError(429, 'The extension is busy.')
    const active = { id: input.id, tool: target.id, controller: new AbortController() }
    const callSignal = AbortSignal.any([
      active.controller.signal,
      this.shutdown.signal,
      AbortSignal.timeout(10_000),
    ])
    const permission = () => {
      const { entry, source } = this.policySource(input.id, target.id)
      const grant = this.policies.read(input.id, target.id, this.policyTarget(entry, source))
      if (grant.access === 'off' || (input.automatic && !grant.autoLoad))
        throw new HttpError(403, 'Allow this extension to use the MCP tool first.')
      if (this.policyTarget(entry, source) !== approvedTarget)
        throw new HttpError(409, 'The MCP tool changed. Review its extension grant again.')
    }
    const approvedTarget = this.policyTarget(current, target)
    const check = () => {
      authorize()
      callSignal.throwIfAborted()
      if (taskId) this.requireActiveThread(target.taskId)
      permission()
    }
    const args = argumentsFor(target.arguments)
    for (const [key, setting] of Object.entries(target.inputs ?? {}))
      Object.defineProperty(args, key, {
        value: current.settings[setting],
        enumerable: true,
        configurable: true,
        writable: true,
      })
    this.calls.add(active)
    return new Promise<{ data: unknown }>((resolve, reject) => {
      const aborted = () =>
        reject(
          callSignal.reason instanceof HttpError
            ? callSignal.reason
            : new HttpError(504, 'The extension tool did not finish within 10 seconds.'),
        )
      callSignal.addEventListener('abort', aborted, { once: true })
      void Promise.resolve()
        .then(() => {
          check()
          return this.mcp.feedRead(
            target.taskId,
            {
              server: target.server,
              tool: target.tool,
              arguments: args,
              pointer: '',
              seconds: 60,
            },
            undefined,
            callSignal,
            check,
            !taskId,
          )
        })
        .then((result) => {
          check()
          resolve({ data: result.data })
        })
        .catch(reject)
        .finally(() => {
          // Keep the slot occupied until the upstream operation releases its resources.
          callSignal.removeEventListener('abort', aborted)
          this.calls.delete(active)
        })
    })
  }

  async dispose() {
    this.shutdown.abort(new HttpError(503, 'The runtime is stopping.'))
    await Promise.allSettled([...this.sourceReads.values()].map(({ read }) => read))
  }
}
