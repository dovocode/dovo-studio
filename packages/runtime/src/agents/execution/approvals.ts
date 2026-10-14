import type { Activity } from '../../storage/activity.js'
import { randomUUID } from 'node:crypto'
import {
  resolveTaskAgent,
  samePermissionPolicy,
  type PermissionPolicy,
  type Approval,
  type ApprovalDecision,
} from '@dovo/protocol'
import { HttpError } from '../../errors.js'
import type { WorkspaceStore } from '../../storage/workspace.js'
import type { RuntimePreferences } from '../../storage/runtime-preferences.js'
function commandForApproval(title: string, detail: string) {
  if (!/command|bash|shell/i.test(title)) return undefined
  try {
    const value: unknown = JSON.parse(detail)
    if (!value || typeof value !== 'object') return undefined
    const fields = value as Record<string, unknown>
    const command = fields.command ?? fields.cmd ?? fields.commandLine
    if (typeof command === 'string') return command.trim() || undefined
    if (Array.isArray(command) && command.every((part) => typeof part === 'string'))
      return command.join(' ').trim() || undefined
    return undefined
  } catch {
    return detail.trim() || undefined
  }
}
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
      policy?: PermissionPolicy
      resolve: (decision: ApprovalDecision) => void
    }
  >()
  list() {
    return [...this.requests.values()].map((r) => r.info)
  }
  request(
    taskId: string,
    title: string,
    detail: string,
    signal: AbortSignal,
    kind?: 'web',
    scopes?: { session?: boolean; always?: boolean },
  ): Promise<ApprovalDecision> {
    if (signal.aborted) return Promise.resolve('deny' as const)
    const command = commandForApproval(title, detail)
    // Only the provider adapter can classify a web request; display text is not authoritative.
    const web = kind === 'web'
    const globalWeb = web && this.preferences?.get().allowWebRequests
    const task = this.store?.get().tasks.find((item) => item.id === taskId)
    const project = this.store?.get().repositories.find((item) => item.id === task?.repositoryId)
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
      const finish = (decision: ApprovalDecision) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.requests.delete(id)
        // The agent waits on this promise: a failed audit write must not leave it waiting.
        try {
          this.activity?.add('approval', taskId, title, {
            id,
            allow: decision !== 'deny',
            decision,
            status: 'resolved',
          })
        } catch (error) {
          console.error('Could not record approval', error)
        }
        resolve(decision)
      }
      const abort = () => finish('deny')
      const timer = setTimeout(abort, 10 * 60 * 1000)
      this.requests.set(id, {
        web,
        policy: task && this.store ? resolveTaskAgent(task, this.store.get().agents) : undefined,
        info: {
          id,
          taskId,
          title,
          detail,
          createdAt: new Date().toISOString(),
          ...(scopes ? { scopes: { session: !!scopes.session, always: !!scopes.always } } : {}),
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
    if (!request) throw new HttpError(404, 'Approval expired')
    const current = this.store?.get().tasks.find((task) => task.id === request.info.taskId)
    const policy =
      current && this.store ? resolveTaskAgent(current, this.store.get().agents) : undefined
    if (decision !== 'deny' && !samePermissionPolicy(request.policy, policy)) {
      request.resolve('deny')
      throw new HttpError(409, 'Access changed. This approval has expired.')
    }
    if (decision === 'always') {
      const command = commandForApproval(request.info.title, request.info.detail)
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
        this.applyWebRules()
        return
      }
    }
    if (decision === 'session' && !request.info.scopes?.session)
      throw new HttpError(400, 'This approval does not offer a session scope.')
    request.resolve(decision)
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
        pending.resolve('deny')
        continue
      }
      const project = workspace?.repositories.find((item) => item.id === task?.repositoryId)
      if (globalWeb || project?.approvedWebRequests) pending.resolve('approve')
    }
  }
  dispose() {
    for (const request of this.requests.values()) request.resolve('deny')
  }
  cancelTask(taskId: string) {
    for (const request of this.requests.values())
      if (request.info.taskId === taskId) request.resolve('deny')
  }
}
