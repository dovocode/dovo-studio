import {
  PROJECT_TRANSFER_MANIFEST_BYTES,
  createRuntimeClient,
  isPeerAddress,
  decode,
  mutableStruct,
  projectTransferActive,
  projectTransferSchema,
  projectTransferStartSchema,
  projectTransferBatchSchema,
  projectTransferManifestSchema,
  projectTransferResultSchema,
  projectTransferPlanInputSchema,
  projectTransferPlanSchema,
  projectTransferProjectSchema,
  type ProjectTransfer,
  type ProjectTransferStart,
  type ProjectTransferManifest,
  type RuntimeConnection,
  type Repository,
} from '@dovo/protocol'
import { randomUUID, createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, realpath, rename, rm, stat } from 'node:fs/promises'
import { dirname, join, basename } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { Schema } from 'effect'
import type Database from 'better-sqlite3'
import type { Services } from '../../services.js'
import { HttpError, errorMessage } from '../../errors.js'
import { openTunnel, stopSsh } from '../../previews/device-host-ssh.js'
import {
  hashFile,
  installTransfer,
  inspectTransfer,
  prepareTransfer,
  transferPath,
  transferProject,
} from './project-transfer-files.js'
import {
  cleanupTransferredWorktree,
  installWorktreeTransfer,
  transferDestinations,
  validateWorktreeDestination,
  type TransferOwnership,
} from './project-transfer-worktrees.js'

const okSchema = mutableStruct({ ok: Schema.Literal(true) })
const statusSchema = mutableStruct({
  result: Schema.optional(projectTransferResultSchema),
  worktreesSupported: Schema.optional(Schema.Boolean),
  batchesSupported: Schema.optional(Schema.Boolean),
  linkedWorktreesSupported: Schema.optional(Schema.Boolean),
})
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
  worktree: Schema.optional(
    mutableStruct({
      path: Schema.String,
      repositoryPath: Schema.String,
      project: Schema.optional(Schema.String),
      branch: Schema.optional(Schema.String),
    }),
  ),
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
        if (
          !receipt.result &&
          receipt.worktree &&
          !this.services()
            .store.get()
            .tasks.some((task) => task.existingWorktreePath === receipt.worktree?.path)
        ) {
          await cleanupTransferredWorktree(this.services(), receipt.worktree, receipt.id)
          const saved = { id: receipt.id, device: receipt.device }
          this.results.set(receipt.id, saved)
          s.db
            .prepare('INSERT OR REPLACE INTO project_transfer_receipts VALUES (?,?)')
            .run(receipt.id, JSON.stringify(saved))
        }
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
  targets(device?: string) {
    return this.services()
      .retrievalPeers.list(false, device)
      .filter((peer) => peer.connection.runtimeId !== this.services().runtimeId)
      .map((peer) => ({
        id: peer.connection.runtimeId ?? peer.id,
        name: peer.name,
        directSupported: !isPeerAddress(peer.connection.address),
      }))
  }
  async inspect(repositoryId: string, worktreePath?: string) {
    const source = await inspectTransfer(this.services(), repositoryId, undefined, worktreePath)
    return {
      files: source.files.length,
      bytes: source.files.reduce((sum, file) => sum + file.bytes, 0),
      ignoredFiles: source.ignoredFiles.map(({ path, bytes }) => ({ path, bytes })),
      ignoredFilesTruncated: source.ignoredFilesTruncated,
      skippedLinks: source.skippedLinks,
    }
  }
  destination(project: typeof projectTransferProjectSchema.Type) {
    return transferDestinations(this.services(), project)
  }
  async plan(
    input: typeof projectTransferPlanInputSchema.Type,
    authorize: () => void,
    device?: string,
  ) {
    await this.ready
    const s = this.services()
    const peer = s.retrievalPeers
      .list(false, device)
      .find((peer) => peer.connection.runtimeId === input.targetId)
    if (!peer || input.targetId === s.runtimeId)
      throw new HttpError(409, 'Reconnect the destination computer and try again')
    if (!input.ssh && isPeerAddress(peer.connection.address))
      throw new HttpError(
        409,
        'This destination requires an SSH tunnel or a LAN/VPN pairing for project copies.',
      )
    const project = await transferProject(s, input.repositoryId)
    let tunnel: Awaited<ReturnType<typeof openTunnel>> | undefined
    try {
      authorize()
      if (input.ssh)
        tunnel = await openTunnel({
          id: randomUUID(),
          name: 'Project destination',
          ...input.ssh,
          runtimeAddress: `http://127.0.0.1:${input.ssh.runtimePort}`,
          agentAccess: false,
        })
      const client = createRuntimeClient(
        tunnel
          ? {
              ...peer.connection,
              address: tunnel.address,
              alternateAddresses: [],
              internet: undefined,
            }
          : { ...peer.connection, internet: undefined },
      )
      const options = { method: 'POST' as const, ...(input.ssh ? { route: 'http' as const } : {}) }
      const status = await client.request(
        '/api/scm/project-transfer/status',
        { id: randomUUID() },
        statusSchema,
        options,
      )
      if (!status.linkedWorktreesSupported)
        throw new HttpError(409, 'Update the destination computer to copy linked worktrees')
      authorize()
      return await client.request(
        '/api/scm/project-transfer/destination',
        project,
        projectTransferPlanSchema,
        options,
      )
    } finally {
      if (tunnel) await stopSsh(tunnel.child)
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
      .list(false, device)
      .find((peer) => (peer.connection.runtimeId ?? peer.id) === input.targetId)
    if (!peer?.connection.runtimeId || peer.connection.runtimeId === s.runtimeId)
      throw new HttpError(409, 'Reconnect the destination computer and try again')
    if (!input.ssh && isPeerAddress(peer.connection.address))
      throw new HttpError(
        409,
        'This destination requires an SSH tunnel or a LAN/VPN pairing for project copies.',
      )
    if (
      !s.store
        .get()
        .repositories.some((repo) => repo.id === input.repositoryId && repo.kind !== 'scratch')
    )
      throw new HttpError(404, 'Project not found')
    const job: ProjectTransfer = {
      id: input.id,
      repositoryId: input.repositoryId,
      worktreePath: input.worktreePath,
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
    const pending = this.send(input, peer.connection, controller.signal, Boolean(existing), () => {
      authorize()
      const current = s.retrievalPeers
        .list(false, device)
        .find((peer) => peer.connection.runtimeId === input.targetId)
      if (!current || JSON.stringify(current.connection) !== JSON.stringify(peer.connection))
        throw new HttpError(403, 'Pairing changed during the copy. Reconnect and try again.')
    })
      // Publish terminal state only after cleanup has released the copy lock.
      .finally(() => this.outgoing.delete(job.id))
      .then((terminal) => this.update(job.id, terminal))
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
    retrying: boolean,
    authorize: () => void,
  ) {
    let tunnel: Awaited<ReturnType<typeof openTunnel>> | undefined
    // The runtime cannot initiate native WebRTC; keep this copy on its chosen HTTP route.
    let connection = { ...peer, internet: undefined }
    const s = this.services(),
      folder = join(this.root, `out-${input.id}`)
    const call = <T extends Schema.Codec<unknown, unknown>>(
      action: string,
      value: unknown,
      schema: T,
      abort = signal,
    ) => {
      authorize()
      return createRuntimeClient(connection).request(
        `/api/scm/project-transfer/${action}`,
        value,
        schema,
        {
          method: 'POST',
          timeoutMs: action === 'commit' ? 600000 : 30000,
          signal: abort,
          ...(input.ssh ? { route: 'http' } : undefined),
        },
      )
    }
    const complete = (result: Result): Partial<ProjectTransfer> => ({
      state: 'completed',
      error: undefined,
      path: result.path,
      targetRepositoryId: result.repositoryId,
      targetTaskId: result.taskId,
      threadStartError: result.threadStartError,
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
        connection = {
          ...peer,
          address: tunnel.address,
          alternateAddresses: [],
          internet: undefined,
        }
      }
      const status = await call('status', { id: input.id }, statusSchema)
      if ((input.worktreePath || input.thread) && !status.worktreesSupported)
        throw new HttpError(
          409,
          'Update the destination computer to copy worktrees and create threads',
        )
      if (status.result) {
        return complete(status.result)
      }
      if (retrying) {
        // A prior attempt may have lost its cleanup response. Wait for any commit
        // and reconcile its receipt before starting a new receiving session.
        const discarded = await call('discard', { id: input.id }, discardSchema)
        if (discarded.result) return complete(discarded.result)
      }
      if (input.worktreePath && !status.linkedWorktreesSupported)
        throw new HttpError(409, 'Update the destination computer to copy linked worktrees')
      if (input.worktreePath && !input.destination)
        throw new HttpError(
          409,
          'Choose the destination project or its parent folder before copying a worktree',
        )
      await mkdir(folder, { mode: 0o700 })
      const { skippedLinks, project, ...prepared } = await prepareTransfer(
        s,
        input.repositoryId,
        input.ignoredFiles,
        folder,
        signal,
        input.worktreePath,
      )
      const manifest: ProjectTransferManifest = {
        ...prepared,
        id: input.id,
        runtimeId: peer.runtimeId!,
        thread: input.thread,
        worktree:
          project && input.destination ? { ...project, destination: input.destination } : undefined,
      }
      // Validate locally too, so both ends agree on bounded names, hashes and sizes.
      decode(projectTransferManifestSchema, manifest)
      if (Buffer.byteLength(JSON.stringify(manifest)) > PROJECT_TRANSFER_MANIFEST_BYTES)
        throw new HttpError(
          413,
          'This project has too many files or long paths to copy. Exclude generated files and try again.',
        )
      const totalBytes = manifest.entries.reduce((sum, entry) => sum + entry.bytes, 0)
      this.update(input.id, { state: 'copying', totalBytes, skippedLinks })
      await call('begin', manifest, okSchema)
      let bytes = 0,
        published = 0
      let batch: typeof projectTransferBatchSchema.Type.chunks = []
      let batchBytes = 0
      const flush = async () => {
        if (!batch.length) return
        signal.throwIfAborted()
        await call('batch', { id: input.id, chunks: batch }, okSchema)
        bytes += batchBytes
        batch = []
        batchBytes = 0
        if (Date.now() - published >= 250 || bytes === totalBytes) {
          this.update(input.id, { bytes })
          published = Date.now()
        }
      }
      for (const [index, entry] of manifest.entries.entries()) {
        const handle = await open(join(folder, String(index)), 'r')
        try {
          let offset = 0
          // Empty files still need an authenticated create/verify operation.
          do {
            signal.throwIfAborted()
            if (status.batchesSupported && (batch.length === 128 || batchBytes === 256 * 1024))
              await flush()
            const size = Math.min(
              256 * 1024 - (status.batchesSupported ? batchBytes : 0),
              entry.bytes - offset,
            )
            const buffer = Buffer.alloc(size)
            const read = await handle.read(buffer, 0, size, offset)
            if (read.bytesRead !== size)
              throw new HttpError(409, 'Prepared file changed during transfer')
            const chunk = { index, offset, data: buffer.toString('base64') }
            if (status.batchesSupported) {
              batch.push(chunk)
              batchBytes += size
            } else {
              await call('chunk', { id: input.id, ...chunk }, okSchema)
              bytes += size
            }
            offset += size
            if (Date.now() - published >= 250 || bytes === totalBytes) {
              this.update(input.id, { bytes })
              published = Date.now()
            }
          } while (offset < entry.bytes)
        } finally {
          await handle.close()
        }
      }
      await flush()
      this.update(input.id, { state: 'registering' })
      const result = await call('commit', { id: input.id }, projectTransferResultSchema)
      return complete(result)
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
            return complete(status.result)
          }
          const discarded = await call(
            'discard',
            { id: input.id },
            discardSchema,
            AbortSignal.timeout(5000),
          )
          if (discarded.result) {
            return complete(discarded.result)
          }
        } catch (cleanup) {
          if (!signal.aborted)
            console.warn(
              'Project copy could not confirm destination cleanup:',
              errorMessage(cleanup),
            )
        }
      }
      return {
        state: signal.aborted ? ('cancelled' as const) : ('failed' as const),
        error: signal.aborted ? undefined : errorMessage(error),
      }
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
    return {
      result: this.receipt(id, device)?.result,
      worktreesSupported: true,
      batchesSupported: true,
      linkedWorktreesSupported: true,
    }
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
    if (manifest.worktree) {
      if (!manifest.git) throw new HttpError(400, 'Missing worktree Git history')
      await validateWorktreeDestination(this.services(), manifest.worktree)
    }
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
  async batch(
    input: typeof projectTransferBatchSchema.Type,
    device: string,
    authorize: () => void,
  ) {
    for (const chunk of input.chunks) {
      authorize()
      await this.chunk({ id: input.id, ...chunk }, device)
    }
    return { ok: true as const }
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
    let owned: TransferOwnership | undefined
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
      let linked: Awaited<ReturnType<typeof installWorktreeTransfer>> | undefined
      let repository: Repository
      if (manifest.worktree) {
        linked = await installWorktreeTransfer(
          s,
          manifest,
          entry.folder,
          controller.signal,
          (worktree) => {
            owned = worktree
            const receipt = { id: manifest.id, device: entry.device, worktree }
            this.results.set(manifest.id, receipt)
            s.db
              .prepare('INSERT OR REPLACE INTO project_transfer_receipts VALUES (?,?)')
              .run(manifest.id, JSON.stringify(receipt))
          },
        )
        const linkedRepository = linked.repository
        if ('id' in linkedRepository) {
          const existing = s.store
            .get()
            .repositories.find((repo) => repo.id === linkedRepository.id)
          if (!existing)
            throw new HttpError(
              409,
              'The destination project was removed during the copy. Refresh copy options and try again.',
            )
          repository = existing
        } else {
          repository = {
            id: randomUUID(),
            name: manifest.name,
            ...(await s.git.inspect(linkedRepository.path)),
          }
        }
      } else {
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
        repository = { id: randomUUID(), name: manifest.name, ...checkout }
      }
      controller.signal.throwIfAborted()
      authorize()
      const result: Result = { repositoryId: repository.id, path: linked?.path ?? repository.path }
      const saved = { id: manifest.id, device: entry.device, result }
      s.store.transaction(() => {
        if (linked) s.store.rememberWorktree(linked.common, linked.path)
        s.store.update((workspace) => ({
          ...workspace,
          repositories: workspace.repositories.some((repo) => repo.id === repository.id)
            ? workspace.repositories
            : [...workspace.repositories, repository],
        }))
        if (manifest.thread) {
          const task = s.tasks.create({
            title: manifest.thread.title,
            repositoryId: repository.id,
            agentId: '',
            execution: linked ? 'worktree' : 'main',
            ...(linked ? { existingWorktreePath: linked.path, checkoutBranch: linked.branch } : {}),
            objective: manifest.thread.prompt,
          })
          result.taskId = task.id
        }
        s.db
          .prepare('INSERT OR REPLACE INTO project_transfer_receipts VALUES (?,?)')
          .run(manifest.id, JSON.stringify(saved))
      })
      this.results.set(manifest.id, saved)
      entry.result = result
      if (result.taskId && manifest.thread?.prompt.trim()) {
        try {
          authorize()
          await s.tasks.start(result.taskId)
        } catch (error) {
          // Preserve the copied checkout and durable draft for repair on the destination.
          result.threadStartError = errorMessage(error)
          s.db
            .prepare('INSERT OR REPLACE INTO project_transfer_receipts VALUES (?,?)')
            .run(manifest.id, JSON.stringify(saved))
        }
      }
      return result
    } catch (error) {
      if (!entry.result) {
        if (owned) {
          await cleanupTransferredWorktree(s, owned, manifest.id)
          const receipt = { id: manifest.id, device: entry.device }
          this.results.set(manifest.id, receipt)
          s.db
            .prepare('INSERT OR REPLACE INTO project_transfer_receipts VALUES (?,?)')
            .run(manifest.id, JSON.stringify(receipt))
        }
        if (project) await rm(project, { recursive: true, force: true })
      }
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
