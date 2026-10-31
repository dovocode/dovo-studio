import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { opendir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  decode,
  defaultTaskHarness,
  resolveTaskAgent,
  taskHarnessSchema,
  type Agent,
  type Task,
  type Repository,
  type CodexSessionCandidate,
  type CodexSessionDiscovery,
  type CodexSessionSelection,
  type CodexSessionImport,
  type CodexSessionPreview,
} from '@dovo/protocol'
import type { WorkspaceStore } from '../../../storage/workspace.js'
import type { AgentRegistry } from '../../configuration/registry.js'
import type { GitService } from '../../../scm/git/git.js'
import { worktreeRecords } from '../../../scm/git/worktree-records.js'
import { HttpError } from '../../../errors.js'
import { processEnvironment } from '../../../process.js'
import {
  codexSessionMetadata,
  readCodexSessionHeader,
  readCodexTranscript,
  parseCodexTranscript,
} from './session-transcript.js'
import { codexSessionActivity } from './session-activity.js'

const missing = (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT'
const within = (root: string, path: string) => {
  const rest = relative(root, path)
  return rest === '' || (!rest.startsWith('..') && !isAbsolute(rest))
}
const keyFor = (home: string, id: string) =>
  createHash('sha256')
    .update(JSON.stringify([home, id]))
    .digest('hex')
const canonical = (path: string) =>
  realpath(path).catch((error: unknown) => {
    if (missing(error)) return resolve(path)
    throw error
  })

type Source = { repository: Repository; agent: Agent; home: string; roots: string[] }
type Candidate = CodexSessionCandidate & { path: string }

export class CodexSessionImports {
  constructor(
    private store: WorkspaceStore,
    private registry: AgentRegistry,
    private git: GitService,
  ) {}

  private async source(input: CodexSessionDiscovery): Promise<Source> {
    const repository = this.store.get().repositories.find((item) => item.id === input.repositoryId)
    if (!repository || repository.kind === 'scratch')
      throw new HttpError(404, 'Choose a project first')
    const defaults = this.store.taskDefaults(repository.id)
    const saved = input.agentId
      ? this.store.get().agents.find((agent) => agent.id === input.agentId)
      : undefined
    if (input.agentId && !saved) throw new HttpError(404, 'Codex configuration no longer exists')
    const harness =
      defaults.harness?.provider === 'codex'
        ? defaults.harness
        : {
            ...defaultTaskHarness('codex'),
            permission: 'ask' as const,
          }
    const agent = this.registry.configure(saved ?? { ...harness, id: '', name: 'Codex' })
    if (agent.provider !== 'codex') throw new HttpError(400, 'Choose a Codex configuration')
    const configured = await this.registry.secretReferences.resolve(agent)
    const env = processEnvironment(configured.env)
    const userHome = (process.platform === 'win32' ? env.USERPROFILE : env.HOME) || homedir()
    // configure() expands configDirectory and maps it into CODEX_HOME before resolving
    // secret environment references. Use the same effective home as the native launch.
    const home = await canonical(
      env.CODEX_HOME?.trim() || configured.configDirectory?.trim() || join(userHome, '.codex'),
    )
    const root = await canonical(repository.path)
    const roots = [root]
    if (!repository.kind && (await this.git.isRepository(root))) {
      const records = worktreeRecords(
        await this.git.command(root, ['worktree', 'list', '--porcelain', '-z']),
      )
      for (const record of records) if (record.path) roots.push(await canonical(record.path))
    }
    return { repository, agent, home, roots }
  }

  private owner(id: string, key: string) {
    return this.store
      .get()
      .tasks.find(
        (task) =>
          task.importedCodexSession?.key === key ||
          (resolveTaskAgent(task, this.store.get().agents)?.provider === 'codex' &&
            (task.sessionId === id ||
              task.subagents?.some((child) => child.id === id || child.sessionId === id))),
      )
  }

  private async discover(source: Source) {
    const sessions: Candidate[] = []
    let visited = 0,
      inspected = 0,
      limited = false
    const base = join(source.home, 'sessions')
    const walk = async (directory: string, depth: number): Promise<void> => {
      let entries: { name: string; directory: boolean; file: boolean }[] = []
      try {
        const handle = await opendir(directory)
        for await (const entry of handle) {
          if (++visited > 6000) {
            limited = true
            break
          }
          if (!entry.isSymbolicLink())
            entries.push({ name: entry.name, directory: entry.isDirectory(), file: entry.isFile() })
        }
      } catch (error) {
        if (missing(error)) return
        throw error
      }
      entries = entries.sort((a, b) => b.name.localeCompare(a.name))
      for (const entry of entries) {
        if (inspected >= 400) {
          limited = true
          break
        }
        const path = join(directory, entry.name)
        if (entry.directory && depth < 3 && visited <= 6000 && /^\d{2,4}$/.test(entry.name))
          await walk(path, depth + 1)
        if (!entry.file || !entry.name.endsWith('.jsonl')) continue
        inspected++
        const resolved = await realpath(path).catch((error: unknown) => {
          if (!missing(error)) throw error
        })
        if (!resolved || !within(await canonical(base), resolved)) continue
        let content: Awaited<ReturnType<typeof readCodexSessionHeader>>
        try {
          content = await readCodexSessionHeader(resolved)
        } catch (error) {
          if (missing(error)) continue
          throw error
        }
        const metadata = codexSessionMetadata(content.text.split('\n', 1)[0] ?? '')
        if (!metadata || !isAbsolute(metadata.cwd)) continue
        const cwd = await canonical(metadata.cwd)
        if (!source.roots.some((root) => within(root, cwd))) continue
        const key = keyFor(source.home, metadata.id)
        if (sessions.some((session) => session.key === key)) continue
        sessions.push({
          key,
          sessionId: metadata.id,
          cwd,
          title: `Codex · ${metadata.id.slice(0, 8)}`,
          model: '',
          updatedAt: content.info.mtime.toISOString(),
          path: resolved,
          taskId: this.owner(metadata.id, key)?.id,
        })
      }
    }
    await walk(base, 0)
    return {
      sessions: sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      limited,
    }
  }

  async list(input: CodexSessionDiscovery) {
    const { sessions, limited } = await this.discover(await this.source(input))
    return {
      sessions: sessions.map(({ path: _path, ...session }) => session),
      notice: limited
        ? 'Showing matches from the latest 400 inspected transcripts. Discovery is bounded.'
        : undefined,
    }
  }

  private async selected(input: CodexSessionSelection) {
    const source = await this.source(input)
    const candidate = (await this.discover(source)).sessions.find(
      (session) => session.key === input.key,
    )
    if (!candidate)
      throw new HttpError(404, 'This Codex session is no longer available in the selected project')
    const { text, info } = await readCodexTranscript(candidate.path)
    const transcript = parseCodexTranscript(text)
    if (
      transcript.id !== candidate.sessionId ||
      (await canonical(transcript.cwd)) !== candidate.cwd
    )
      throw new HttpError(409, 'The Codex transcript changed. Preview it again')
    const { path: _path, ...summary } = candidate
    const session = {
      ...summary,
      model: transcript.model,
      title: transcript.title || summary.title,
    }
    const owner = this.owner(session.sessionId, session.key)
    let status: CodexSessionPreview['status'] = 'available'
    let notice = transcript.interrupted
      ? 'The previous process ended during a turn. Import saves its history without replaying that turn.'
      : 'Import saves history without running Codex. Send a new message to continue the native session.'
    if (owner) {
      status = 'owned'
      notice = 'This session already belongs to a Dovo thread. Open that thread instead.'
    } else if (
      !(
        await stat(session.cwd).catch((error: unknown) => {
          if (!missing(error)) throw error
        })
      )?.isDirectory()
    ) {
      status = 'missing-checkout'
      notice = 'The original checkout is missing. Restore it before importing this session.'
    } else {
      const activity = await codexSessionActivity(candidate.path)
      if (activity === 'active' || Date.now() - info.mtimeMs < 2000) {
        status = 'active'
        notice =
          'Codex still owns this session or wrote to it recently. Exit its terminal session, then refresh the preview.'
      } else if (activity === 'unknown') {
        status = 'unknown'
        notice =
          'Native session ownership could not be checked on this computer. Import is unavailable; history can still be previewed.'
      }
    }
    const latest = await stat(candidate.path)
    if (latest.size !== info.size || latest.mtimeMs !== info.mtimeMs)
      throw new HttpError(
        409,
        'The Codex transcript changed during preview. Close Codex and preview it again',
      )
    const preview: CodexSessionPreview = {
      session: { ...session, taskId: owner?.id },
      status,
      notice,
      revision: transcript.revision,
      messages: transcript.messages
        .slice(-100)
        .map((message) => ({ ...message, text: message.text.slice(0, 16000) })),
      olderMessages: Math.max(0, transcript.messages.length - 100),
    }
    return { source, candidate, transcript, preview }
  }

  async preview(input: CodexSessionSelection) {
    return (await this.selected(input)).preview
  }

  async import(input: CodexSessionImport) {
    const existing = this.store
      .get()
      .tasks.find((task) => task.importedCodexSession?.key === input.key)
    if (existing) {
      if (existing.repositoryId !== input.repositoryId)
        throw new HttpError(409, 'This import belongs to another project')
      return { id: existing.id, existing: true }
    }
    const { source, candidate, transcript, preview } = await this.selected(input)
    // No awaits between the final ownership check and the atomic workspace/history write.
    const owner = this.owner(candidate.sessionId, input.key)
    if (owner) {
      if (owner.importedCodexSession?.key === input.key) {
        if (owner.repositoryId !== input.repositoryId)
          throw new HttpError(409, 'This import belongs to another project')
        return { id: owner.id, existing: true }
      }
      throw new HttpError(409, 'This session already belongs to a Dovo thread')
    }
    if (preview.revision !== input.revision)
      throw new HttpError(409, 'The session changed since preview. Preview it again')
    if (preview.status !== 'available') throw new HttpError(409, preview.notice)
    if (!transcript.messages.length)
      throw new HttpError(409, 'There are no conversation messages to import')
    if (!this.store.get().repositories.some((repository) => repository === source.repository))
      throw new HttpError(409, 'The selected project changed. Discover sessions again')
    const now = new Date().toISOString(),
      id = randomUUID()
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
      providerLock: 'codex',
      harness: decode(taskHarnessSchema, {
        ...source.agent,
        configDirectory: source.home,
        model: transcript.model || source.agent.model,
        reasoning: transcript.reasoning || source.agent.reasoning,
      }),
      messages: transcript.messages,
      consumedMessageIds: transcript.messages.map((message) => message.id),
      files: [],
      draft: '',
      example: false,
      queuePaused: true,
      sessionId: transcript.id,
      importedCodexSession: {
        key: input.key,
        sessionId: transcript.id,
        home: source.home,
        transcriptPath: candidate.path,
        cwd: candidate.cwd,
        importedAt: now,
      },
    }
    this.store.update((workspace) => ({ ...workspace, tasks: [...workspace.tasks, task] }))
    return { id, existing: false }
  }
}

/** Recheck on explicit continuation after a restart; no native session may be stolen. */
export async function requireImportedCodexSession(
  task: Pick<Task, 'importedCodexSession' | 'sessionId'>,
) {
  const imported = task.importedCodexSession
  if (!imported || task.sessionId !== imported.sessionId) return
  if (
    !(
      await stat(imported.cwd).catch((error: unknown) => {
        if (!missing(error)) throw error
      })
    )?.isDirectory()
  )
    throw new HttpError(
      409,
      'The imported Codex checkout is missing. Restore its original path to continue',
    )
  const file = await realpath(imported.transcriptPath).catch((error: unknown) => {
    if (!missing(error)) throw error
  })
  if (!file || !within(await canonical(join(imported.home, 'sessions')), file))
    throw new HttpError(409, 'The imported Codex transcript is missing. Restore it to continue')
  const metadata = codexSessionMetadata((await readCodexSessionHeader(file)).text)
  if (
    !metadata ||
    metadata.id !== imported.sessionId ||
    (await canonical(metadata.cwd)) !== imported.cwd
  )
    throw new HttpError(
      409,
      'The imported Codex transcript identity changed. Continuation is paused',
    )
  const activity = await codexSessionActivity(file)
  if (activity !== 'inactive')
    throw new HttpError(
      409,
      activity === 'active'
        ? 'The imported Codex session is open in another process. Exit that session before sending'
        : 'Native Codex session ownership could not be checked. Continuation is paused',
    )
}
