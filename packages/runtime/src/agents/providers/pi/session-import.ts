import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { mkdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import {
  decode,
  defaultTaskHarness,
  taskHarnessSchema,
  type Task,
  type CodexSessionDiscovery,
  type CodexSessionImport,
  type CodexSessionSelection,
  type CodexSessionPreview,
} from '@dovo/protocol'
import type { WorkspaceStore } from '../../../storage/workspace.js'
import type { AgentRegistry } from '../../configuration/registry.js'
import type { GitService } from '../../../scm/git/git.js'
import { worktreeRecords } from '../../../scm/git/worktree-records.js'
import { HttpError } from '../../../errors.js'
import { processEnvironment } from '../../../process.js'
import { discoverPiSessions, piSessionsDirectory } from './session-discovery.js'
import { readPiSessionFile } from './session-file.js'
import { parsePiTranscript, piSessionMetadata } from './session-transcript.js'
import { piSessionActivity } from './session-activity.js'

const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'
const within = (root: string, path: string) => {
  const rest = relative(root, path)
  return !rest || (!rest.startsWith('..') && !isAbsolute(rest))
}

export class PiSessionImports {
  constructor(
    private store: WorkspaceStore,
    private registry: AgentRegistry,
    private git: GitService,
    private storage: string,
  ) {}
  private async source(input: CodexSessionDiscovery) {
    const repository = this.store.get().repositories.find((item) => item.id === input.repositoryId)
    if (!repository || repository.kind === 'scratch')
      throw new HttpError(404, 'Choose a project first')
    const saved = input.agentId
      ? this.store.get().agents.find((agent) => agent.id === input.agentId)
      : undefined
    if (input.agentId && !saved) throw new HttpError(404, 'Pi configuration no longer exists')
    const defaults = this.store.taskDefaults(repository.id)
    const harness =
      defaults.harness?.provider === 'pi' ? defaults.harness : defaultTaskHarness('pi')
    const agent = this.registry.configure(saved ?? { ...harness, id: '', name: 'Pi' })
    if (agent.provider !== 'pi') throw new HttpError(400, 'Choose a Pi configuration')
    this.registry.authorize(agent)
    const configured = await this.registry.secretReferences.resolve(agent)
    const env = processEnvironment(configured.env)
    const home = (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir()
    const directory = piSessionsDirectory(env, home)
    const root = await realpath(repository.path)
    const roots = [root]
    if (!repository.kind && (await this.git.isRepository(root))) {
      for (const record of worktreeRecords(
        await this.git.command(root, ['worktree', 'list', '--porcelain', '-z']),
      ))
        if (record.path) roots.push(await realpath(record.path))
    }
    return { repository, agent, directory, roots }
  }
  private owner(path: string, key: string) {
    return this.store
      .get()
      .tasks.find(
        (task) =>
          task.importedPiSession?.key === key ||
          task.importedPiSession?.transcriptPath === path ||
          (task.providerLock === 'pi' && task.sessionId === path),
      )
  }
  async list(input: CodexSessionDiscovery) {
    const source = await this.source(input)
    const found = await discoverPiSessions(source.directory, source.roots)
    return {
      sessions: found.sessions.map(({ path, ...session }) => ({
        ...session,
        title: `Pi · ${session.sessionId.slice(0, 8)}`,
        model: '',
        taskId: this.owner(path, session.key)?.id,
      })),
      notice: found.limited ? 'Discovery is bounded; some sessions may not be shown.' : undefined,
    }
  }
  private async selected(input: CodexSessionSelection) {
    const source = await this.source(input)
    const candidate = (await discoverPiSessions(source.directory, source.roots)).sessions.find(
      (item) => item.key === input.key,
    )
    if (!candidate)
      throw new HttpError(404, 'This Pi session is no longer available in the selected project')
    const { text, info } = await readPiSessionFile(candidate.path, 'transcript')
    const transcript = parsePiTranscript(text)
    if (
      transcript.id !== candidate.sessionId ||
      (await realpath(transcript.cwd).catch(() => '')) !== candidate.cwd
    )
      throw new HttpError(409, 'The Pi transcript identity changed. Preview it again')
    const owner = this.owner(candidate.path, candidate.key)
    const activity = owner ? 'inactive' : await piSessionActivity()
    const status: CodexSessionPreview['status'] = owner
      ? 'owned'
      : activity === 'active' || Date.now() - info.mtimeMs < 2000
        ? 'active'
        : 'available'
    const notice =
      status === 'owned'
        ? 'This session already belongs to a Dovo thread.'
        : status === 'active'
          ? 'Exit Pi before importing this session.'
          : `${activity === 'unknown' ? 'Pi activity could not be checked; the snapshot may omit recent terminal changes. ' : ''}Import creates a private copy and leaves the terminal source untouched. Continuation requires @earendil-works/pi-coding-agent 1.4 or newer and starts text-only; built-in tools require full access. Extensions and MCP are disabled.`
    const latest = await stat(candidate.path)
    if (latest.size !== info.size || latest.mtimeMs !== info.mtimeMs)
      throw new HttpError(409, 'The Pi transcript changed during preview')
    const { path: _path, ...summary } = candidate
    const preview: CodexSessionPreview = {
      session: {
        ...summary,
        title: transcript.title || `Pi · ${transcript.id.slice(0, 8)}`,
        model: '',
        taskId: owner?.id,
      },
      revision: transcript.revision,
      status,
      notice,
      messages: transcript.messages
        .slice(-100)
        .map((message) => ({ ...message, text: message.text.slice(0, 16000) })),
      olderMessages: Math.max(0, transcript.messages.length - 100),
    }
    return { source, candidate, transcript, preview, text }
  }
  async preview(input: CodexSessionSelection) {
    return (await this.selected(input)).preview
  }
  async import(input: CodexSessionImport) {
    const existing = this.store
      .get()
      .tasks.find((task) => task.importedPiSession?.key === input.key)
    if (existing) {
      if (existing.repositoryId !== input.repositoryId)
        throw new HttpError(409, 'This import belongs to another project')
      return { id: existing.id, existing: true }
    }
    const { source, candidate, transcript, preview, text } = await this.selected(input)
    const owner = this.owner(candidate.path, input.key)
    if (owner) {
      if (owner.importedPiSession?.key === input.key && owner.repositoryId === input.repositoryId)
        return { id: owner.id, existing: true }
      throw new HttpError(409, 'This session already belongs to a Dovo thread')
    }
    if (preview.revision !== input.revision)
      throw new HttpError(409, 'The session changed since preview')
    if (preview.status !== 'available') throw new HttpError(409, preview.notice)
    if (!transcript.messages.length)
      throw new HttpError(409, 'There are no conversation messages to import')
    if (!this.store.get().repositories.some((repository) => repository === source.repository))
      throw new HttpError(409, 'The selected project changed')
    const now = new Date().toISOString(),
      id = randomUUID()
    await mkdir(this.storage, { recursive: true, mode: 0o700 })
    const privatePath = join(await realpath(this.storage), `${id}.jsonl`)
    await writeFile(privatePath, text, { flag: 'wx', mode: 0o600 })
    let committed = false
    try {
      // File creation yields: repeat ownership and project checks before the atomic workspace write.
      const raced = this.owner(candidate.path, input.key)
      if (raced) {
        if (raced.importedPiSession?.key === input.key && raced.repositoryId === input.repositoryId)
          return { id: raced.id, existing: true }
        throw new HttpError(409, 'This session already belongs to a Dovo thread')
      }
      if (!this.store.get().repositories.some((repository) => repository === source.repository))
        throw new HttpError(409, 'The selected project changed')
      const checkout = source.roots
        .filter((root) => within(root, candidate.cwd))
        .sort((a, b) => b.length - a.length)[0]
      const existingWorktreePath = checkout !== source.roots[0] ? checkout : undefined
      const task: Task = {
        id,
        repositoryId: source.repository.id,
        agentId: source.agent.id,
        title: preview.session.title,
        status: 'review',
        createdAt: Number.isFinite(Date.parse(transcript.timestamp)) ? transcript.timestamp : now,
        updatedAt: now,
        execution: existingWorktreePath ? 'worktree' : 'main',
        existingWorktreePath,
        checkoutLocked: true,
        providerLock: 'pi',
        harness: decode(taskHarnessSchema, {
          ...source.agent,
          permission: 'read-only',
          approvalPolicy: undefined,
          sandboxMode: undefined,
        }),
        messages: transcript.messages,
        consumedMessageIds: transcript.messages.map((message) => message.id),
        files: [],
        draft: '',
        example: false,
        queuePaused: true,
        sessionId: privatePath,
        importedPiSession: {
          key: input.key,
          sessionId: transcript.id,
          directory: source.directory,
          transcriptPath: candidate.path,
          privatePath,
          cwd: candidate.cwd,
          importedAt: now,
        },
      }
      this.store.update((workspace) => ({ ...workspace, tasks: [...workspace.tasks, task] }))
      committed = true
      return { id, existing: false }
    } finally {
      if (!committed) await rm(privatePath, { force: true })
    }
  }
}

export async function requireImportedPiSession(
  task: Pick<Task, 'importedPiSession' | 'sessionId'>,
) {
  const imported = task.importedPiSession
  if (!imported) return
  if (!imported.privatePath || task.sessionId !== imported.privatePath)
    throw new HttpError(409, 'The imported Pi session identity changed')
  const file = await realpath(imported.privatePath).catch((error: unknown) => {
    if (!missing(error)) throw error
  })
  const cwd = await realpath(imported.cwd).catch((error: unknown) => {
    if (!missing(error)) throw error
  })
  if (
    !file ||
    !cwd ||
    file !== imported.privatePath ||
    cwd !== imported.cwd ||
    !(await stat(cwd)).isDirectory()
  )
    throw new HttpError(409, 'The imported Pi session or checkout is missing')
  const metadata = piSessionMetadata((await readPiSessionFile(file, 'header')).text)
  if (
    !metadata ||
    metadata.id !== imported.sessionId ||
    (await realpath(metadata.cwd).catch(() => '')) !== imported.cwd
  )
    throw new HttpError(409, 'The imported Pi transcript identity changed')
}
