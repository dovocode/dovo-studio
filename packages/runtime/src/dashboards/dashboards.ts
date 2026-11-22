import { createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  ARTIFACT_FEED_MAX_BYTES,
  artifactFeedSelect,
  dashboardSchema,
  decode,
  mutableStruct,
  type Dashboard,
  type DashboardTile,
  type TaskSummary,
} from '@dovo/protocol'
import type { McpApps } from '../mcp-apps/bridge.js'
import { HttpError, errorMessage } from '../errors.js'

/** Dashboards per runtime. Each one holds at most 32 tiles. */
const MAX_DASHBOARDS = 64
/** Concurrent tile reads across all clients, so dashboards cannot exhaust MCP sessions. */
const MAX_READS = 16
/** Raw API response bytes. The selected value must still fit the feed limit. */
const MAX_RESPONSE_BYTES = 1024 * 1024
const API_TIMEOUT_MS = 15_000
const MCP_TIMEOUT_MS = 30_000
const POINTER = /^(?:\/(?:[^~]|~[01])*)+$/

const rowSchema = mutableStruct({ definition: Schema.String })
type DataTile = Extract<DashboardTile, { kind: 'api' | 'mcp' }>
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
      ? `${tile.title}: choose a project, or No Project to start in the home folder`
      : undefined
  if (tile.kind === 'pipelines')
    return empty(tile.repositoryId) ? `${tile.title}: choose a project` : undefined
  if (tile.kind === 'terminal')
    return empty(tile.terminalId) ? `${tile.title}: choose a terminal` : undefined
  if (tile.kind === 'app')
    return empty(tile.taskId) || empty(tile.appId)
      ? `${tile.title}: choose a thread and its MCP App`
      : undefined
  if (tile.kind !== 'api' && tile.kind !== 'mcp') return
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

function select(value: unknown, pointer: string) {
  let data: unknown
  try {
    data = artifactFeedSelect(value, pointer)
  } catch (error) {
    throw new HttpError(422, errorMessage(error))
  }
  const encoded = JSON.stringify(data)
  if (encoded === undefined || Buffer.byteLength(encoded) > ARTIFACT_FEED_MAX_BYTES)
    throw new HttpError(413, 'Select a JSON field smaller than 256 KB')
  return JSON.parse(encoded) as unknown
}

/** Fetches exactly the saved URL. No redirects, cookies or dashboard-provided headers. */
async function readApi(url: string, signal: AbortSignal) {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'error',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.any([signal, AbortSignal.timeout(API_TIMEOUT_MS)]),
    })
  } catch (error) {
    signal.throwIfAborted()
    throw new HttpError(
      502,
      error instanceof Error && error.name === 'TimeoutError'
        ? 'The API did not answer within 15 seconds'
        : 'The API request failed. Redirects are not followed.',
    )
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new HttpError(502, `The API answered with HTTP ${response.status}`)
  }
  if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel()
    throw new HttpError(413, 'The API response is larger than 1 MB')
  }
  const chunks: Uint8Array[] = []
  const reader = response.body?.getReader()
  let size = 0
  try {
    for (;;) {
      if (!reader) break
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_RESPONSE_BYTES)
        throw new HttpError(413, 'The API response is larger than 1 MB')
      chunks.push(value)
    }
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof HttpError) throw error
    throw new HttpError(502, 'The API response stopped before it was complete')
  } finally {
    await reader?.cancel().catch(() => undefined)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

/** Dashboard definitions belong to this runtime. They do not depend on threads. */
export class Dashboards {
  private readonly shutdown = new AbortController()
  private readonly reads = new Map<string, Promise<DashboardTileRead>>()
  constructor(
    private db: Database.Database,
    private mcp: Pick<McpApps, 'feedRead'>,
    private store: { taskSummary(id: string): Pick<TaskSummary, 'archived' | 'archivedAt'> },
  ) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS dashboards(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,definition TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS dashboard_sessions(dashboard TEXT NOT NULL,tile TEXT NOT NULL,
        fingerprint TEXT NOT NULL,terminal TEXT NOT NULL,PRIMARY KEY(dashboard,tile));`,
    )
  }
  list(): Dashboard[] {
    // Updates keep the rowid, so dashboards stay in creation order.
    return this.db
      .prepare('SELECT definition FROM dashboards ORDER BY rowid')
      .all()
      .map((row) => decode(dashboardSchema, JSON.parse(decode(rowSchema, row).definition)))
  }
  get(id: string): Dashboard | undefined {
    const row = this.db.prepare('SELECT definition FROM dashboards WHERE id=?').get(id)
    return row ? decode(dashboardSchema, JSON.parse(decode(rowSchema, row).definition)) : undefined
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
    })()
  }
  tile(id: string, tileId: string) {
    const dashboard = this.get(id)
    if (!dashboard) throw new HttpError(404, 'Dashboard not found')
    const tile = dashboard.tiles.find((entry) => entry.id === tileId)
    if (!tile) throw new HttpError(404, 'Dashboard tile not found')
    return { dashboard, tile }
  }
  /**
   * Reads one API or MCP tile of the revision the client shows. Identical reads in flight share
   * one request, and each caller is checked again before it receives the shared result.
   */
  async read(
    id: string,
    tileId: string,
    expectedRevision: number,
    authorize: () => void,
  ): Promise<DashboardTileRead> {
    if (this.shutdown.signal.aborted) throw new HttpError(503, 'The runtime is stopping')
    const { dashboard, tile } = this.current(id, tileId, expectedRevision)
    if (tile.kind !== 'api' && tile.kind !== 'mcp')
      throw new HttpError(400, 'Only API and MCP tiles have data to read')
    const check = () => this.access(dashboard, tile, authorize)
    check()
    const key = JSON.stringify([id, tileId, dashboard.revision])
    let read = this.reads.get(key)
    if (!read) {
      if (this.reads.size >= MAX_READS)
        throw new HttpError(429, 'Too many dashboard reads are running. Try again soon.')
      read = this.perform(dashboard, tile, check).finally(() => this.reads.delete(key))
      this.reads.set(key, read)
    }
    const result = await read
    // Every caller, including one that joined a shared read, is checked again before it receives
    // the result: its device, the revision it shows, and the MCP thread.
    check()
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
  private async perform(dashboard: Dashboard, tile: DataTile, authorize: () => void) {
    const signal = this.shutdown.signal
    const data =
      tile.kind === 'api'
        ? select(await readApi(tile.url, signal), tile.pointer)
        : await this.readMcp(tile, signal, authorize)
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
