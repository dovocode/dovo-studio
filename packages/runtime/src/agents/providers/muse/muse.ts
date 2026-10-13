import { existsSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { Session, spawnMspConnection, readSessionDurability } from '@muse-code/sdk'
import { Schema } from 'effect'
import {
  decode,
  mutableArray,
  mutableStruct,
  questionPromptSchema,
  isImageAttachment,
  nativeAgentWorking,
  type Subagent,
} from '@dovo/protocol'
import type { AgentDiscovery } from '@dovo/protocol'
import type { AgentAdapter, AgentRun } from '../../execution/types.js'
import { exec, processEnvironment } from '../../../process.js'
import { mcpHeaders, mcpServerEnvironment } from '../../configuration/mcp-settings.js'
import { updateSubagents } from '../../execution/subagents.js'
import { IdleProviders, releaseIdleProvider } from '../../execution/warm-processes.js'
import { nativeObject as object, nativeText as text, nativeWait } from '../shared/native.js'

const clientInfo = { name: 'dovo_studio', version: '0.1.0' }

const rows = mutableStruct({
  providerId: Schema.optional(Schema.String),
  models: mutableArray(
    mutableStruct({
      modelId: Schema.String,
      providerId: Schema.String,
      displayLabel: Schema.String,
      variants: Schema.optional(
        Schema.Union([mutableArray(Schema.String), Schema.Literal('unknown')]),
      ),
      isDefault: Schema.optional(Schema.Boolean),
      defaultReasoningEffort: Schema.optional(Schema.String),
      reasoningEffortVariants: Schema.optional(
        mutableArray(
          mutableStruct({
            tier: Schema.String,
            description: Schema.optional(Schema.String),
          }),
        ),
      ),
    }),
  ),
})
export const REASONING_EFFORT_LABELS: Record<string, string> = {
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  ultra: 'Ultra',
}
const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const FALLBACK_DEFAULT_EFFORT = 'high'
type MuseCatalogRow = {
  modelId: string
  providerId: string
  displayLabel: string
  variants?: string[] | 'unknown'
  isDefault?: boolean
  defaultReasoningEffort?: string
  reasoningEffortVariants?: Array<{ tier: string; description?: string }>
}
export function museReasoningOptions(
  row?: Pick<MuseCatalogRow, 'variants' | 'defaultReasoningEffort' | 'reasoningEffortVariants'>,
): {
  defaultEffort: string | undefined
  reasoning: Array<{ id: string; name: string; description?: string }>
} {
  const reported = row?.variants !== undefined && row.variants !== 'unknown'
  const efforts: string[] = (reported ? (row.variants as string[]) : FALLBACK_EFFORTS).filter(
    (id: string) => id in REASONING_EFFORT_LABELS,
  )
  const preferred = reported ? row.defaultReasoningEffort : FALLBACK_DEFAULT_EFFORT
  const defaultEffort = efforts.find((id: string) => id === preferred) ?? efforts[0]
  return {
    defaultEffort,
    reasoning: efforts.map((id: string) => {
      const description = row?.reasoningEffortVariants?.find(
        (variant) => variant.tier === id,
      )?.description
      return {
        id,
        name: REASONING_EFFORT_LABELS[id] ?? id,
        ...(description ? { description } : {}),
      }
    }),
  }
}
export function resolveMuseReasoningEffort(
  row: Pick<MuseCatalogRow, 'variants' | 'defaultReasoningEffort' | 'reasoningEffortVariants'>,
  effort: string | undefined,
): string | undefined {
  const { reasoning, defaultEffort } = museReasoningOptions(row)
  if (!effort) return defaultEffort
  return reasoning.some((option) => option.id === effort) ? effort : defaultEffort
}
const promptSchema = mutableStruct({
  userInputId: Schema.String,
  questions: mutableArray(
    mutableStruct({
      id: Schema.String,
      header: Schema.String,
      question: Schema.String,
      options: mutableArray(
        mutableStruct({ label: Schema.String, description: Schema.optional(Schema.String) }),
      ),
      selection: mutableStruct({
        mode: Schema.Literals(['single', 'multiple']),
        minSelections: Schema.optional(Schema.Number),
        maxSelections: Schema.optional(Schema.Number),
      }),
    }),
  ),
})
export function museServeArgs(options: {
  readOnly?: boolean
  fullAccess?: boolean
  sessionLogging?: boolean
}) {
  const args = ['serve']
  if (options.readOnly) {
    args.push('--disable-shell', '--disable-write')
    // Read-only generation still needs item notifications, which Muse only
    // emits with its session log enabled.
    if (options.sessionLogging !== true) args.push('--no-session-log')
  } else {
    args.push('--trust-workspace')
    if (options.fullAccess) args.push('--disable-sandbox')
  }
  return args
}
/**
 * How to start Muse on Windows. The SDK spawns without a shell, which neither
 * resolves a bare `muse` through PATHEXT nor runs a `.cmd`/`.bat` launcher
 * (Muse's own Windows launcher is one), so resolve the binary through PATH
 * and PATHEXT and run script launchers under cmd.exe. Everywhere else the
 * binary runs as given.
 */
export function museLaunch(
  binaryPath: string,
  platform: NodeJS.Platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
  pathExists: (path: string) => boolean = existsSync,
): { command: string; args: string[] } {
  if (platform !== 'win32') return { command: binaryPath, args: [] }
  const envValue = (name: string) => {
    const key = Object.keys(environment).find(
      (candidate) => candidate.toUpperCase() === name.toUpperCase(),
    )
    return key === undefined ? undefined : environment[key]
  }
  const resolved = resolveWindowsExecutable(binaryPath, envValue, pathExists) ?? binaryPath
  if (!/\.(?:cmd|bat)$/i.test(resolved)) return { command: resolved, args: [] }
  const systemRoot = envValue('SystemRoot')
  return {
    command: envValue('ComSpec') ?? (systemRoot ? `${systemRoot}\\System32\\cmd.exe` : 'cmd.exe'),
    // /d skips cmd's AutoRun commands, which could write into Muse's stdout.
    // cmd /c drops the quotes from a command that starts with one and holds
    // `&`, `@`, `^` or a parenthesis, so a quoted path follows a bare `@`
    // (echo off), which keeps them; an unquoted path escapes them instead.
    args: [
      '/d',
      '/c',
      ...(/\s/.test(resolved) ? ['@', resolved] : [resolved.replace(/[()&<>@^|]/g, '^$&')]),
    ],
  }
}
/** Windows' verbatim form of a canonical path: `\\?\C:\…`, or `\\?\UNC\server\share\…`. */
export function museVerbatimPath(path: string) {
  if (path.startsWith('\\\\?\\')) return path
  return path.startsWith('\\\\') ? `\\\\?\\UNC\\${path.slice(2)}` : `\\\\?\\${path}`
}
/**
 * A workspace root in the form `session/start` accepts. On Windows Muse
 * rejects anything but the verbatim canonical path, true case and long names
 * included, so resolve with the native realpath. Muse itself still starts in
 * the plain path: the `muse.cmd` launcher runs under cmd.exe, which cannot
 * use a verbatim directory.
 */
export async function museWorkspaceRoot(
  path: string,
  platform: NodeJS.Platform = process.platform,
) {
  if (platform !== 'win32') return path
  const canonical = await realpath(path).catch(() => path.replaceAll('/', '\\'))
  return museVerbatimPath(canonical)
}
function resolveWindowsExecutable(
  binaryPath: string,
  envValue: (name: string) => string | undefined,
  pathExists: (path: string) => boolean,
) {
  const hasDirectory = /[\\/]/.test(binaryPath)
  const extensions = (envValue('PATHEXT') ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
  const candidates = (base: string) =>
    /\.[A-Za-z0-9]+$/.test(base.split('\\').at(-1) ?? '')
      ? [base]
      : extensions.map((extension) => base + extension)
  if (hasDirectory) return candidates(binaryPath).find(pathExists)
  for (const directory of (envValue('PATH') ?? '').split(';').filter(Boolean))
    for (const candidate of candidates(`${directory}\\${binaryPath}`))
      if (pathExists(candidate)) return candidate
  return undefined
}
function launch(
  agent: AgentDiscovery,
  cwd: string,
  options: { readOnly?: boolean; fullAccess?: boolean; sessionLogging?: boolean } = {},
) {
  const env = { ...processEnvironment(agent.env), MUSE_NO_AUTO_UPDATE: '1' }
  const resolved = museLaunch(agent.endpoint || 'muse', process.platform, env)
  return spawnMspConnection({
    command: resolved.command,
    args: [...resolved.args, ...(agent.args?.length ? agent.args : museServeArgs(options))],
    cwd,
    env,
    connection: { frameLimitBytes: 32 * 1024 * 1024 },
  })
}
export type MuseSelection = { providerId: string; modelId: string }
export function museSelection(model: string): MuseSelection | undefined {
  if (!model) return undefined
  try {
    const selected: unknown = JSON.parse(model)
    return decode(mutableStruct({ providerId: Schema.String, modelId: Schema.String }), selected)
  } catch {
    // A bare model id is a custom model Muse resolves itself (for accounts
    // that cannot use the listed catalog); keep Dovo's provider qualifier.
    return { providerId: 'meta', modelId: model }
  }
}
export type MuseApprovalRequest = {
  toolName?: string
  subagentOrigin?: { subagentId: string }
  rawArgs: string
  subject?: {
    kind: string
    command?: string
    path?: string
    host?: string
    target?: string
    toolName?: string
  }
  availableChoices: Array<{ choiceId: string; decision: string; scope: string; label: string }>
}
export function museApprovalTitle(request: MuseApprovalRequest) {
  const subject = request.subject
  const detail =
    subject?.command ?? subject?.path ?? subject?.host ?? subject?.target ?? subject?.toolName
  const kind = !subject
    ? 'tool'
    : subject.kind === 'shell'
      ? 'shell command'
      : subject.kind === 'fileAccess'
        ? 'file access'
        : subject.kind === 'network'
          ? 'network request'
          : subject.kind
  return detail ? `Muse ${kind}: ${detail}` : `Muse ${kind} request`
}
export function museApprovalScopes(request: MuseApprovalRequest) {
  const approved = request.availableChoices.filter(
    (choice) =>
      choice.decision === 'approved' ||
      choice.decision === 'approvedForSession' ||
      choice.decision === 'approvedPolicyAmendment',
  )
  return {
    session: approved.some(
      (choice) => choice.decision === 'approvedForSession' || choice.scope === 'session',
    ),
    always: approved.some(
      (choice) =>
        choice.decision === 'approvedPolicyAmendment' || choice.scope === 'localPersistent',
    ),
  }
}
export function museApprovalChoice(
  request: MuseApprovalRequest,
  decision: 'approve' | 'session' | 'always' | 'deny',
) {
  const choices = request.availableChoices
  const rank = (choice: MuseApprovalRequest['availableChoices'][number]) =>
    (choice.scope === 'once' ? 0 : choice.scope === 'session' ? 2 : 4) +
    (choice.decision.endsWith('PolicyAmendment') ? 1 : 0)
  const pick = (candidates: MuseApprovalRequest['availableChoices']) =>
    candidates.sort((a, b) => rank(a) - rank(b))[0]
  if (decision === 'deny')
    return (
      choices.find((choice) => choice.decision === 'denied') ??
      choices.find((choice) => choice.decision === 'abort')
    )
  if (decision === 'session')
    return pick(
      choices.filter(
        (choice) =>
          choice.decision === 'approvedForSession' ||
          (choice.decision === 'approvedPolicyAmendment' && choice.scope === 'session') ||
          (choice.decision === 'approved' && choice.scope === 'session'),
      ),
    )
  if (decision === 'always')
    return pick(
      choices.filter(
        (choice) =>
          choice.decision === 'approvedPolicyAmendment' || choice.scope === 'localPersistent',
      ),
    )
  return pick(
    choices.filter(
      (choice) =>
        choice.decision === 'approved' ||
        choice.decision === 'approvedForSession' ||
        choice.decision === 'approvedPolicyAmendment',
    ),
  )
}
export function parseMuseVersion(output: string) {
  return output.match(/(\d+\.\d+\.\d+(?:-[A-Za-z0-9.]+)?)/)?.[1]
}
export function createMuseAdapter(): AgentAdapter {
  const idle = new IdleProviders<{
    sessionId: string
    config: string
    resume: (run: AgentRun) => Promise<void>
    close: () => Promise<void>
    working: () => boolean
  }>(
    (session) => session.close(),
    (session) => session.working(),
  )
  return {
    releaseTask: (taskId) => idle.release(taskId),
    dispose: async () => {
      const sessions = [...idle.values()]
      idle.clear()
      await Promise.all(sessions.map((session) => session.close()))
    },
    async models(agent) {
      const host = launch(agent, homedir(), { readOnly: true })
      try {
        const ready = await nativeWait(
          host.initialize({ clientInfo }),
          new AbortController().signal,
          30000,
        )
        const catalog = decode(
          rows,
          await nativeWait(
            ready.connection.request('model/list'),
            new AbortController().signal,
            30000,
          ),
        )
        if (catalog.providerId !== undefined && catalog.providerId !== 'meta')
          throw new Error('Muse returned a model catalog for another provider')
        const seen = new Set<string>()
        const models = catalog.models.flatMap((row) => {
          if (row.providerId !== 'meta' || seen.has(row.modelId)) return []
          seen.add(row.modelId)
          const options = museReasoningOptions(row)
          return [
            {
              id: JSON.stringify({ providerId: row.providerId, modelId: row.modelId }),
              name: row.displayLabel.trim() || row.modelId,
              description: row.providerId,
              isDefault: row.isDefault,
              defaultReasoning: options.defaultEffort,
              reasoning: options.reasoning,
            },
          ]
        })
        return {
          models,
          reasoning: [
            ...new Map(
              models.flatMap((model) =>
                model.reasoning.map((effort: { id: string; name: string }) => [
                  effort.id,
                  { id: effort.id, name: effort.name },
                ]),
              ),
            ).values(),
          ],
        }
      } finally {
        await host.close()
      }
    },
    async probe(agent) {
      let version: string | undefined
      try {
        const output = await exec(agent.endpoint || 'muse', ['--version'], {
          timeout: 5000,
          env: { ...processEnvironment(agent.env), MUSE_NO_AUTO_UPDATE: '1' },
          maxBuffer: 1024 * 1024,
        })
        version = parseMuseVersion(`${output.stdout}\n${output.stderr}`)
      } catch {
        // The MSP handshake below reports the actionable failure.
      }
      const host = launch(agent, homedir())
      try {
        const ready = await nativeWait(
          host.initialize({
            clientInfo,
            capabilities: { requestedCapabilities: ['sessionMcp'] },
          }),
          new AbortController().signal,
          30000,
        )
        const granted = ready.initializeResult.grantedCapabilities.includes('sessionMcp')
        // MSP exposes no auth signal, so never claim the user is signed in.
        return {
          provider: 'muse',
          available: granted,
          detail: granted
            ? `Muse${version ? ` ${version}` : ''} native MSP host is ready. Sign-in status cannot be verified over MSP; run muse login on this runtime if turns fail.`
            : 'Update Muse to a host that grants sessionMcp for Dovo tools.',
        }
      } catch (error) {
        return {
          provider: 'muse',
          available: false,
          detail: error instanceof Error ? error.message : String(error),
        }
      } finally {
        await host.close()
      }
    },
    async run(inputRun) {
      let run = inputRun
      const config = JSON.stringify([run.agent, run.cwd, run.tools], (key, value: unknown) =>
        key === 'DOVO_TASK_RUN_ID' ? undefined : value,
      )
      const previous = run.taskId ? idle.get(run.taskId) : undefined
      if (previous && previous.sessionId === run.sessionId && previous.config === config) {
        if (run.taskId) idle.delete(run.taskId)
        await previous.resume(run)
        if (run.taskId) idle.set(run.taskId, previous)
        await idle.prune(releaseIdleProvider())
        return
      }
      if (previous) {
        if (previous.working())
          throw new Error('Stop native Muse agents before changing their session configuration')
        await previous.close()
        if (run.taskId) idle.delete(run.taskId)
      }
      run.signal.throwIfAborted()
      const readOnly = run.tools === 'none' || run.agent.permission === 'read-only'
      const host = launch(run.agent, run.cwd, {
          readOnly,
          fullAccess: run.agent.permission === 'full-access',
          // Utility turns still need item notifications to stream their reply.
          sessionLogging: run.tools === 'none',
        }),
        lifetime = new AbortController()
      let signal = AbortSignal.any([run.signal, lifetime.signal])
      let session: Session | undefined,
        turnId = '',
        active = false,
        current = ''
      let nativeAgents: Subagent[] = []
      let succeeded = false
      let connection: Awaited<ReturnType<typeof host.initialize>> | undefined
      const sent = new Map<string, string>(),
        waitingInputs = new Map<string, AbortController>()
      let reject: (error: unknown) => void = () => {},
        resolveCompact: () => void = () => {}
      const failed = new Promise<never>((_, no) => {
        reject = no
      })
      void failed.catch(() => {})
      const buffered: Array<{ method: string; params?: unknown }> = []
      const answer = async (raw: unknown) => {
        const params = decode(promptSchema, raw)
        if (waitingInputs.has(params.userInputId) || !session || !connection) return
        const controller = new AbortController()
        waitingInputs.set(params.userInputId, controller)
        const scoped = AbortSignal.any([signal, controller.signal])
        try {
          const ask = active ? run.ask : run.nativeAgentInteractions?.ask
          if (!ask) return
          const answers = await ask(
            decode(questionPromptSchema, {
              title: 'Muse needs your input',
              questions: params.questions.map((question) => ({
                id: question.id,
                header: question.header,
                question: question.question,
                options: question.options.map((option) => ({
                  value: option.label,
                  label: option.label,
                  description: option.description,
                })),
                custom: true,
                multiple: question.selection.mode === 'multiple',
              })),
            }),
            scoped,
            (values) => {
              for (const question of params.questions) {
                const selected = values[question.id] ?? []
                if (
                  question.selection.maxSelections !== undefined &&
                  selected.length > question.selection.maxSelections
                )
                  throw new Error('Too many answers selected')
                if (selected.length < (question.selection.minSelections ?? 1))
                  throw new Error('Answer every Muse question')
              }
            },
          )
          if (controller.signal.aborted || lifetime.signal.aborted) return
          await nativeWait(
            connection.connection.command(answers ? 'userInput/answer' : 'userInput/cancel', {
              sessionId: session.sessionId,
              userInputId: params.userInputId,
              ...(answers
                ? {
                    answers: params.questions.map((question) => {
                      const selected = answers[question.id] ?? []
                      const free = selected.filter(
                        (value) => !question.options.some((option) => option.label === value),
                      )
                      if (free.length) {
                        if (selected.length !== 1 || free[0].length > 500)
                          throw new Error(
                            'Muse accepts one free-text answer of up to 500 characters',
                          )
                        return { questionId: question.id, freeText: free[0] }
                      }
                      return question.selection.mode === 'multiple'
                        ? { questionId: question.id, selectedLabels: selected }
                        : { questionId: question.id, selectedLabel: selected[0] }
                    }),
                  }
                : {}),
            }),
            scoped,
            30000,
          )
        } finally {
          waitingInputs.delete(params.userInputId)
        }
      }
      const notification = (event: { method: string; params?: unknown }) => {
        if (!session) {
          if (buffered.length >= 10000)
            reject(new Error('Muse session setup produced too many events'))
          else buffered.push(event)
          return
        }
        const params = object(event.params)
        if (params.sessionId !== session.sessionId || lifetime.signal.aborted) return
        try {
          session.apply(event)
          if (event.method === 'userInput/settled')
            waitingInputs.get(text(params.userInputId))?.abort()
          const itemId = text(params.itemId) || text(object(params.item).itemId)
          const folded = session.fold.items.get(itemId)
          if (folded?.kind === 'subagent') {
            const payload = { ...params, item: folded }
            nativeAgents = updateSubagents(
              nativeAgents,
              'muse',
              payload,
              new Date().toISOString(),
              event.method,
              session.sessionId,
            )
            run.onSubagentEvent?.(event.method, payload, session.sessionId)
          }
          if (
            event.method === 'userInput/requested' &&
            (active || nativeAgents.some(nativeAgentWorking))
          )
            void answer(event.params).catch(reject)
          if (!active) return
          run.onEvent?.(event.method, event.params)
          if (event.method === 'turn/retryScheduled') {
            const count = (value: unknown) =>
              typeof value === 'number' && Number.isFinite(value) ? String(value) : '?'
            run.onActivity(
              `Muse is retrying this turn (attempt ${count(params.nextAttempt)} of ${count(params.maxAttempts)}): ${text(params.reason)}`,
            )
          }
          if (event.method.startsWith('item/')) {
            const itemId = text(params.itemId) || text(object(params.item).itemId)
            const item = session.fold.items.get(itemId)
            if (!item || (turnId && item.turnId !== turnId)) return
            if (item.kind === 'agentMessage') {
              const value = session.fold.items.accumulated(itemId, 'text') ?? item.text ?? ''
              const previous = sent.get(itemId) ?? ''
              if (!value.startsWith(previous))
                throw new Error('Muse replaced streamed message text')
              if (value.length > previous.length) {
                if (current && current !== itemId) run.onTextBoundary?.()
                current = itemId
                run.onText(value.slice(previous.length))
                sent.set(itemId, value)
              }
            }
            if (item.kind === 'toolCall' && event.method === 'item/started')
              run.onActivity(`Using ${item.tool || 'tool'}`)
            if (item.kind === 'compaction' && event.method === 'item/completed' && run.compact) {
              if (item.outcome !== 'compacted')
                reject(new Error(item.reason || 'Muse did not install a compacted context'))
              else {
                run.onEvent?.('dovo/compaction/completed', { sessionId: session.sessionId })
                resolveCompact()
              }
            }
          }
        } catch (error) {
          reject(error)
        }
      }
      host.onNotification(notification)
      host.onProtocolError(reject)
      host.onServerRequest(async (request) => {
        throw new Error(`Unsupported Muse server request: ${request.method}`)
      })
      try {
        connection = await nativeWait(
          host.initialize({
            clientInfo,
            capabilities: {
              requestedCapabilities: readOnly ? [] : ['sessionMcp'],
              experimentalApi: false,
              userInputDialogs: true,
            },
          }),
          signal,
          30000,
        )
        if (!readOnly && !connection.initializeResult.grantedCapabilities.includes('sessionMcp'))
          throw new Error('Muse must grant sessionMcp to bind Dovo tools; update your Muse host')
        if (connection.fingerprintWarning)
          run.onActivity(
            'Muse host schema differs from the SDK; using its stable forward-compatible protocol',
          )
        const mcpServers = Object.fromEntries(
          (readOnly ? [] : (run.agent.resources?.mcpServers ?? []))
            .filter((server) => server.enabled)
            .map((server) => [
              server.name,
              server.transport === 'stdio'
                ? {
                    transport: 'stdio',
                    command: server.command,
                    args: server.args,
                    env: mcpServerEnvironment(server),
                  }
                : { transport: 'streamableHttp', url: server.url, headers: mcpHeaders(server) },
            ]),
        )
        const model = museSelection(run.agent.model)
        const workspaceRoot = run.sessionId ? run.cwd : await museWorkspaceRoot(run.cwd)
        const response = await nativeWait(
          connection.connection.command(
            run.sessionId ? 'session/resume' : 'session/start',
            run.sessionId
              ? { sessionId: run.sessionId, excludeItems: true, config: { mcpServers } }
              : {
                  workspaceRoot,
                  ...(model ? { providerId: model.providerId, modelId: model.modelId } : {}),
                  approvalMode:
                    run.agent.permission === 'full-access' ? 'allowAll' : 'promptUnmatched',
                  config: { mcpServers },
                },
          ),
          signal,
          30000,
        )
        const identity = text(object(response.session).sessionId)
        if (!identity) throw new Error('Muse did not return a session identity')
        session = new Session({
          sessionId: identity,
          durability: readSessionDurability(connection.initializeResult),
          connection: connection.connection,
        })
        void connection.connection.closed
          .then(async () => {
            session?.hostExited({ kind: 'transportEof' })
            const error = new Error('Muse connection closed before the turn completed')
            lifetime.abort(error)
            reject(error)
            await host.close()
            if (session) run.onSubagentEvent?.('dovo/session/closed', {}, session.sessionId)
            if (run.taskId) idle.delete(run.taskId)
          })
          .catch((error) => console.error('Could not drain exited Muse host:', error))
        void host.exited.then((exit) => {
          const tail = host.child.stderrTail.slice(-8).join('').trim()
          reject(
            new Error(
              `Muse host exited (${exit.code ?? exit.signal})${tail ? `: ${tail.slice(-500)}` : ''}`,
            ),
          )
        })
        run.onSession(identity)

        session.onApproval(async (request) => {
          const automatic = run.agent.permission === 'full-access'
          const interactions = run.nativeAgentInteractions
          const native =
            request.subagentOrigin &&
            nativeAgents.some(
              (agent) =>
                agent.id === request.subagentOrigin?.subagentId && nativeAgentWorking(agent),
            )
          const approve = native
            ? interactions &&
              ((
                title: string,
                detail: string,
                kind?: 'web',
                options?: { session?: boolean; always?: boolean },
              ) => interactions.approve(title, detail, lifetime.signal, kind, options))
            : active
              ? run.approve
              : undefined
          const scopes = museApprovalScopes(request)
          const decision =
            lifetime.signal.aborted || approve === undefined
              ? ('deny' as const)
              : automatic
                ? ('approve' as const)
                : await nativeWait(
                    approve(museApprovalTitle(request), request.rawArgs, undefined, scopes),
                    signal,
                  )
          const choice = museApprovalChoice(request, decision)
          if (!choice)
            throw new Error(
              decision === 'deny'
                ? 'Muse did not offer a denial choice'
                : `Muse did not offer a ${decision} approval choice`,
            )
          return { choiceId: choice.choiceId }
        })
        session.onApprovalError((failure) =>
          reject(new Error(`Muse approval failed: ${JSON.stringify(failure)}`)),
        )
        session.onGapError((failure) =>
          reject(
            new Error(`Muse event history could not be recovered: ${JSON.stringify(failure)}`),
          ),
        )
        for (const event of buffered) notification(event)
        if (run.sessionId) {
          if (
            text(object(response.session).workspaceRoot) &&
            text(object(response.session).workspaceRoot) !== run.cwd
          )
            throw new Error('Muse session belongs to another workspace; start a new thread')
          await nativeWait(
            connection.connection.command('session/setApprovalMode', {
              sessionId: identity,
              mode: run.agent.permission === 'full-access' ? 'allowAll' : 'promptUnmatched',
            }),
            signal,
            30000,
          )
          if (model)
            await nativeWait(
              connection.connection.command('session/setModel', {
                sessionId: identity,
                model,
              }),
              signal,
              30000,
            )
        }
        if (!readOnly) {
          // Validate a saved effort against the live catalog so a stale pick
          // falls back to the model's default instead of failing the turn.
          let effort = run.agent.reasoning
          if (effort) {
            try {
              const catalog = decode(
                rows,
                await nativeWait(connection.connection.request('model/list'), signal, 30000),
              )
              const row = model
                ? catalog.models.find(
                    (entry) =>
                      entry.providerId === model.providerId && entry.modelId === model.modelId,
                  )
                : catalog.models.find((entry) => entry.isDefault)
              if (row) effort = resolveMuseReasoningEffort(row, effort)
            } catch {
              // Catalog unavailable: keep the saved effort rather than fail.
            }
          }
          if (effort)
            await nativeWait(
              connection.connection.command('session/setReasoningEffort', {
                sessionId: identity,
                reasoningEffort: effort,
              }),
              signal,
              30000,
            )
        }
        const stopNative = async (id?: string) => {
          if (!connection) throw new Error('Muse connection is unavailable')
          for (const agent of nativeAgents.filter(
            (agent) => nativeAgentWorking(agent) && (!id || agent.id === id),
          ))
            await nativeWait(
              connection.connection.command('subagent/stop', {
                sessionId: identity,
                subagentId: agent.id,
              }),
              lifetime.signal,
              30000,
            )
        }
        const turnSession = session
        const turnConnection = connection
        const execute = async (next: AgentRun) => {
          run = next
          run.onNativeSession?.({ stop: stopNative }, identity)
          signal = AbortSignal.any([run.signal, lifetime.signal])
          const compactCompletion = new Promise<void>((yes) => {
            resolveCompact = yes
          })
          sent.clear()
          current = ''
          turnId = ''
          active = true
          if (next !== inputRun) run.onSession(identity)
          try {
            if (run.compact) {
              const result = await nativeWait(
                turnConnection.connection.command('session/compact', { sessionId: identity }),
                signal,
                30000,
              )
              if (result.status === 'noop')
                throw new Error(text(result.reason) || 'Muse has no compactable history')
              await nativeWait(Promise.race([compactCompletion, failed]), signal)
            } else {
              const input = (prompt: string, attachments = run.attachments) => [
                { type: 'text' as const, text: prompt },
                ...(attachments ?? []).filter(isImageAttachment).map((file) => ({
                  type: 'image' as const,
                  mediaType: file.mime,
                  base64Data: file.data,
                })),
              ]
              const turn = await nativeWait(
                turnSession.sendUserTurn({
                  input: input([run.agent.instructions, run.prompt].filter(Boolean).join('\n\n')),
                  ifBusy: 'queue',
                }),
                signal,
                30000,
              )
              turnId = turn.turnId
              run.onPromptAccepted?.()
              const rpc = turnConnection.connection
              run.onSteer?.(async (value) => {
                if (!active || signal.aborted) throw new Error('This Muse turn has ended')
                const result = await nativeWait(
                  rpc.command('turn/steer', {
                    sessionId: identity,
                    expectedTurnId: turnId,
                    input: input(value.prompt, value.attachments ?? []),
                  }),
                  signal,
                  30000,
                )
                if (result.turnId !== turnId || result.status !== 'accepted')
                  throw new Error('Muse did not accept steering for this turn')
              })
              const outcome = await nativeWait(Promise.race([turn.completed, failed]), signal)
              if (outcome.kind !== 'completed' || outcome.params.terminal !== 'completed')
                throw new Error(
                  outcome.kind === 'completed'
                    ? outcome.params.error?.message || `Muse turn ${outcome.params.terminal}`
                    : `Muse turn ${outcome.kind}`,
                )
            }
          } finally {
            active = false
            run.onNativeTurnEnd?.()
            run.onSteer?.(undefined)
          }
        }
        await execute(run)
        succeeded = true
        if (run.taskId) {
          const taskId = run.taskId
          const warm = {
            sessionId: identity,
            config,
            working: () => nativeAgents.some(nativeAgentWorking),
            close: async () => {
              idle.delete(taskId)
              lifetime.abort()
              for (const question of waitingInputs.values()) question.abort()
              await host.close()
              run.onSubagentEvent?.('dovo/session/closed', {}, identity)
            },
            resume: async (next: AgentRun) => {
              try {
                await execute(next)
              } catch (error) {
                await warm.close()
                throw error
              }
            },
          }
          idle.set(taskId, warm)
          await idle.prune(releaseIdleProvider())
        }
      } finally {
        active = false
        if (!succeeded || !run.taskId) lifetime.abort()
        run.onSteer?.(undefined)
        if (!succeeded || !run.taskId)
          for (const question of waitingInputs.values()) question.abort()
        if (run.signal.aborted && connection && session && turnId)
          await nativeWait(
            connection.connection.command('turn/interrupt', {
              sessionId: session.sessionId,
              turnId,
            }),
            new AbortController().signal,
            2000,
          ).catch((error) =>
            run.onActivity(
              `Muse interrupt: ${error instanceof Error ? error.message : String(error)}`,
            ),
          )
        if (!succeeded || !run.taskId) {
          await host.close()
          if (session) run.onSubagentEvent?.('dovo/session/closed', {}, session.sessionId)
        }
      }
    },
  }
}
