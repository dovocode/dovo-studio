import { nativeAgentWorking } from '@dovo/protocol'
import type { MemoryScope, SandboxMode, PermissionPolicy } from '@dovo/protocol'
import { mkdtempSync, writeFileSync, renameSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { WorkspaceStore } from '../storage/workspace.js'
import { HttpError } from '../errors.js'
import { hashSecret, newSecret } from './devices.js'

export interface RunPolicy {
  permissions: PermissionPolicy
  taskId: string
  runId: string
  readOnly: boolean
  sandboxMode?: SandboxMode
  artifacts: boolean
  pipelineWatching: boolean
  pullRequestWatching: boolean
  deviceHub: boolean
  memoryScopes: MemoryScope[]
}
type Credential = RunPolicy & {
  expiresAt: number
  signal: AbortSignal
  controller: AbortController
  expiryTimer: ReturnType<typeof setTimeout>
  terminals: Set<string>
  bindingId?: string
  nativeSessionId?: string
  retired?: boolean
}
const registries = new WeakMap<WorkspaceStore, RunCredentials>()
export function runCredentials(store: WorkspaceStore) {
  let credentials = registries.get(store)
  if (!credentials) registries.set(store, (credentials = new RunCredentials(store)))
  return credentials
}
export const isRunToken = (token: string) => token.startsWith('dovo_run_')

/** In-memory grants disappear on restart. Files let warm MCP transports read the current
 * grant without treating a provider-session binding as a permanent bearer credential. */
export class RunCredentials {
  private grants = new Map<string, Credential>()
  private current = new Map<string, string>()
  private files = new Map<string, string>()
  private sessionTerminals = new Map<string, Set<string>>()
  private directory?: string
  constructor(
    private store: WorkspaceStore,
    private now = Date.now,
  ) {}
  issue(policy: RunPolicy, signal: AbortSignal, ttlMs = 12 * 60 * 60 * 1000) {
    const previous = this.current.get(policy.taskId)
    if (previous) this.revoke(previous)
    const token = `dovo_run_${newSecret()}`
    const controller = new AbortController()
    const expiryTimer = setTimeout(() => this.revoke(token), Math.max(0, ttlMs))
    expiryTimer.unref()
    this.grants.set(hashSecret(token), {
      ...policy,
      permissions: { ...policy.permissions },
      readOnly: policy.readOnly || policy.sandboxMode === 'read-only',
      memoryScopes: [...policy.memoryScopes],
      signal: AbortSignal.any([signal, controller.signal]),
      controller,
      expiryTimer,
      terminals: new Set(),
      expiresAt: this.now() + ttlMs,
    })
    this.current.set(policy.taskId, token)
    return token
  }
  file(token: string) {
    const grant = this.authenticate(token)
    this.directory ??= mkdtempSync(join(tmpdir(), 'dovo-run-credentials-'))
    let file = this.files.get(grant.taskId)
    if (!file) {
      file = join(this.directory, `${randomUUID()}.json`)
      this.files.set(grant.taskId, file)
    }
    const temporary = `${file}.${randomUUID()}`
    try {
      writeFileSync(temporary, JSON.stringify({ token, runId: grant.bindingId ?? grant.runId }), {
        mode: 0o600,
        flag: 'wx',
      })
      renameSync(temporary, file)
    } finally {
      rmSync(temporary, { force: true })
    }
    return file
  }
  authenticate(token: string) {
    const grant = this.grants.get(hashSecret(token))
    if (grant && grant.expiresAt <= this.now()) this.revoke(token)
    const task = grant && this.store.get().tasks.find((task) => task.id === grant.taskId)
    if (
      !grant ||
      grant.expiresAt <= this.now() ||
      grant.signal.aborted ||
      !task ||
      (task.activeRunId !== grant.runId && task.activeRunId !== undefined) ||
      ((grant.retired || task.activeRunId === undefined) && !this.hasNativeWork(grant)) ||
      task.archived ||
      task.archivedAt
    )
      throw new HttpError(401, 'Agent run credential expired or revoked')
    return grant
  }
  private hasNativeWork(grant: Credential) {
    const task = this.store.get().tasks.find((task) => task.id === grant.taskId)
    return (
      !!grant.bindingId &&
      !!grant.nativeSessionId &&
      task?.sessionId === grant.nativeSessionId &&
      !!task.subagents?.some(
        (agent) =>
          agent.source !== 'dovo' &&
          agent.completion !== 'disposed' &&
          agent.sessionId === grant.nativeSessionId &&
          nativeAgentWorking(agent),
      )
    )
  }
  bind(token: string, bindingId: string) {
    const grant = this.authenticate(token)
    grant.bindingId = bindingId
    grant.terminals = this.sessionTerminals.get(bindingId) ?? grant.terminals
    this.sessionTerminals.set(bindingId, grant.terminals)
    this.file(token)
  }
  releaseBinding(bindingId: string) {
    this.sessionTerminals.delete(bindingId)
  }
  nativeSession(token: string, sessionId: string) {
    const grant = this.grants.get(hashSecret(token))
    if (grant) grant.nativeSessionId = sessionId
  }
  /** Native children can outlive the foreground reply, but never the session, expiry,
   * cancellation, or replacement by a later run. Idle warm transports carry no grant. */
  retire(token: string) {
    const grant = this.grants.get(hashSecret(token))
    if (grant && !grant.signal.aborted && this.hasNativeWork(grant)) grant.retired = true
    else this.revoke(token)
  }
  addTerminal(token: string, id: string) {
    this.authenticate(token).terminals.add(id)
  }
  revokeTask(taskId: string) {
    const token = this.current.get(taskId)
    if (token) this.revoke(token)
  }
  revoke(token: string) {
    const key = hashSecret(token)
    const grant = this.grants.get(key)
    this.grants.delete(key)
    if (grant) {
      clearTimeout(grant.expiryTimer)
      grant.controller.abort()
    }
    if (grant && this.current.get(grant.taskId) === token) {
      this.current.delete(grant.taskId)
      const file = this.files.get(grant.taskId)
      if (file) rmSync(file, { force: true })
    }
  }
  dispose() {
    for (const token of this.current.values()) this.revoke(token)
    this.grants.clear()
    this.current.clear()
    this.files.clear()
    this.sessionTerminals.clear()
    if (this.directory) rmSync(this.directory, { recursive: true, force: true })
    this.directory = undefined
  }
}
