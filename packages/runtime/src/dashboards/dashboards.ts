import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  isStudioDataSource,
  studioDataSourceIssue,
  dashboardSchema,
  decode,
  mutableStruct,
  type Dashboard,
  type DashboardTile,
  type TaskSummary,
  type StudioSourcePolicyRequest,
} from '@dovo/protocol'
import type { McpApps } from '../mcp-apps/bridge.js'
import { HttpError } from '../errors.js'
import { readStudioData, type DataSourceDirectory } from './data-sources.js'
import { SourcePolicies, sourcePolicyTarget } from '../studio/source-policies.js'
import { RecentSourceReadings } from '../studio/recent-source-readings.js'

/** Dashboards per runtime. Each one holds at most 32 tiles. */
const MAX_DASHBOARDS = 64
/** Concurrent tile reads across all clients, so dashboards cannot exhaust MCP sessions. */
const MAX_READS = 16
const MCP_TIMEOUT_MS = 30_000
const POINTER = /^(?:\/(?:[^~]|~[01])*)+$/

const rowSchema = mutableStruct({
  id: Schema.String,
  revision: Schema.Number,
  definition: Schema.String,
})
type DataTile = Extract<DashboardTile, { kind: 'api' | 'cli' | 'mcp' }>
export type SessionTile = Extract<DashboardTile, { kind: 'command' | 'tui' }>
const sessionSchema = mutableStruct({ fingerprint: Schema.String, terminal: Schema.String })
const sessionFingerprint = (tile: SessionTile) =>
  createHash('sha256')
    .update(JSON.stringify([tile.kind, tile.repositoryId, tile.command]))
    .digest('hex')
export type DashboardTileRead = { data: unknown; updatedAt: number }

/** Saved tiles must name their target. Exported templates may leave these empty. */
function tileIssue(tile: DashboardTile) {
  const empty = (value: string) => !value.trim()
  if (tile.kind === 'command' || tile.kind === 'tui')
    return empty(tile.repositoryId)
      ? `${tile.title}: choose a project or the home folder`
      : undefined
  if (tile.kind === 'pipelines')
    return empty(tile.repositoryId) ? `${tile.title}: choose a project` : undefined
  if (tile.kind === 'terminal')
    return empty(tile.terminalId) ? `${tile.title}: choose a terminal` : undefined
  if (tile.kind === 'app')
    return empty(tile.taskId) || empty(tile.appId)
      ? `${tile.title}: choose a thread and its MCP App`
      : undefined
  if (isStudioDataSource(tile)) {
    const issue = studioDataSourceIssue(tile)
    return issue && `${tile.title}: ${issue}`
  }
  if (tile.kind !== 'mcp') return
  if (tile.pointer && !POINTER.test(tile.pointer))
    return `${tile.title}: use an RFC 6901 JSON pointer, or leave it empty for the whole value`
  if (tile.kind === 'mcp') {
    if (empty(tile.taskId) || empty(tile.server) || empty(tile.tool))
      return `${tile.title}: choose a thread, MCP server and tool`
    try {
      mcpArguments(tile)
    } catch {
      return `${tile.title}: MCP arguments must be a JSON object`
    }
  }
}

function mcpArguments(tile: Extract<DashboardTile, { kind: 'mcp' }>) {
  const value: unknown = tile.arguments.trim() ? JSON.parse(tile.arguments) : {}
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new HttpError(400, 'MCP arguments must be a JSON object')
  return decode(Schema.Record(Schema.String, Schema.Unknown), value)
}

/** Dashboard definitions belong to this runtime. They do not depend on threads. */
export class Dashboards {
  private readonly shutdown = new AbortController()
  private readonly reads = new Map<string, Promise<DashboardTileRead>>()
  private readonly policies: SourcePolicies
  private readonly recent = new RecentSourceReadings()
  constructor(
    private db: Database.Database,
    private mcp: Pick<McpApps, 'feedRead'> & Partial<Pick<McpApps, 'extensionSourceIdentity'>>,
    private store: { taskSummary(id: string): Pick<TaskSummary, 'archived' | 'archivedAt'> },
    private directory?: DataSourceDirectory,
  ) {
    this.policies = new SourcePolicies(db, 'dashboard')
    db.exec(
      `CREATE TABLE IF NOT EXISTS dashboards(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,definition TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dashboard_save_receipts(
        request_id TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,definition TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dashboard_sessions(dashboard TEXT NOT NULL,tile TEXT NOT NULL,
        fingerprint TEXT NOT NULL,terminal TEXT NOT NULL,PRIMARY KEY(dashboard,tile));`,
    )
  }
  /** Omits a saved dashboard this runtime cannot read, so one bad row does not hide the rest. */
  list(): Dashboard[] {
    // Updates keep the rowid, so dashboards stay in creation order.
    return this.db
      .prepare('SELECT id,revision,definition FROM dashboards ORDER BY rowid')
      .all()
      .flatMap((row) => this.definition(row) ?? [])
  }
  /**
   * An unreadable dashboard is a conflict, not a missing one. Save and delete then cannot replace
   * or remove a definition that nobody could review, and a delete does not report false success.
   */
  get(id: string): Dashboard | undefined {
    const row = this.db.prepare('SELECT id,revision,definition FROM dashboards WHERE id=?').get(id)
    if (!row) return undefined
    const dashboard = this.definition(row)
    if (!dashboard)
      throw new HttpError(
        409,
        'This computer cannot read this dashboard. Update Studio on that computer to open or change it.',
      )
    return dashboard
  }
  private definition(value: unknown) {
    try {
      const row = decode(rowSchema, value)
      const dashboard = decode(dashboardSchema, JSON.parse(row.definition))
      return dashboard.id === row.id && dashboard.revision === row.revision ? dashboard : undefined
    } catch {
      return undefined
    }
  }
  saveOnce(requestId: string, input: unknown, save: () => Dashboard): Dashboard {
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    return this.db
      .transaction(() => {
        const receipt = this.db
          .prepare('SELECT fingerprint,definition FROM dashboard_save_receipts WHERE request_id=?')
          .get(requestId)
        if (receipt) {
          const saved = decode(
            mutableStruct({ fingerprint: Schema.String, definition: Schema.String }),
            receipt,
          )
          if (saved.fingerprint !== fingerprint)
            throw new HttpError(409, 'This dashboard request ID belongs to a different save.')
          return decode(dashboardSchema, JSON.parse(saved.definition))
        }
        const saved = save()
        this.db
          .prepare(
            'INSERT INTO dashboard_save_receipts(request_id,fingerprint,definition) VALUES(?,?,?)',
          )
          .run(requestId, fingerprint, JSON.stringify(saved))
        return saved
      })
      .immediate()
  }

  /** Creates with expected revision 0. Updates must name the revision the client edited. */
  save(input: Dashboard, expectedRevision: number): Dashboard {
    const issues = input.tiles.map(tileIssue).filter((issue) => issue !== undefined)
    if (issues.length) throw new HttpError(400, issues.join('\n'))
    return this.db.transaction(() => {
      const current = this.get(input.id)
      if (!current && expectedRevision !== 0)
        throw new HttpError(
          409,
          'This dashboard was deleted on its computer. Keep your draft and save it as a new dashboard.',
        )
      if (current && current.revision !== expectedRevision)
        throw new HttpError(
          409,
          'This dashboard changed on its computer. Reload it and apply your changes again.',
        )
      if (
        !current &&
        decode(
          mutableStruct({ n: Schema.Number }),
          this.db.prepare('SELECT count(*) AS n FROM dashboards').get(),
        ).n >= MAX_DASHBOARDS
      )
        throw new HttpError(409, `A computer can keep at most ${MAX_DASHBOARDS} dashboards`)
      const saved = decode(dashboardSchema, { ...input, revision: expectedRevision + 1 })
      if (current)
        this.db
          .prepare('UPDATE dashboards SET revision=?,definition=? WHERE id=?')
          .run(saved.revision, JSON.stringify(saved), saved.id)
      else
        this.db
          .prepare('INSERT INTO dashboards(id,revision,definition) VALUES(?,?,?)')
          .run(saved.id, saved.revision, JSON.stringify(saved))
      return saved
    })()
  }
  /** Deleting a missing dashboard succeeds, so a retry after a lost response is safe. */
  delete(id: string, expectedRevision: number) {
    const current = this.get(id)
    if (!current) return
    if (current.revision !== expectedRevision)
      throw new HttpError(
        409,
        'This dashboard changed on its computer. Reload it before you delete it.',
      )
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM dashboards WHERE id=? AND revision=?').run(id, expectedRevision)
      this.db.prepare('DELETE FROM dashboard_sessions WHERE dashboard=?').run(id)
      this.policies.clear(id)
    })()
  }

  private async policyTarget(tile: DataTile, authorize: () => void) {
    const cwd =
      tile.kind === 'cli' ? await this.directory?.(tile.repositoryId, authorize) : undefined
    return { cwd, target: this.policyFingerprint(tile, cwd) }
  }

  private policyFingerprint(tile: DataTile, cwd?: string) {
    const server =
      tile.kind === 'mcp' ? this.mcp.extensionSourceIdentity?.(tile.taskId, tile.server) : undefined
    return sourcePolicyTarget([tile, cwd, server])
  }

  async sourcePolicy(input: StudioSourcePolicyRequest, authorize: () => void) {
    const { tile } = this.current(input.id, input.sourceId, input.expectedRevision)
    if (!isStudioDataSource(tile) && tile.kind !== 'mcp')
      throw new HttpError(400, 'This tile has no data source')
    if (input.policy?.access === 'off') {
      authorize()
      this.policies.clear(input.id, input.sourceId)
      this.recent.clear(input.id, input.sourceId)
      return { access: 'off' as const, autoLoad: false }
    }
    const { target } = await this.policyTarget(tile, authorize)
    authorize()
    this.current(input.id, input.sourceId, input.expectedRevision)
    if (input.policy) this.recent.clear(input.id, input.sourceId)
    return input.policy
      ? this.policies.save(input.id, input.sourceId, target, input.policy)
      : this.policies.read(input.id, input.sourceId, target)
  }
  tile(id: string, tileId: string) {
    const dashboard = this.get(id)
    if (!dashboard) throw new HttpError(404, 'Dashboard not found')
    const tile = dashboard.tiles.find((entry) => entry.id === tileId)
    if (!tile) throw new HttpError(404, 'Dashboard tile not found')
    return { dashboard, tile }
  }
  /**
   * Reads one data tile of the revision the client shows. Identical reads in flight share
   * one request, and each caller is checked again before it receives the shared result.
   */
  async read(
    id: string,
    tileId: string,
    expectedRevision: number,
    authorize: () => void,
    command = false,
    automatic = false,
  ): Promise<DashboardTileRead> {
    if (this.shutdown.signal.aborted) throw new HttpError(503, 'The runtime is stopping')
    const { dashboard, tile } = this.current(id, tileId, expectedRevision)
    if (!isStudioDataSource(tile) && tile.kind !== 'mcp')
      throw new HttpError(400, 'This tile has no data source')
    if (command !== (tile.kind === 'cli'))
      throw new HttpError(400, 'Use the read operation for the saved source type')
    const interval = isStudioDataSource(tile) ? (tile.refreshSeconds ?? 0) * 1000 : 0
    const configured = automatic || interval ? await this.policyTarget(tile, authorize) : undefined
    const check = () => {
      this.access(dashboard, tile, authorize)
      if (
        automatic &&
        configured &&
        (this.policyFingerprint(tile, configured.cwd) !== configured.target ||
          !this.policies.read(id, tileId, configured.target).autoLoad)
      )
        throw new HttpError(403, 'Enable automatic loading for this dashboard source first')
    }
    check()
    if (automatic && configured && interval) {
      const recent = this.recent.read(id, tileId, configured.target, interval)
      if (recent) return recent
    }
    const key = JSON.stringify([id, tileId, dashboard.revision, automatic, configured?.target])
    let read = this.reads.get(key)
    if (!read) {
      if (this.reads.size >= MAX_READS)
        throw new HttpError(429, 'Too many dashboard reads are running. Try again soon.')
      read = this.perform(dashboard, tile, check, configured?.cwd).finally(() =>
        this.reads.delete(key),
      )
      this.reads.set(key, read)
    }
    const result = await read
    // Every caller, including one that joined a shared read, is checked again before it receives
    // the result: its device, the revision it shows, and the MCP thread.
    check()
    if (configured && interval && this.policies.read(id, tileId, configured.target).autoLoad) {
      const reading = this.recent.remember(id, tileId, configured.target, interval, result)
      if (automatic) return reading
    }
    return result
  }
  private access(dashboard: Dashboard, tile: DataTile, authorize: () => void) {
    authorize()
    this.current(dashboard.id, tile.id, dashboard.revision)
    if (tile.kind !== 'mcp') return
    const task = this.store.taskSummary(tile.taskId)
    if (task.archived || task.archivedAt)
      throw new HttpError(409, 'Restore the thread that provides this MCP server')
  }
  /** The tile as the client last saw it. Any later edit to the dashboard is a conflict. */
  current(id: string, tileId: string, expectedRevision: number) {
    const found = this.tile(id, tileId)
    if (found.dashboard.revision !== expectedRevision)
      throw new HttpError(409, 'This dashboard changed. Reload it and try again.')
    return found
  }
  /** Remembers the latest terminal a person started for this exact command or TUI definition. */
  recordSession(id: string, tile: SessionTile, terminalId: string) {
    // A dashboard or tile deleted or changed during the launch keeps no session row. The
    // terminal stays in the terminal list like any other standalone terminal.
    const saved = this.get(id)?.tiles.find((entry) => entry.id === tile.id)
    if (
      (saved?.kind !== 'command' && saved?.kind !== 'tui') ||
      sessionFingerprint(saved) !== sessionFingerprint(tile)
    )
      return
    this.db
      .prepare(
        'INSERT INTO dashboard_sessions(dashboard,tile,fingerprint,terminal) VALUES(?,?,?,?) ON CONFLICT(dashboard,tile) DO UPDATE SET fingerprint=excluded.fingerprint,terminal=excluded.terminal',
      )
      .run(id, tile.id, sessionFingerprint(tile), terminalId)
  }
  /** A session started from an earlier command, project or kind does not belong to this tile. */
  session(id: string, tile: SessionTile) {
    const row = this.db
      .prepare('SELECT fingerprint,terminal FROM dashboard_sessions WHERE dashboard=? AND tile=?')
      .get(id, tile.id)
    if (!row) return undefined
    const session = decode(sessionSchema, row)
    return session.fingerprint === sessionFingerprint(tile) ? session.terminal : undefined
  }
  private async perform(dashboard: Dashboard, tile: DataTile, authorize: () => void, cwd?: string) {
    const signal = this.shutdown.signal
    const data =
      tile.kind === 'mcp'
        ? await this.readMcp(tile, signal, authorize)
        : await readStudioData(tile, signal, authorize, this.directory, cwd)
    // A definition edited or deleted during the read must not show stale data as current.
    if (this.get(dashboard.id)?.revision !== dashboard.revision)
      throw new HttpError(409, 'This dashboard changed during the read. Reload it.')
    authorize()
    return { data, updatedAt: Date.now() }
  }
  private async readMcp(
    tile: Extract<DashboardTile, { kind: 'mcp' }>,
    signal: AbortSignal,
    authorize: () => void,
  ) {
    authorize()
    // The bridge accepts only tools declared read-only and non-destructive, validates the
    // arguments against the tool schema and rechecks the thread's MCP scope after the call.
    const { data } = await this.mcp.feedRead(
      tile.taskId,
      {
        server: tile.server,
        tool: tile.tool,
        arguments: mcpArguments(tile),
        pointer: tile.pointer,
        // The bridge ignores the hosted feed interval for a direct read.
        seconds: 60,
      },
      undefined,
      AbortSignal.any([signal, AbortSignal.timeout(MCP_TIMEOUT_MS)]),
      authorize,
    )
    return data
  }
  async dispose() {
    this.shutdown.abort(new HttpError(503, 'The runtime is stopping'))
    await Promise.allSettled(this.reads.values())
  }
}
