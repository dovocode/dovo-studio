import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  artifactFeedQuerySchema,
  artifactFeedCredentialSchema,
  artifactFeedLeaseSchema,
  artifactServiceOrigin,
  artifactReadSchema,
  mutableStruct,
  type ArtifactFeedQuery,
  type ArtifactFeedCredential,
  ACCOUNT_DIRECTORY_URL,
  artifactFeedSessionSchema,
} from '@dovo/protocol'
import type { McpApps } from '../mcp-apps/bridge.js'
import type { Artifacts } from './artifacts.js'
import type { Devices } from '../auth/devices.js'
import type { WorkspaceStore } from '../storage/workspace.js'
import { HttpError } from '../errors.js'

const configSchema = mutableStruct({
  connectOrigin: Schema.optional(Schema.String),
  ...artifactReadSchema.fields,
  query: artifactFeedQuerySchema,
  credential: artifactFeedCredentialSchema,
  fingerprint: Schema.String,
  device: Schema.String,
})
type Config = typeof configSchema.Type
type Preview = { config: Omit<Config, 'credential'>; data: unknown; expires: number }
type Reference = typeof artifactReadSchema.Type
class FeedAccessError extends HttpError {}

/** The runtime alone executes fixed, human-approved queries. Hosted viewers cannot request tools. */
export class ArtifactFeeds {
  private previews = new Map<string, Preview>()
  private previewReads = 0
  private running = new Map<
    string,
    { taskId: string; controller: AbortController; promise: Promise<void> }
  >()
  private deletingTasks = new Set<string>()
  private timer?: ReturnType<typeof setInterval>
  private closed = false
  constructor(
    private db: Database.Database,
    private artifacts: Artifacts,
    private mcp: McpApps,
    private devices: Devices,
    private workspace: WorkspaceStore,
    private enabled: () => boolean,
    private connectOrigin = () => process.env.DOVO_CONNECT_ORIGIN ?? ACCOUNT_DIRECTORY_URL,
  ) {
    db.exec(`CREATE TABLE IF NOT EXISTS artifact_feeds(publication TEXT PRIMARY KEY,task TEXT NOT NULL,
      artifact TEXT NOT NULL,revision INTEGER NOT NULL,device TEXT NOT NULL,config TEXT,next INTEGER NOT NULL,error TEXT NOT NULL);`)
  }
  private authorize(ref: Reference, device: string) {
    if (this.closed || !this.enabled())
      throw new FeedAccessError(403, 'Artifact data feeds are disabled')
    if (this.deletingTasks.has(ref.taskId))
      throw new FeedAccessError(409, 'The publisher project is being deleted')
    if (
      device !== 'owner' &&
      !this.devices.list().some((value) => value.id === device && !value.revokedAt)
    )
      throw new FeedAccessError(401, 'The approving device was revoked')
    const task = this.workspace.taskSummary(ref.taskId)
    if (task.archived || task.archivedAt)
      throw new FeedAccessError(409, 'The publisher thread was settled or archived')
    this.artifacts.read(ref.taskId, ref.id, ref.revision)
  }
  async tools(ref: Reference, device: string) {
    const authorize = () => this.authorize(ref, device)
    authorize()
    return this.mcp.feedCatalog(ref.taskId, AbortSignal.timeout(60_000), authorize)
  }
  async preview(ref: Reference, query: ArtifactFeedQuery, device: string) {
    for (const [id, preview] of this.previews)
      if (preview.expires <= Date.now()) this.previews.delete(id)
    if (this.previews.size + this.previewReads >= 32)
      throw new HttpError(429, 'Too many pending feed previews')
    const authorize = () => this.authorize(ref, device)
    authorize()
    const saved = this.artifacts.read(ref.taskId, ref.id, ref.revision)
    this.previewReads++
    try {
      const result = await this.mcp.feedRead(
        ref.taskId,
        query,
        undefined,
        AbortSignal.timeout(30_000),
        authorize,
      )
      const previewId = randomUUID()
      this.previews.set(previewId, {
        config: {
          connectOrigin: this.connectOrigin(),
          ...ref,
          revision: saved.revision,
          query,
          device,
          fingerprint: result.fingerprint,
        },
        data: result.data,
        expires: Date.now() + 600_000,
      })
      return { previewId, data: result.data, connectOrigin: this.connectOrigin() }
    } finally {
      this.previewReads--
    }
  }
  private async host(
    credential: ArtifactFeedCredential,
    action: 'lease' | 'data',
    signal: AbortSignal,
    data?: unknown,
  ) {
    const origin = artifactServiceOrigin(credential.origin)
    const response = await fetch(
      `${origin}/v1/publications/${credential.publicationId}/feed/${action}`,
      {
        method: action === 'lease' ? 'GET' : 'PUT',
        redirect: 'error',
        credentials: 'omit',
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        headers: {
          Authorization: 'Bearer ' + credential.token,
          ...(action === 'data' ? { 'Content-Type': 'application/json' } : {}),
        },
        body:
          action === 'data'
            ? JSON.stringify({ generation: credential.generation, data })
            : undefined,
      },
    )
    if (!response.ok)
      throw new FeedAccessError(
        response.status,
        'Hosted data feed access is unavailable or revoked',
      )
    return (await response.json()) as unknown
  }
  private async lease(config: Config, signal: AbortSignal) {
    const origin = config.connectOrigin ?? process.env.DOVO_CONNECT_ORIGIN ?? ACCOUNT_DIRECTORY_URL
    if (origin !== this.connectOrigin())
      throw new FeedAccessError(409, 'Connect URL changed. Preview and approve this feed again.')
    if (config.credential.connectOrigin && config.credential.connectOrigin !== origin)
      throw new FeedAccessError(
        409,
        'This computer uses a different Connect URL. Configure matching services and approve again.',
      )
    if (config.credential.expiresAt <= Date.now())
      throw new FeedAccessError(401, 'Feed account session expired')
    // Validate the destination with the runtime's trusted broker before sending a token there.
    const response = await fetch(artifactServiceOrigin(origin) + '/v1/artifacts/feed-session', {
      headers: { Authorization: 'Bearer ' + config.credential.token },
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
    })
    if (!response.ok)
      throw new FeedAccessError(
        response.status,
        'Feed account permission is unavailable or revoked',
      )
    const identity = decode(artifactFeedSessionSchema, await response.json())
    if (
      identity.audience !== config.credential.origin ||
      identity.publicationId !== config.credential.publicationId ||
      identity.expiresAt !== config.credential.expiresAt
    )
      throw new FeedAccessError(401, 'Feed destination or permission changed')
    const lease = decode(
      artifactFeedLeaseSchema,
      await this.host(config.credential, 'lease', signal),
    )
    if (
      lease.sourceId !== config.id ||
      lease.revision !== config.revision ||
      lease.generation !== config.credential.generation ||
      lease.seconds !== config.query.seconds ||
      lease.expiresAt > config.credential.expiresAt ||
      lease.expiresAt <= Date.now()
    )
      throw new FeedAccessError(409, 'Hosted feed no longer matches the approved publication')
  }
  async enable(previewId: string, credential: ArtifactFeedCredential, device: string) {
    const preview = this.previews.get(previewId)
    if (!preview || preview.expires <= Date.now() || preview.config.device !== device)
      throw new HttpError(409, 'Preview expired or belongs to another device')
    const config: Config = {
      ...preview.config,
      credential: decode(artifactFeedCredentialSchema, credential),
    }
    if (this.deletingTasks.has(config.taskId))
      throw new FeedAccessError(409, 'The publisher project is being deleted')
    const capacity = () => {
      if (
        decode(
          mutableStruct({ n: Schema.Number }),
          this.db
            .prepare(
              'SELECT count(*) AS n FROM artifact_feeds WHERE config IS NOT NULL AND publication<>?',
            )
            .get(credential.publicationId),
        ).n >= 16
      )
        throw new HttpError(429, 'At most 16 live artifact feeds per runtime')
    }
    capacity()
    const authorize = () => this.authorize(config, device)
    authorize()
    const signal = AbortSignal.timeout(30_000)
    await this.lease(config, signal)
    await this.mcp.feedCheck(config.taskId, config.query, config.fingerprint, signal, authorize)
    authorize()
    capacity()
    this.running.get(credential.publicationId)?.controller.abort()
    this.db
      .prepare('INSERT OR REPLACE INTO artifact_feeds VALUES(?,?,?,?,?,?,?,?)')
      .run(
        credential.publicationId,
        config.taskId,
        config.id,
        config.revision ?? 0,
        device,
        JSON.stringify(config),
        Date.now() + config.query.seconds * 1000,
        '',
      )
    this.previews.delete(previewId)
    return { enabled: true, error: '' }
  }
  async encryptedPreview(previewId: string, device: string) {
    const preview = this.previews.get(previewId)
    if (!preview || preview.expires <= Date.now() || preview.config.device !== device)
      throw new HttpError(409, 'Preview expired or belongs to another device')
    const config = preview.config
    const authorize = () => this.authorize(config, device)
    authorize()
    await this.mcp.feedCheck(
      config.taskId,
      config.query,
      config.fingerprint,
      AbortSignal.timeout(30000),
      authorize,
    )
    authorize()
    return { ...config, data: preview.data }
  }
  status(ref: Reference, publicationId: string, device: string) {
    this.authorize(ref, device)
    const row = decode(
      Schema.UndefinedOr(
        mutableStruct({ config: Schema.NullOr(Schema.String), error: Schema.String }),
      ),
      this.db
        .prepare(
          'SELECT config,error FROM artifact_feeds WHERE publication=? AND task=? AND artifact=?',
        )
        .get(publicationId, ref.taskId, ref.id),
    )
    const config = row?.config ? decode(configSchema, JSON.parse(row.config)) : undefined
    return { enabled: !!config, error: row?.error ?? '', generation: config?.credential.generation }
  }
  stop(ref: Reference, publicationId: string, device: string) {
    this.authorize(ref, device)
    const row = decode(
      Schema.UndefinedOr(mutableStruct({ device: Schema.String })),
      this.db
        .prepare('SELECT device FROM artifact_feeds WHERE publication=? AND task=? AND artifact=?')
        .get(publicationId, ref.taskId, ref.id),
    )
    if (row && device !== 'owner' && row.device !== device)
      throw new HttpError(403, 'Only the approving device or runtime owner can stop this feed')
    if (row) this.running.get(publicationId)?.controller.abort()
    this.db
      .prepare(
        'UPDATE artifact_feeds SET config=NULL,error=? WHERE publication=? AND task=? AND artifact=?',
      )
      .run('Stopped on publisher runtime', publicationId, ref.taskId, ref.id)
    return { enabled: false, error: '' }
  }
  start() {
    this.timer ??= setInterval(() => {
      this.tick()
    }, 5000)
    this.timer.unref()
  }
  tick() {
    if (this.closed) return
    const rows = this.db
      .prepare(
        'SELECT publication,task,config FROM artifact_feeds WHERE config IS NOT NULL AND next<=? ORDER BY next LIMIT 16',
      )
      .all(Date.now())
      .map((row) =>
        decode(
          mutableStruct({ publication: Schema.String, task: Schema.String, config: Schema.String }),
          row,
        ),
      )
    for (const row of rows) {
      if (this.running.size >= 2) break
      if (
        typeof row.publication !== 'string' ||
        typeof row.config !== 'string' ||
        this.deletingTasks.has(row.task) ||
        this.running.has(row.publication)
      )
        continue
      const id = row.publication,
        input = row.config,
        controller = new AbortController()
      const promise = this.refresh(id, input, controller.signal).finally(() =>
        this.running.delete(id),
      )
      this.running.set(id, { taskId: row.task, controller, promise })
    }
  }
  /** Stops local writers for deleted task histories; hosted publication copies remain independent. */
  async stopTasks(taskIds: readonly string[]) {
    const ids = new Set(taskIds)
    if (!ids.size) return
    for (const id of ids) this.deletingTasks.add(id)
    const running = [...this.running.values()].filter((entry) => ids.has(entry.taskId))
    for (const entry of running) entry.controller.abort()
    await Promise.allSettled(running.map((entry) => entry.promise))
    this.previews.forEach((preview, id) => {
      if (ids.has(preview.config.taskId)) this.previews.delete(id)
    })
    const placeholders = [...ids].map(() => '?').join(',')
    this.db.prepare(`DELETE FROM artifact_feeds WHERE task IN (${placeholders})`).run(...ids)
  }
  releaseTasks(taskIds: readonly string[]) {
    for (const id of taskIds) this.deletingTasks.delete(id)
  }
  private async refresh(id: string, input: string, signal: AbortSignal) {
    let seconds = 60
    try {
      const config = decode(configSchema, JSON.parse(input)),
        authorize = () => this.authorize(config, config.device)
      seconds = config.query.seconds
      authorize()
      await this.lease(config, signal)
      authorize()
      const result = await this.mcp.feedRead(
        config.taskId,
        config.query,
        config.fingerprint,
        signal,
        authorize,
      )
      authorize()
      signal.throwIfAborted()
      await this.host(config.credential, 'data', signal, result.data)
      this.db
        .prepare('UPDATE artifact_feeds SET next=?,error=? WHERE publication=? AND config=?')
        .run(Date.now() + seconds * 1000, '', id, input)
    } catch (error) {
      if (signal.aborted || this.closed) return
      const fatal =
        error instanceof HttpError && [400, 401, 403, 404, 409, 413].includes(error.status)
      this.db
        .prepare(
          'UPDATE artifact_feeds SET next=?,error=?,config=CASE WHEN ? THEN NULL ELSE config END WHERE publication=? AND config=?',
        )
        .run(
          Date.now() + seconds * 1000,
          fatal
            ? 'Feed stopped. Check permissions, preview and approve again'
            : 'Refresh failed; the last successful value is kept',
          fatal ? 1 : 0,
          id,
          input,
        )
    }
  }
  async dispose() {
    this.closed = true
    clearInterval(this.timer)
    for (const running of this.running.values()) running.controller.abort()
    await Promise.allSettled([...this.running.values()].map((value) => value.promise))
    this.previews.clear()
  }
}
