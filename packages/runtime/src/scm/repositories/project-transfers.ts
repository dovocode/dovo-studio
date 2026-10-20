import { randomUUID, createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { Schema } from 'effect'
import type Database from 'better-sqlite3'
import {
  decode,
  mutableStruct,
  projectTransferActive,
  projectTransferSchema,
  projectTransferStartSchema,
  projectTransferManifestSchema,
  projectTransferResultSchema,
  runtimeRequest,
  type ProjectTransfer,
  type ProjectTransferStart,
  type ProjectTransferManifest,
  type RuntimeConnection,
} from '@dovo/protocol'
import type { Services } from '../../services.js'
import { HttpError, errorMessage } from '../../errors.js'
import { openTunnel, stopSsh } from '../../previews/device-host-ssh.js'
import {
  hashFile,
  installTransfer,
  inspectTransfer,
  prepareTransfer,
  transferPath,
} from './project-transfer-files.js'

const okSchema = mutableStruct({ ok: Schema.Literal(true) })
const statusSchema = mutableStruct({ result: Schema.optional(projectTransferResultSchema) })
const discardSchema = mutableStruct({
  ok: Schema.Literal(true),
  result: Schema.optional(projectTransferResultSchema),
})
type Result = typeof projectTransferResultSchema.Type
type Incoming = {
  manifest: ProjectTransferManifest
  device: string
  folder: string
  counts: number[]
  updated: number
  controller: AbortController
  writing?: Promise<{ ok: true }>
  pending?: Promise<Result>
  result?: Result
  busy: boolean
}
const savedSchema = mutableStruct({
  job: projectTransferSchema,
  input: projectTransferStartSchema,
  fingerprint: Schema.String,
  device: Schema.String,
})
const savedIncomingSchema = mutableStruct({
  id: Schema.String,
  device: Schema.String,
  stagingPath: Schema.optional(Schema.String),
  result: Schema.optional(projectTransferResultSchema),
})
const rowsSchema = Schema.Array(mutableStruct({ value: Schema.String }))
/** Computers exchange bounded chunks directly; clients never relay workspace files or peer tokens. */
export class ProjectTransfers {
  revision = 0
  private jobs = new Map<string, typeof savedSchema.Type>()
  private outgoing = new Map<string, { controller: AbortController; pending: Promise<void> }>()
  private incoming = new Map<string, Incoming>()
  private results = new Map<string, typeof savedIncomingSchema.Type>()
  private ready: Promise<void>
  private timer: ReturnType<typeof setInterval>
  private closed = false
  private root: string
  private projectsRoot = join(process.env.DOVO_DATA_ROOT ?? join(homedir(), '.dovo'), 'projects')
  constructor(
    private services: () => Services,
    db: Database.Database,
  ) {
    const s = { db }
    this.root =
      s.db.name === ':memory:'
        ? join(tmpdir(), `dovo-project-transfers-${randomUUID()}`)
        : join(dirname(s.db.name), 'project-transfers')
    s.db.exec(
      'CREATE TABLE IF NOT EXISTS project_transfers (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS project_transfer_receipts (id TEXT PRIMARY KEY, value TEXT NOT NULL)',
    )
    for (const row of decode(
      rowsSchema,
      s.db.prepare('SELECT value FROM project_transfers ORDER BY rowid').all(),
    )) {
      const saved = decode(savedSchema, JSON.parse(row.value))
      if (projectTransferActive(saved.job))
        saved.job = {
          ...saved.job,
          state: 'failed',
          error: 'The computer restarted during the copy. Try again.',
        }
      this.jobs.set(saved.job.id, saved)
    }
    for (const row of decode(
      rowsSchema,
      s.db.prepare('SELECT value FROM project_transfer_receipts').all(),
    )) {
      const saved = decode(savedIncomingSchema, JSON.parse(row.value))
      this.results.set(saved.id, saved)
    }
    const root = this.root
    this.ready = (async () => {
      await mkdir(root, { recursive: true, mode: 0o700 })
      // Only remove staging paths belonging to our persisted UUID receipts.
      for (const id of new Set([...this.jobs.keys(), ...this.results.keys()])) {
        if (/^[a-f0-9-]{36}$/.test(id))
          await Promise.all(
            ['out', 'in'].map((direction) =>
              rm(join(root, `${direction}-${id}`), { recursive: true, force: true }),
            ),
          )
      }
      const managedRoot = await realpath(this.projectsRoot).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
        throw error
      })
      for (const receipt of this.results.values()) {
        const path = receipt.stagingPath
        if (
          !receipt.result &&
          path &&
          dirname(path) === managedRoot &&
          /-[a-zA-Z0-9]{6}$/.test(basename(path)) &&
          !this.services()
            .store.get()
            .repositories.some((repo) => repo.path === path)
        )
          await rm(path, { recursive: true, force: true })
      }
    })()
    // Surface startup failures to operations; never leave a rejected background promise unhandled.
    void this.ready.catch(() => {})
    this.timer = setInterval(() => {
      for (const [id, entry] of this.incoming)
        if (!entry.busy && Date.now() - entry.updated > 3600000)
          void this.discard(id, entry.device).catch((error) =>
            console.error('Project copy cleanup failed:', error),
          )
    }, 60000)
    this.timer.unref()
  }
  list() {
    return [...this.jobs.values()]
      .map((value) => value.job)
      .sort((a, b) => a.updatedAt - b.updatedAt)
  }
  targets() {
    return this.services()
      .retrievalPeers.list()
      .filter((peer) => peer.connection.runtimeId !== this.services().runtimeId)
      .map((peer) => ({ id: peer.connection.runtimeId ?? peer.id, name: peer.name }))
  }
  async inspect(repositoryId: string) {
    const source = await inspectTransfer(this.services(), repositoryId)
    return {
      files: source.files.length,
      bytes: source.files.reduce((sum, file) => sum + file.bytes, 0),
      ignoredFiles: source.ignoredFiles.map(({ path, bytes }) => ({ path, bytes })),
      skippedLinks: source.skippedLinks,
    }
  }
  private save(job: ProjectTransfer) {
    const saved = this.jobs.get(job.id)
    if (!saved) throw new HttpError(404, 'Project copy not found')
    job = { ...job, updatedAt: Math.max(job.updatedAt, saved.job.updatedAt + 1) }
    saved.job = job
    this.services()
      .db.prepare('INSERT OR REPLACE INTO project_transfers VALUES (?,?)')
      .run(job.id, JSON.stringify(saved))
    this.revision++
  }
  private update(id: string, changes: Partial<ProjectTransfer>) {
    const saved = this.jobs.get(id)
    if (saved) this.save({ ...saved.job, ...changes })
  }
  start(input: ProjectTransferStart, device: string, authorize: () => void) {
    if (this.closed) throw new HttpError(503, 'This computer is shutting down')
    if (!/^[a-f0-9-]{36}$/.test(input.id)) throw new HttpError(400, 'Invalid copy ID')
    const s = this.services()
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const existing = this.jobs.get(input.id)
    if (existing && (existing.fingerprint !== fingerprint || existing.device !== device))
      throw new HttpError(409, 'This copy ID is already in use')
    if (existing && (projectTransferActive(existing.job) || existing.job.state === 'completed'))
      return existing.job
    if (this.outgoing.size) throw new HttpError(409, 'Wait for the current project copy to finish')
    const peer = s.retrievalPeers
      .list()
      .find((peer) => (peer.connection.runtimeId ?? peer.id) === input.targetId)
    if (!peer?.connection.runtimeId || peer.connection.runtimeId === s.runtimeId)
      throw new HttpError(409, 'Reconnect the destination computer and try again')
    if (
      !s.store
        .get()
        .repositories.some((repo) => repo.id === input.repositoryId && repo.kind !== 'scratch')
    )
      throw new HttpError(404, 'Project not found')
    const job: ProjectTransfer = {
      id: input.id,
      repositoryId: input.repositoryId,
      targetId: input.targetId,
      targetName: peer.name,
      state: 'preparing',
      transport: input.ssh ? 'ssh' : 'p2p',
      bytes: 0,
      totalBytes: 0,
      updatedAt: Math.max(Date.now(), (existing?.job.updatedAt ?? 0) + 1),
    }
    this.jobs.set(job.id, { job, input, fingerprint, device })
    this.save(job)
    // Bound terminal history. Receipts on the destination retain idempotent completed results.
    for (const [id, saved] of this.jobs)
      if (this.jobs.size > 50 && !projectTransferActive(saved.job) && id !== job.id) {
        this.jobs.delete(id)
        s.db.prepare('DELETE FROM project_transfers WHERE id=?').run(id)
      }
    const controller = new AbortController()
    const pending = this.send(input, peer.connection, controller.signal, () => {
      authorize()
      const current = s.retrievalPeers
        .list()
        .find((peer) => peer.connection.runtimeId === input.targetId)
      if (!current || current.connection.token !== peer.connection.token)
        throw new HttpError(403, 'Pairing changed during the copy. Reconnect and try again.')
    }).finally(() => this.outgoing.delete(job.id))
    this.outgoing.set(job.id, { controller, pending })
    return this.jobs.get(job.id)!.job
  }
  async cancel(id: string) {
    const saved = this.jobs.get(id)
    if (!saved) throw new HttpError(404, 'Project copy not found')
    this.outgoing.get(id)?.controller.abort()
    await this.outgoing.get(id)?.pending
    return { ok: true as const }
  }
  retry(id: string, authorize: () => void) {
    const saved = this.jobs.get(id)
    if (!saved) throw new HttpError(404, 'Project copy not found')
    return this.start(saved.input, saved.device, authorize)
  }
  private async send(
    input: ProjectTransferStart,
    peer: RuntimeConnection,
    signal: AbortSignal,
    authorize: () => void,
  ) {
    let tunnel: Awaited<ReturnType<typeof openTunnel>> | undefined
    let connection = peer
    const s = this.services(),
      folder = join(this.root, `out-${input.id}`)
    const call = <T extends Schema.Codec<unknown, unknown>>(
      action: string,
      value: unknown,
      schema: T,
      abort = signal,
    ) => {
      authorize()
      return runtimeRequest(
        connection,
        connection.address,
        `/api/scm/project-transfer/${action}`,
        value,
        schema,
        'POST',
        action === 'commit' ? 600000 : 30000,
        abort,
        input.ssh ? { route: 'http' } : undefined,
      )
    }
    const complete = (result: Result) =>
      this.update(input.id, {
        state: 'completed',
        error: undefined,
        path: result.path,
        targetRepositoryId: result.repositoryId,
        bytes: this.jobs.get(input.id)?.job.totalBytes ?? 0,
      })
    try {
      await this.ready
      signal.throwIfAborted()
      if (input.ssh) {
        tunnel = await openTunnel({
          id: input.id,
          name: 'Project destination',
          ...input.ssh,
          runtimeAddress: `http://127.0.0.1:${input.ssh.runtimePort}`,
          agentAccess: false,
        })
        connection = { ...peer, address: tunnel.address, alternateAddresses: [] }
      }
      const status = await call('status', { id: input.id }, statusSchema)
      if (status.result) {
        complete(status.result)
        return
      }
      await mkdir(folder, { mode: 0o700 })
      const { skippedLinks, ...prepared } = await prepareTransfer(
        s,
        input.repositoryId,
        input.ignoredFiles,
        folder,
        signal,
      )
      const manifest: ProjectTransferManifest = {
        ...prepared,
        id: input.id,
        runtimeId: peer.runtimeId!,
      }
      // Validate locally too, so both ends agree on bounded names, hashes and sizes.
      decode(projectTransferManifestSchema, manifest)
      if (Buffer.byteLength(JSON.stringify(manifest)) > 8 * 1024 * 1024)
        throw new HttpError(
          413,
          'This project has too many files or long paths to copy. Exclude generated files and try again.',
        )
      const totalBytes = manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0)
      this.update(input.id, { state: 'copying', totalBytes, skippedLinks })
      await call('begin', manifest, okSchema)
      let bytes = 0,
        published = 0
      for (const [index, entry] of manifest.entries.entries()) {
        const handle = await open(join(folder, String(index)), 'r')
        try {
          let offset = 0
          // Empty files still need an authenticated create/verify operation.
          do {
            signal.throwIfAborted()
            const size = Math.min(256 * 1024, entry.bytes - offset)
            const buffer = Buffer.alloc(size)
            const read = await handle.read(buffer, 0, size, offset)
            if (read.bytesRead !== size)
              throw new HttpError(409, 'Prepared file changed during transfer')
            await call(
              'chunk',
              { id: input.id, index, offset, data: buffer.toString('base64') },
              okSchema,
            )
            offset += size
            bytes += size
            if (Date.now() - published >= 250 || bytes === totalBytes) {
              this.update(input.id, { bytes })
              published = Date.now()
            }
          } while (offset < entry.bytes)
        } finally {
          await handle.close()
        }
      }
      this.update(input.id, { state: 'registering' })
      const result = await call('commit', { id: input.id }, projectTransferResultSchema)
      complete(result)
    } catch (error) {
      // Commit may succeed even when the response is lost. Reconcile before reporting a
      // failure or cancellation, and retry the same ID rather than creating a duplicate.
      // A failed SSH handshake cannot have admitted files; never fall back to
      // the direct connection when the user chose SSH.
      if (!input.ssh || tunnel) {
        try {
          const status = await call(
            'status',
            { id: input.id },
            statusSchema,
            AbortSignal.timeout(5000),
          )
          if (status.result) {
            complete(status.result)
            return
          }
          const discarded = await call(
            'discard',
            { id: input.id },
            discardSchema,
            AbortSignal.timeout(5000),
          )
          if (discarded.result) {
            complete(discarded.result)
            return
          }
        } catch (cleanup) {
          if (!signal.aborted)
            console.warn(
              'Project copy could not confirm destination cleanup:',
              errorMessage(cleanup),
            )
        }
      }
      this.update(input.id, {
        state: signal.aborted ? 'cancelled' : 'failed',
        error: signal.aborted ? undefined : errorMessage(error),
      })
    } finally {
      if (tunnel) await stopSsh(tunnel.child)
      await rm(folder, { recursive: true, force: true }).catch((error) =>
        console.error('Project copy staging cleanup failed:', error),
      )
    }
  }
  private receipt(id: string, device: string) {
    const saved = this.results.get(id)
    if (saved && saved.device !== device) throw new HttpError(404, 'Project copy not found')
    return saved
  }
  status(id: string, device: string) {
    return { result: this.receipt(id, device)?.result }
  }
  async begin(manifest: ProjectTransferManifest, device: string) {
    if (this.closed) throw new HttpError(503, 'This computer is shutting down')
    await this.ready
    if (manifest.runtimeId !== this.services().runtimeId)
      throw new HttpError(
        409,
        'The destination is a different computer. Pair it again before copying.',
      )
    const saved = this.receipt(manifest.id, device)
    if (saved?.result) return { ok: true as const }
    if (this.incoming.has(manifest.id))
      throw new HttpError(409, 'This copy is already receiving files')
    if (this.incoming.size >= 3)
      throw new HttpError(429, 'This computer is already receiving projects')
    const paths = new Set<string>()
    const prefixes = new Map<string, string>()
    for (const entry of manifest.entries) {
      if (entry.kind === 'file') {
        transferPath(entry.path)
        const key = entry.path.normalize('NFC').toLowerCase()
        if (paths.has(key))
          throw new HttpError(409, `File names differ only in case: ${entry.path}`)
        paths.add(key)
        const parts = entry.path.split('/')
        for (let i = 1; i <= parts.length; i++) {
          const prefix = parts.slice(0, i).join('/'),
            normalized = prefix.normalize('NFC').toLowerCase()
          if (prefixes.has(normalized) && prefixes.get(normalized) !== prefix)
            throw new HttpError(
              409,
              `File or folder names cannot be distinguished on the destination: ${prefix}`,
            )
          prefixes.set(normalized, prefix)
        }
      }
    }
    if (
      manifest.entries.filter((entry) => entry.kind === 'bundle').length !==
        (manifest.git ? 1 : 0) ||
      manifest.entries.filter((entry) => entry.kind === 'index').length > 1
    )
      throw new HttpError(400, 'Invalid Git workspace manifest')
    const folder = join(this.root, `in-${manifest.id}`)
    // Persist ownership before creating anything, so interrupted staging is cleaned on restart.
    const receipt = { id: manifest.id, device }
    this.results.set(manifest.id, receipt)
    this.services()
      .db.prepare('INSERT OR REPLACE INTO project_transfer_receipts VALUES (?,?)')
      .run(manifest.id, JSON.stringify(receipt))
    await mkdir(folder, { mode: 0o700 })
    this.incoming.set(manifest.id, {
      manifest,
      device,
      folder,
      counts: manifest.entries.map(() => 0),
      updated: Date.now(),
      controller: new AbortController(),
      busy: false,
    })
    return { ok: true as const }
  }
  private receiving(id: string, device: string) {
    const entry = this.incoming.get(id)
    if (!entry || entry.device !== device)
      throw new HttpError(404, 'Project copy not found. Start it again.')
    return entry
  }
  async chunk(input: { id: string; index: number; offset: number; data: string }, device: string) {
    const entry = this.receiving(input.id, device),
      file = entry.manifest.entries[input.index]
    if (entry.busy || entry.pending || entry.controller.signal.aborted)
      throw new HttpError(409, 'Project copy is busy')
    const data = Buffer.from(input.data, 'base64')
    if (
      !file ||
      input.offset !== entry.counts[input.index] ||
      input.offset + data.length > file.bytes ||
      data.length > 256 * 1024 ||
      (!data.length && file.bytes)
    )
      throw new HttpError(409, 'Unexpected file chunk. Start the copy again.')
    entry.busy = true
    entry.writing = (async () => {
      try {
        const handle = await open(
          join(entry.folder, String(input.index)),
          input.offset ? 'r+' : 'w',
          0o600,
        )
        try {
          let written = 0
          while (written < data.length) {
            const result = await handle.write(
              data,
              written,
              data.length - written,
              input.offset + written,
            )
            if (!result.bytesWritten) throw new HttpError(500, 'Could not write the copied file')
            written += result.bytesWritten
          }
        } finally {
          await handle.close()
        }
        entry.counts[input.index] += data.length
        entry.updated = Date.now()
        return { ok: true as const }
      } finally {
        entry.busy = false
      }
    })()
    return entry.writing
  }
  async commit(id: string, device: string, authorize: () => void) {
    const saved = this.receipt(id, device)
    if (saved?.result) return saved.result
    const entry = this.receiving(id, device)
    if (entry.pending) return entry.pending
    if (entry.busy) throw new HttpError(409, 'Project copy is still receiving a file')
    entry.busy = true
    entry.pending = this.finish(entry, authorize).finally(() => {
      entry.busy = false
    })
    return entry.pending
  }
  private async finish(entry: Incoming, authorize: () => void) {
    const s = this.services(),
      { manifest, controller } = entry
    let project: string | undefined
    try {
      for (const [index, file] of manifest.entries.entries()) {
        controller.signal.throwIfAborted()
        const path = join(entry.folder, String(index))
        if (
          entry.counts[index] !== file.bytes ||
          (await stat(path)).size !== file.bytes ||
          (await hashFile(path)) !== file.sha256
        )
          throw new HttpError(409, 'A copied file failed verification. Start the copy again.')
      }
      const workspace = await installTransfer(s, manifest, entry.folder, controller.signal)
      const root = this.projectsRoot
      await mkdir(root, { recursive: true })
      const parent = await realpath(root)
      if (await s.git.isRepository(parent))
        throw new HttpError(409, 'The Dovo projects folder must be outside a Git repository')
      const slug =
        manifest.name
          .normalize('NFKD')
          .replace(/[\u0300-\u036f]/g, '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 60) || 'project'
      project = await mkdtemp(join(parent, `${slug}-`))
      const stagingReceipt = { id: manifest.id, device: entry.device, stagingPath: project }
      this.results.set(manifest.id, stagingReceipt)
      s.db
        .prepare('INSERT OR REPLACE INTO project_transfer_receipts VALUES (?,?)')
        .run(manifest.id, JSON.stringify(stagingReceipt))
      // Renaming individual top-level entries also works when the runtime data and
      // managed projects live on different volumes (copy across volumes explicitly).
      const { cp, readdir } = await import('node:fs/promises')
      for (const name of await readdir(workspace)) {
        const source = join(workspace, name),
          target = join(project, name)
        try {
          await rename(source, target)
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EXDEV')) throw error
          await cp(source, target, { recursive: true, force: false, errorOnExist: true })
        }
      }
      controller.signal.throwIfAborted()
      const checkout = manifest.git
        ? await s.git.inspect(project)
        : { path: await realpath(project), branch: '', kind: 'folder' as const }
      authorize()
      const repository = { id: randomUUID(), name: manifest.name, ...checkout }
      const result = { repositoryId: repository.id, path: repository.path }
      const saved = { id: manifest.id, device: entry.device, result }
      s.store.transaction(() => {
        s.store.update((workspace) => ({
          ...workspace,
          repositories: [...workspace.repositories, repository],
        }))
        s.db
          .prepare('INSERT OR REPLACE INTO project_transfer_receipts VALUES (?,?)')
          .run(manifest.id, JSON.stringify(saved))
      })
      this.results.set(manifest.id, saved)
      entry.result = result
      return result
    } catch (error) {
      if (project && !entry.result) await rm(project, { recursive: true, force: true })
      throw error
    } finally {
      await rm(entry.folder, { recursive: true, force: true })
      this.incoming.delete(manifest.id)
    }
  }
  async discard(id: string, device: string) {
    this.receipt(id, device)
    const entry = this.incoming.get(id)
    if (entry && entry.device !== device) throw new HttpError(404, 'Project copy not found')
    if (entry) {
      entry.controller.abort()
      if (entry.writing) await entry.writing.catch(() => {})
      if (entry.pending) await entry.pending.catch(() => {})
      await rm(entry.folder, { recursive: true, force: true })
      this.incoming.delete(id)
    }
    return { ok: true as const, result: this.receipt(id, device)?.result }
  }
  async dispose() {
    this.closed = true
    clearInterval(this.timer)
    for (const active of this.outgoing.values()) active.controller.abort()
    for (const active of this.incoming.values()) active.controller.abort()
    await Promise.allSettled([...this.outgoing.values()].map((active) => active.pending))
    await Promise.allSettled(
      [...this.incoming.entries()].map(([id, entry]) => this.discard(id, entry.device)),
    )
    await this.ready.catch(() => {})
    if (this.services().db.name === ':memory:')
      await rm(this.root, { recursive: true, force: true })
  }
}
