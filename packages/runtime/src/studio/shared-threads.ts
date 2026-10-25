import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  artifactServiceOrigin,
  sharingWriterConfigSchema,
  sharedThreadContent,
  encryptSharedContent,
  sharingHash,
  artifactPublicationInput,
  artifactFeedQuerySchema,
  type SharingWriterConfig,
} from '@dovo/protocol'
import type { WorkspaceStore } from '../storage/workspace.js'
import type { Devices } from '../auth/devices.js'
import { HttpError } from '../errors.js'
import type { Artifacts } from '../artifacts/artifacts.js'
import type { ArtifactFeeds } from '../artifacts/feeds.js'
import type { McpApps } from '../mcp-apps/bridge.js'

const feedSchema = mutableStruct({
  artifactId: Schema.String,
  revision: Schema.Number,
  query: artifactFeedQuerySchema,
  fingerprint: Schema.String,
})
const configSchema = mutableStruct({
  ...sharingWriterConfigSchema.fields,
  feed: Schema.optional(feedSchema),
})

/** Outbound, publication-scoped writers survive closing Studio. No reader can reach a runtime. */
export class SharedThreads {
  private timer?: ReturnType<typeof setInterval>
  private running = new Map<string, AbortController>()
  private pending = new Set<Promise<void>>()
  private closed = false
  constructor(
    private db: Database.Database,
    private store: WorkspaceStore,
    private devices: Devices,
    private artifacts: Artifacts,
    private feeds: () => ArtifactFeeds,
    private mcp: McpApps,
    private artifactsEnabled: () => boolean,
  ) {
    db.exec(
      `CREATE TABLE IF NOT EXISTS shared_thread_writers(id TEXT PRIMARY KEY,task TEXT NOT NULL,device TEXT NOT NULL,config TEXT,fingerprint TEXT NOT NULL,error TEXT NOT NULL);`,
    )
  }
  preview(taskId: string) {
    return sharedThreadContent(this.store.task(taskId))
  }
  private authorize(taskId: string, device: string) {
    if (
      device !== 'owner' &&
      !this.devices.list().some((value) => value.id === device && !value.revokedAt)
    )
      throw new HttpError(401, 'Approving device was revoked')
    const task = this.store.taskSummary(taskId)
    if (task.archived || task.archivedAt)
      throw new HttpError(409, 'Restore this thread before enabling updates')
  }
  async enable(input: SharingWriterConfig, device: string, feed?: typeof feedSchema.Type) {
    const config = decode(configSchema, { ...input, feed })
    config.origin = artifactServiceOrigin(config.origin)
    this.authorize(config.taskId, device)
    if (
      decode(
        mutableStruct({ n: Schema.Number }),
        this.db
          .prepare(
            'SELECT count(*) AS n FROM shared_thread_writers WHERE config IS NOT NULL AND id<>?',
          )
          .get(config.id),
      ).n >= 16
    )
      throw new HttpError(429, 'At most 16 threads can be shared live per computer')
    const result = await this.host(config, 'GET', AbortSignal.timeout(15000))
    const head = decode(
      mutableStruct({ generation: Schema.String, version: Schema.Number }),
      result,
    )
    if (head.generation !== config.generation)
      throw new HttpError(409, 'Sharing keys changed. Refresh and resume again')
    this.authorize(config.taskId, device)
    this.running.get(config.id)?.abort()
    this.db
      .prepare(
        'INSERT INTO shared_thread_writers VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET task=excluded.task,device=excluded.device,config=excluded.config,fingerprint=excluded.fingerprint,error=excluded.error',
      )
      .run(config.id, config.taskId, device, JSON.stringify(config), '', '')
    void this.tick()
    return { enabled: true, error: '' }
  }
  async enableFeed(previewId: string, input: SharingWriterConfig, device: string) {
    const preview = await this.feeds().encryptedPreview(previewId, device)
    if (preview.taskId !== input.taskId || preview.revision === undefined)
      throw new HttpError(409, 'Preview belongs to another artifact')
    return this.enable(input, device, {
      artifactId: preview.id,
      revision: preview.revision,
      query: preview.query,
      fingerprint: preview.fingerprint,
    })
  }
  status(taskId: string, id: string) {
    this.store.taskSummary(taskId)
    const row = decode(
      Schema.UndefinedOr(
        mutableStruct({ config: Schema.NullOr(Schema.String), error: Schema.String }),
      ),
      this.db
        .prepare('SELECT config,error FROM shared_thread_writers WHERE id=? AND task=?')
        .get(id, taskId),
    )
    return {
      enabled: typeof row?.config === 'string',
      error: typeof row?.error === 'string' ? row.error : '',
    }
  }
  stop(taskId: string, id: string) {
    this.store.taskSummary(taskId)
    const row = this.db
      .prepare('SELECT id FROM shared_thread_writers WHERE id=? AND task=?')
      .get(id, taskId)
    if (row) {
      this.running.get(id)?.abort()
      this.db
        .prepare('UPDATE shared_thread_writers SET config=NULL,error=? WHERE id=?')
        .run('Updates paused', id)
    }
    return { enabled: false, error: '' }
  }
  private async host(
    config: SharingWriterConfig,
    method: string,
    signal: AbortSignal,
    data?: unknown,
  ) {
    const response = await fetch(config.origin + '/v2/shares/' + config.id + '/writer', {
      method,
      redirect: 'error',
      credentials: 'omit',
      signal,
      headers: {
        Authorization: 'DovoWriter ' + config.writerSecret,
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    })
    if (!response.ok)
      throw new HttpError(
        response.status,
        response.status === 409
          ? 'Sharing keys changed; resume sharing in Studio'
          : response.status === 401 || response.status === 404
            ? 'Hosted sharing was paused, revoked or deleted'
            : 'Thread sync is unavailable; it will resume when the service returns',
      )
    return (await response.json()) as unknown
  }
  start() {
    this.timer ??= setInterval(() => void this.tick(), 5000)
    this.timer.unref()
  }
  async tick() {
    if (this.closed) return
    const rows = this.db
      .prepare(
        'SELECT id,task,device,config,fingerprint FROM shared_thread_writers WHERE config IS NOT NULL LIMIT 16',
      )
      .all()
    const work = rows.map(async (raw) => {
      const row = decode(
        mutableStruct({
          id: Schema.String,
          task: Schema.String,
          device: Schema.String,
          config: Schema.String,
          fingerprint: Schema.String,
        }),
        raw,
      )
      if (this.running.has(row.id)) return
      const controller = new AbortController()
      this.running.set(row.id, controller)
      try {
        this.authorize(row.task, row.device)
        const config = decode(configSchema, JSON.parse(row.config))
        if (config.feed && !this.artifactsEnabled())
          throw new HttpError(403, 'Artifacts are disabled')
        if (
          config.feed &&
          Date.now() - Number(row.fingerprint || 0) < config.feed.query.seconds * 1000
        )
          return
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(60000)])
        const head = config.feed
          ? decode(
              mutableStruct({ version: Schema.Number, generation: Schema.String }),
              await this.host(config, 'GET', signal),
            )
          : undefined
        if (head && head.generation !== config.generation)
          throw new HttpError(401, 'Sharing keys changed; resume sharing in Studio')
        if (config.feed)
          this.db
            .prepare('UPDATE shared_thread_writers SET fingerprint=? WHERE id=? AND config=?')
            .run(String(Date.now()), row.id, row.config)
        const content = config.feed
          ? {
              kind: 'artifact' as const,
              artifact: artifactPublicationInput(
                this.artifacts.read(row.task, config.feed.artifactId, config.feed.revision),
              ),
              feed: {
                data: (
                  await this.mcp.feedRead(
                    row.task,
                    config.feed.query,
                    config.feed.fingerprint,
                    signal,
                    () => this.authorize(row.task, row.device),
                  )
                ).data,
                updatedAt: Date.now(),
                seconds: config.feed.query.seconds,
              },
            }
          : this.preview(row.task)
        const fingerprint = config.feed ? String(Date.now()) : sharingHash(JSON.stringify(content))
        if (fingerprint === row.fingerprint) return
        const current =
          head ??
          decode(
            mutableStruct({ version: Schema.Number, generation: Schema.String }),
            await this.host(config, 'GET', signal),
          )
        this.authorize(row.task, row.device)
        if (current.generation !== config.generation)
          throw new HttpError(401, 'Sharing keys changed; resume sharing in Studio')
        await this.host(config, 'PUT', signal, {
          expectedVersion: current.version,
          packet: encryptSharedContent(config.id, config.generation, content, config),
        })
        this.db
          .prepare('UPDATE shared_thread_writers SET fingerprint=?,error=? WHERE id=? AND config=?')
          .run(fingerprint, '', row.id, row.config)
      } catch (error) {
        if (!controller.signal.aborted) {
          const permanent =
            error instanceof HttpError && [400, 401, 403, 404, 413].includes(error.status)
          this.db
            .prepare(
              'UPDATE shared_thread_writers SET config=CASE WHEN ? THEN NULL ELSE config END,error=? WHERE id=? AND config=?',
            )
            .run(
              permanent ? 1 : 0,
              error instanceof Error ? error.message : 'Thread sync failed',
              row.id,
              row.config,
            )
        }
      } finally {
        this.running.delete(row.id)
      }
    })
    for (const promise of work) this.pending.add(promise)
    try {
      await Promise.all(work)
    } finally {
      for (const promise of work) this.pending.delete(promise)
    }
  }
  async stopTasks(ids: readonly string[]) {
    for (const id of ids) {
      const rows = this.db.prepare('SELECT id FROM shared_thread_writers WHERE task=?').all(id)
      for (const row of rows)
        this.running.get(decode(mutableStruct({ id: Schema.String }), row).id)?.abort()
      this.db.prepare('DELETE FROM shared_thread_writers WHERE task=?').run(id)
    }
    await Promise.allSettled([...this.pending])
  }
  async dispose() {
    this.closed = true
    clearInterval(this.timer)
    for (const controller of this.running.values()) controller.abort()
    await Promise.allSettled([...this.pending])
  }
}
