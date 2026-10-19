import { threadSnapshot } from './thread-snapshot.js'
import { randomUUID } from 'node:crypto'
import { Effect, Schema } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import {
  decode,
  mutableStruct,
  studioThreadsCommandSchema,
  studioAutomationsCommandSchema,
  studioUICommandSchema,
  studioDiagnosticsCommandSchema,
  enabledStudioTools,
  automationIssues,
  resolveTaskAgent,
  permissionPolicyWithinCeiling,
  studioToolSettings,
  type Task,
  type Automation,
  type StudioToolPart,
} from '@dovo/protocol'
import type { Services } from '../services.js'
import { RuntimeServices } from '../services.js'
import type { RunPolicy } from '../auth/run-credentials.js'
import { HttpError } from '../errors.js'
import { patchWorkspace } from '../http/endpoints/workspace-patch.js'
import { taskLifecycle } from '../http/endpoints/agents-routes.js'
import { runtimeDiagnostics } from '../http/diagnostics.js'
import { agentBrowserCommandSchema } from '../previews/agent-browser.js'
import { studioSessions } from './ui-sessions.js'

export type StudioPolicy = Pick<RunPolicy, 'permissions' | 'readOnly' | 'studioTools'>

export function requireStudioPart(s: Services, part: string, policy?: StudioPolicy) {
  const enabled = enabledStudioTools(s.preferences.get())
  const setting = studioToolSettings.find((setting) => setting.part === part)
  const allowed =
    part === 'discover'
      ? studioToolSettings.some(
          ({ part }) => enabled[part] && (!policy || policy.studioTools?.[part]),
        )
      : setting && enabled[setting.part] && (!policy || policy.studioTools?.[setting.part])
  if (!allowed)
    throw new HttpError(403, `Studio Tools: ${part} is disabled for this run or runtime`)
}
export function studioReadAction(part: string, action: unknown) {
  return (
    part === 'discover' ||
    (part === 'threads' &&
      ['list', 'read', 'search', 'wait', 'snapshot', 'watches'].includes(String(action))) ||
    (part === 'automations' &&
      ['list', 'read', 'validate', 'runs', 'wait'].includes(String(action))) ||
    (part === 'browsers' && ['list', 'snapshot', 'logs'].includes(String(action))) ||
    (part === 'ui' && ['list', 'snapshot'].includes(String(action))) ||
    part === 'diagnostics'
  )
}
function withinPolicy(
  s: Services,
  task: Pick<Task, 'id' | 'agentId' | 'harness' | 'agentOverrides'>,
  policy?: StudioPolicy,
) {
  if (!policy) return
  const agent = resolveTaskAgent(task, s.store.get().agents)
  if (!agent || !permissionPolicyWithinCeiling(policy.permissions, agent))
    throw new HttpError(403, 'Target thread or automation exceeds this agent’s permissions')
}
function validateFlow(s: Services, flow: Automation, policy?: StudioPolicy) {
  for (const node of flow.nodes) {
    if (node.data.kind !== 'task') continue
    const defaults = s.store.taskDefaults(node.data.repositoryId)
    withinPolicy(
      s,
      {
        ...defaults,
        ...node.data,
        id: node.id,
        harness: node.data.harness ?? (node.data.agentId ? undefined : defaults.harness),
      },
      policy,
    )
  }
  return automationIssues(flow, s.store.get())
}
async function waitFor<T>(
  read: () => T,
  working: (value: T) => boolean,
  timeoutMs: number,
  authorize: () => void,
  signal?: AbortSignal,
) {
  const until = Date.now() + timeoutMs
  let result = read()
  while (working(result) && Date.now() < until) {
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(250, until - Date.now())))
    signal?.throwIfAborted()
    authorize()
    result = read()
  }
  return result
}
export async function studioTool(
  s: Services,
  taskId: string,
  part: string,
  value: unknown,
  authorize: () => void,
  policy?: StudioPolicy,
) {
  const check = () => {
    authorize()
    requireStudioPart(s, part, policy)
  }
  check()
  const input = decode(Schema.Record(Schema.String, Schema.Unknown), value)
  if (policy?.readOnly && !studioReadAction(part, input.action))
    throw new HttpError(403, 'This agent has read-only Studio Tools access')
  const workspace = s.store.get()
  if (part === 'discover') {
    const enabled = enabledStudioTools(s.preferences.get())
    const { repositoryId, agentId } = decode(
      mutableStruct({
        repositoryId: Schema.optional(Schema.String),
        agentId: Schema.optional(Schema.String),
      }),
      value,
    )
    if (repositoryId && !workspace.repositories.some((repo) => repo.id === repositoryId))
      throw new HttpError(404, 'Project not found')
    const agents = s.store.agentsFor(repositoryId)
    if (agentId) {
      const agent = agents.find((agent) => agent.id === agentId)
      if (!agent) throw new HttpError(404, 'Configured agent not found')
      const adapter = await s.agents.get(agent.provider)
      const catalog = adapter.models ? await adapter.models(agent) : { models: [] }
      check()
      return { agentId, catalog }
    }
    return {
      enabled: Object.fromEntries(
        Object.entries(enabled).map(([key, value]) => [
          key,
          value &&
            (!policy ||
              Object.entries(policy.studioTools ?? {}).some(
                ([part, enabled]) => part === key && enabled,
              )),
        ]),
      ),
      projects: workspace.repositories.map(({ id, name }) => ({
        id,
        name,
        defaults: s.store.publicValue(s.store.taskDefaults(id)),
      })),
      agents: agents.map(({ id, name, provider, model, permission }) => ({
        id,
        name,
        provider,
        model,
        permission,
      })),
      note: 'IDs are local to this runtime. UI sessions are live desktop/web sessions. Native mobile UI uses Device Hub.',
    }
  }
  if (part === 'threads') {
    const command = decode(studioThreadsCommandSchema, value)
    if (command.action === 'list') {
      const rows = workspace.tasks.filter(
        (task) => !command.query || task.title.toLowerCase().includes(command.query.toLowerCase()),
      )
      const index = command.before ? rows.findIndex((task) => task.id === command.before) : -1
      if (command.before && index < 0) throw new HttpError(400, 'Unknown thread cursor')
      const items = rows
        .slice(index + 1, index + 51)
        .map(({ id, title, status, repositoryId, agentId, archivedAt, error }) => ({
          id,
          title,
          status,
          repositoryId,
          agentId,
          archivedAt,
          error,
        }))
      return { threads: items, before: rows.length > index + 51 ? items.at(-1)?.id : undefined }
    }
    if (command.action === 'watches' || command.action === 'watch' || command.action === 'unwatch')
      throw new HttpError(400, 'Manage thread watches on the originating runtime')
    if (command.action === 'snapshot') return threadSnapshot(s, command.id)
    if (command.action === 'search') return s.store.searchHistory(command.query, command.id)
    if (command.action === 'create') {
      if (
        command.repositoryId &&
        !workspace.repositories.some((repo) => repo.id === command.repositoryId)
      )
        throw new HttpError(404, 'Project not found')
      const defaults = s.store.taskDefaults(command.repositoryId)
      withinPolicy(
        s,
        {
          ...defaults,
          id: 'new',
          agentId: command.agentId ?? '',
          harness: command.harness ?? (command.agentId ? undefined : defaults.harness),
          agentOverrides: command.agentOverrides,
        },
        policy,
      )
      const task = s.tasks.create({
        ...command,
        agentId: command.agentId ?? '',
        objective: command.prompt ?? '',
      })
      return {
        id: task.id,
        status: task.status,
        note: 'Created a draft. Use resume to execute its prompt, or send to add a prompt and start.',
      }
    }
    const target = s.store.taskSummary(command.id)
    if (command.action === 'read')
      return {
        thread: s.store.publicValue(target),
        history: s.store.historyPage(command.id, command.before),
      }
    if (command.action === 'wait')
      return {
        thread: s.store.publicValue(
          await waitFor(
            () => s.store.taskSummary(command.id),
            (task) =>
              s.tasks.hasWorkingFamily(task.id) || (!!task.queue?.length && !task.queuePaused),
            command.timeoutMs ?? 20000,
            check,
          ),
        ),
      }
    if (command.id === taskId)
      throw new HttpError(
        409,
        'Use this conversation’s normal reply and lifecycle controls for its own run',
      )
    withinPolicy(s, target, policy)
    if (command.action === 'send') {
      if (!command.text.trim()) throw new HttpError(400, 'Add a message')
      return runClientEffect(
        s.tasks.sendEffect(command.id, command.messageId, command.text, [], undefined, true),
      )
    }
    if (command.action === 'stop') {
      s.tasks.cancel(command.id)
      return { ok: true }
    }
    if (command.action === 'resume') {
      await s.tasks.start(command.id)
      return { ok: true }
    }
    return runClientEffect(
      taskLifecycle(s, command.id, command.action === 'archive' ? 'archive' : 'restore').pipe(
        Effect.provideService(RuntimeServices, s),
      ),
    )
  }
  if (part === 'automations') {
    const command = decode(studioAutomationsCommandSchema, value)
    if (command.action === 'list')
      return {
        automations: workspace.automations.map(({ id, name, enabled }) => ({
          id,
          name,
          enabled: enabled ?? false,
        })),
      }
    if ('automation' in command) {
      const flow = command.automation
      const issues =
        command.action === 'validate'
          ? automationIssues(flow, workspace)
          : validateFlow(s, flow, policy)
      if (command.action === 'validate') return { issues, valid: !issues.length }
      if (issues.length) throw new HttpError(400, issues.join('\n'))
      const existing = workspace.automations.find((item) => item.id === flow.id)
      if (command.action === 'create' && existing)
        throw new HttpError(409, 'Automation ID already exists')
      if (command.action === 'update' && !existing) throw new HttpError(404, 'Automation not found')
      const changes = Object.fromEntries(
        Object.entries(flow)
          .filter(([key]) => key !== 'id')
          .map(([key, after]) => [
            key,
            {
              before: existing && Object.entries(existing).find(([name]) => name === key)?.[1],
              after,
            },
          ]),
      )
      const result = await patchWorkspace(
        s,
        {
          collection: 'automations',
          id: flow.id,
          create: existing ? undefined : flow,
          changes: existing ? changes : {},
        },
        `studio:${taskId}`,
      )
      if (result.outcome === 'rejected')
        throw new HttpError(409, result.reason ?? 'Automation changed; read it again')
      return { id: flow.id, ...result }
    }
    if (command.action === 'wait') {
      const read = () => s.jobs.detail(command.id)
      return {
        run: await waitFor(
          read,
          (run) => run.status === 'running',
          command.timeoutMs ?? 20000,
          check,
        ),
      }
    }
    if (command.action === 'cancel' || command.action === 'retry') {
      const run = s.jobs.detail(command.id)
      if (run.taskIds.includes(taskId))
        throw new HttpError(409, 'Cannot control the automation running this agent')
      validateFlow(s, run.flow, policy)
      if (command.action === 'cancel') {
        s.jobs.cancel(command.id)
        return { ok: true }
      }
      return { id: s.jobs.retry(command.id) }
    }
    const flow = workspace.automations.find((item) => item.id === command.id)
    if (!flow) throw new HttpError(404, 'Automation not found')
    if (command.action === 'read') return { automation: flow }
    if (command.action === 'runs')
      return { runs: s.jobs.list().filter((run) => run.automationId === flow.id) }
    if (command.action !== 'run' && command.action !== 'enable')
      throw new HttpError(400, 'Unknown automation action')
    const issues = command.action === 'run' || command.enabled ? validateFlow(s, flow, policy) : []
    if (issues.length && (command.action === 'run' || command.enabled))
      throw new HttpError(400, issues.join('\n'))
    if (command.action === 'run') return { id: s.jobs.startManual(command.id, command.requestId) }
    return patchWorkspace(
      s,
      {
        collection: 'automations',
        id: flow.id,
        changes: { enabled: { before: flow.enabled, after: command.enabled } },
      },
      `studio:${taskId}`,
    )
  }
  if (part === 'browsers') {
    const command = decode(
      mutableStruct({ action: Schema.String, id: Schema.optional(Schema.String) }),
      value,
    )
    if (command.action === 'list') return { sessions: await s.browsers.studioList() }
    if (command.action === 'open') {
      const { url } = decode(mutableStruct({ url: Schema.optional(Schema.String) }), value)
      const id = `studio-browser:${taskId}:${randomUUID()}`
      await s.browsers.open(id, taskId, randomUUID(), url, true)
      return { id, ...(await s.browsers.agentCommand(taskId, { action: 'snapshot' }, check, id)) }
    }
    if (!command.id) throw new HttpError(400, 'Choose a browser session ID from list or open')
    if (command.action === 'logs') return s.browsers.studioLogs(command.id)
    return s.browsers.agentCommand(
      taskId,
      decode(agentBrowserCommandSchema, value),
      check,
      command.id,
    )
  }
  if (part === 'ui') {
    const command = decode(studioUICommandSchema, value)
    const sessions = studioSessions(s)
    if (command.action === 'list') return { sessions: sessions.list() }
    return sessions.command(command.sessionId, command, check)
  }
  if (part === 'diagnostics') {
    const command = decode(studioDiagnosticsCommandSchema, value)
    if (command.action === 'health') return runtimeDiagnostics(s)
    const offset = command.before === undefined ? 0 : Number(command.before)
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw new HttpError(400, 'Invalid activity cursor')
    return s.activity.list('', '', offset, command.scope)
  }
  throw new HttpError(400, 'Unknown Studio Tools part')
}
export type { StudioToolPart }
