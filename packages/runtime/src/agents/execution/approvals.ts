import type { Activity } from '../../storage/activity.js'
import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, sep } from 'node:path'
import {
  resolveTaskAgent,
  samePermissionPolicy,
  type PermissionPolicy,
  type Approval,
  type ApprovalDecision,
} from '@dovo/protocol'
import { HttpError } from '../../errors.js'
import type { WorkspaceStore } from '../../storage/workspace.js'
import type { ApprovalScopes } from './types.js'
import type { RuntimePreferences } from '../../storage/runtime-preferences.js'
// These are command execution inputs and display/context fields, never permission grants.
const commandFields = new Set([
  'command',
  'description',
  'timeout',
  'run_in_background',
  'cwd',
  'threadId',
  'turnId',
  'itemId',
  'approvalId',
  'reason',
  'availableDecisions',
  'commandActions',
  'proposedExecpolicyAmendment',
])
function commandForApproval(detail: string, projectPath: string | undefined) {
  try {
    const value: unknown = JSON.parse(detail)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    const fields = value as Record<string, unknown>
    // Unknown fields may carry additional grants. A saved command cannot authorize them.
    if (Object.keys(fields).some((key) => !commandFields.has(key))) return undefined
    if (typeof fields.command !== 'string') return undefined
    if (fields.cwd !== undefined) {
      if (typeof fields.cwd !== 'string' || !isAbsolute(fields.cwd) || !projectPath)
        return undefined
      const path = relative(projectPath, fields.cwd)
      if (path === '..' || path.startsWith('..' + sep) || isAbsolute(path)) return undefined
    }
    return fields.command.trim() || undefined
  } catch {
    return undefined
  }
}
/** How a request left the pending list. Only `decided` records a user or rule decision. */
type ApprovalEnd = 'decided' | 'withdrawn' | 'expired' | 'access-changed' | 'cancelled'
const endedMessages: Record<Exclude<ApprovalEnd, 'decided'>, string> = {
  withdrawn: 'This approval request was withdrawn, or its turn ended.',
  expired: 'This approval expired.',
  'access-changed': 'Access changed. This approval has expired.',
  cancelled: 'This approval was cancelled.',
}
const decisionLabels: Record<ApprovalDecision, string> = {
  approve: 'Allow once',
  session: 'Allow for session',
  always: 'Always allow',
  deny: 'Deny',
}
/** Enough to confirm a lost response after reconnecting. Older outcomes return 404. */
const outcomeLimit = 256
export class Approvals {
  constructor(
    private activity?: Pick<Activity, 'add'>,
    private store?: WorkspaceStore,
    private preferences?: Pick<RuntimePreferences, 'get'>,
  ) {}
  private requests = new Map<
    string,
    {
      info: Approval
      web: boolean
      command?: string
      policy?: PermissionPolicy
      resolve: (decision: ApprovalDecision, end?: ApprovalEnd, recorded?: ApprovalDecision) => void
    }
  >()
  private outcomes = new Map<string, { end: ApprovalEnd; decision: ApprovalDecision }>()
  list() {
    return [...this.requests.values()].map((r) => r.info)
  }
  request(
    taskId: string,
    title: string,
    detail: string,
    signal: AbortSignal,
    kind?: 'web' | 'command',
    scopes?: ApprovalScopes,
  ): Promise<ApprovalDecision> {
    if (signal.aborted) return Promise.resolve('deny' as const)
    // Provider adapters classify rule eligibility; tool names and display text are not authority.
    const web = kind === 'web'
    const globalWeb = web && this.preferences?.get().allowWebRequests
    const task = this.store?.get().tasks.find((item) => item.id === taskId)
    const project = this.store?.get().repositories.find((item) => item.id === task?.repositoryId)
    const command = kind === 'command' ? commandForApproval(detail, project?.path) : undefined
    if (
      (command && project?.approvedCommands?.includes(command)) ||
      (web && project?.approvedWebRequests) ||
      globalWeb
    ) {
      this.activity?.add('approval', taskId, title, {
        command,
        web,
        status: globalWeb ? 'allowed-by-runtime-rule' : 'allowed-by-project-rule',
      })
      return Promise.resolve('approve' as const)
    }
    const id = randomUUID()
    this.activity?.add('approval', taskId, title, { id, detail, status: 'requested' })
    return new Promise<ApprovalDecision>((resolve) => {
      const finish = (
        decision: ApprovalDecision,
        end: ApprovalEnd = 'decided',
        recorded: ApprovalDecision = decision,
      ) => {
        if (!this.requests.has(id)) return
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.requests.delete(id)
        this.outcomes.set(id, { end, decision: recorded })
        if (this.outcomes.size > outcomeLimit)
          this.outcomes.delete(this.outcomes.keys().next().value!)
        // The agent waits on this promise: a failed audit write must not leave it waiting.
        // The audit keeps the user's decision. A saved web rule answers the provider with a
        // single approval, but clients must show "Always allowed".
        try {
          this.activity?.add('approval', taskId, title, {
            id,
            allow: decision !== 'deny',
            decision: recorded,
            status: 'resolved',
            ...(end === 'decided' ? {} : { reason: end }),
          })
        } catch (error) {
          console.error('Could not record approval', error)
        }
        resolve(decision)
      }
      // The signal aborts when the turn ends or the provider withdraws this request.
      const abort = () => finish('deny', 'withdrawn')
      const timer = setTimeout(() => finish('deny', 'expired'), 10 * 60 * 1000)
      this.requests.set(id, {
        web,
        command,
        policy: task && this.store ? resolveTaskAgent(task, this.store.get().agents) : undefined,
        info: {
          id,
          taskId,
          title,
          detail,
          createdAt: new Date().toISOString(),
          ...(scopes
            ? {
                scopes: {
                  once: scopes.once ?? true,
                  session: !!scopes.session,
                  always: !!scopes.always,
                },
              }
            : {}),
          rememberRule: project && (command || web) ? (web ? 'web' : 'command') : null,
        },
        resolve: finish,
      })
      signal.addEventListener('abort', abort, { once: true })
    })
  }
  respond(id: string, allow: boolean, remember = false) {
    return this.decide(id, allow ? (remember ? 'always' : 'approve') : 'deny')
  }
  decide(id: string, decision: ApprovalDecision) {
    const request = this.requests.get(id)
    if (!request) return this.replay(id, decision)
    // Older clients always offer "Allow once". Never widen it to another scope.
    if (decision === 'approve' && request.info.scopes?.once === false)
      throw new HttpError(
        400,
        'This approval does not offer Allow once. Choose one of the scopes it offers.',
      )
    const current = this.store?.get().tasks.find((task) => task.id === request.info.taskId)
    const policy =
      current && this.store ? resolveTaskAgent(current, this.store.get().agents) : undefined
    if (decision !== 'deny' && !samePermissionPolicy(request.policy, policy)) {
      request.resolve('deny', 'access-changed')
      throw new HttpError(409, 'Access changed. This approval has expired.')
    }
    if (decision === 'always') {
      const command = request.command
      const web = request.info.rememberRule === 'web'
      const native = !!request.info.scopes?.always
      const task = this.store?.get().tasks.find((item) => item.id === request.info.taskId)
      if (!native && !command && !web)
        throw new HttpError(400, 'This approval cannot be saved as a project rule.')
      if (native && !command && !web) {
        // The provider persists its own policy amendment; Dovo has no rule to save.
        request.resolve('always')
        return
      }
      if (
        !task?.repositoryId ||
        !this.store ||
        !this.store.get().repositories.some((project) => project.id === task.repositoryId)
      )
        throw new HttpError(400, 'This approval cannot be saved as a project rule.')
      this.store.update((workspace) => ({
        ...workspace,
        repositories: workspace.repositories.map((project) =>
          project.id === task.repositoryId
            ? {
                ...project,
                ...(web ? { approvedWebRequests: true } : {}),
                ...(command && !web
                  ? {
                      approvedCommands: [
                        ...new Set([...(project.approvedCommands ?? []), command]),
                      ],
                    }
                  : {}),
              }
            : project,
        ),
      }))
      // Concurrent searches already waiting for this same project need no second approval.
      if (web) {
        request.resolve('approve', 'decided', 'always')
        this.applyWebRules()
        return
      }
    }
    if (decision === 'session' && !request.info.scopes?.session)
      throw new HttpError(400, 'This approval does not offer a session scope.')
    request.resolve(decision)
  }
  /** A repeated identical decision confirms the original outcome. A conflicting one fails. */
  private replay(id: string, decision: ApprovalDecision) {
    const outcome = this.outcomes.get(id)
    if (!outcome) throw new HttpError(404, 'Approval expired')
    if (outcome.end === 'decided') {
      if (outcome.decision === decision) return
      throw new HttpError(
        409,
        `This approval was already answered: ${decisionLabels[outcome.decision]}.`,
      )
    }
    // Nothing ran without an approval, so a denial matches every other ending.
    if (decision === 'deny') return
    throw new HttpError(409, endedMessages[outcome.end])
  }
  /** Apply saved rules to requests already waiting when a setting is enabled. */
  applyWebRules() {
    const globalWeb = this.preferences?.get().allowWebRequests ?? false
    const workspace = this.store?.get()
    for (const pending of this.requests.values()) {
      if (!pending.web) continue
      const task = workspace?.tasks.find((item) => item.id === pending.info.taskId)
      const policy = task && workspace ? resolveTaskAgent(task, workspace.agents) : undefined
      if (!samePermissionPolicy(pending.policy, policy)) {
        pending.resolve('deny', 'access-changed')
        continue
      }
      const project = workspace?.repositories.find((item) => item.id === task?.repositoryId)
      if (globalWeb || project?.approvedWebRequests) pending.resolve('approve')
    }
  }
  dispose() {
    for (const request of this.requests.values()) request.resolve('deny', 'cancelled')
  }
  cancelTask(taskId: string) {
    for (const request of this.requests.values())
      if (request.info.taskId === taskId) request.resolve('deny', 'cancelled')
  }
}
