import type { Activity } from '../../storage/activity.js'
import { randomUUID } from 'node:crypto'
import type { Approval } from '@dovo/protocol'
import { HttpError } from '../../errors.js'
import type { WorkspaceStore } from '../../storage/workspace.js'
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
  ) {}
  private requests = new Map<string, { info: Approval; resolve: (allow: boolean) => void }>()
  list() {
    return [...this.requests.values()].map((r) => r.info)
  }
  request(taskId: string, title: string, detail: string, signal: AbortSignal) {
    if (signal.aborted) return Promise.resolve(false)
    const command = commandForApproval(title, detail)
    const task = this.store?.get().tasks.find((item) => item.id === taskId)
    const project = this.store?.get().repositories.find((item) => item.id === task?.repositoryId)
    if (command && project?.approvedCommands?.includes(command)) {
      this.activity?.add('approval', taskId, title, { command, status: 'allowed-by-project-rule' })
      return Promise.resolve(true)
    }
    const id = randomUUID()
    this.activity?.add('approval', taskId, title, { id, detail, status: 'requested' })
    return new Promise<boolean>((resolve) => {
      const finish = (allow: boolean) => {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        this.requests.delete(id)
        // The agent waits on this promise: a failed audit write must not leave it waiting.
        try {
          this.activity?.add('approval', taskId, title, { id, allow, status: 'resolved' })
        } catch (error) {
          console.error('Could not record approval', error)
        }
        resolve(allow)
      }
      const abort = () => finish(false)
      const timer = setTimeout(abort, 10 * 60 * 1000)
      this.requests.set(id, {
        info: { id, taskId, title, detail, createdAt: new Date().toISOString() },
        resolve: finish,
      })
      signal.addEventListener('abort', abort, { once: true })
    })
  }
  respond(id: string, allow: boolean, remember = false) {
    const request = this.requests.get(id)
    if (!request) throw new HttpError(404, 'Approval expired')
    if (remember && allow) {
      const command = commandForApproval(request.info.title, request.info.detail)
      const task = this.store?.get().tasks.find((item) => item.id === request.info.taskId)
      if (!command || !task?.repositoryId || !this.store)
        throw new HttpError(400, 'This approval cannot be saved as a project command rule.')
      this.store.update((workspace) => ({
        ...workspace,
        repositories: workspace.repositories.map((project) =>
          project.id === task.repositoryId
            ? {
                ...project,
                approvedCommands: [...new Set([...(project.approvedCommands ?? []), command])],
              }
            : project,
        ),
      }))
    }
    request.resolve(allow)
  }
  dispose() {
    for (const request of this.requests.values()) request.resolve(false)
  }
}
