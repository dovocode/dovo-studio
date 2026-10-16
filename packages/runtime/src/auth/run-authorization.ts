import { decode, permissionPolicyWithinCeiling, resolveTaskAgent } from '@dovo/protocol'
import { Schema } from 'effect'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'
import { isRunToken } from './run-credentials.js'

const allowed = new Set([
  '/api/subagents/spawn',
  '/api/subagents/list',
  '/api/subagents/read',
  '/api/subagents/wait',
  '/api/subagents/cancel',
  '/api/memory/agent/list',
  '/api/memory/agent/read',
  '/api/memory/agent/write',
  '/api/memory/agent/delete',
  '/api/artifacts/list',
  '/api/artifacts/read',
  '/api/artifacts/create',
  '/api/artifacts/update',
  '/api/pipeline-watch',
  '/api/pull-request-watch',
  '/api/previews/browser/agent',
  '/api/previews/devices',
  '/api/previews/action',
  '/api/previews/simulator/open',
  '/api/previews/simulator/input',
  '/api/device-hosts/install',
  '/api/device-hosts/forward',
  '/api/device-hosts/forward/stop',
  '/api/terminals/run',
  '/api/terminals/close',
  '/api/terminals/ticket',
])
const denied = () => {
  throw new HttpError(403, 'Operation is outside this agent run’s scope')
}
const record = (value: unknown) => decode(Schema.Record(Schema.String, Schema.Unknown), value)

export function authorizeRunEndpoint(
  s: Services,
  token: string,
  method: string | undefined,
  path: string,
) {
  const grant = s.runCredentials.authenticate(token)
  if (method !== 'POST' || !allowed.has(path)) denied()
  return grant
}

export function authorizeRunRoute(
  s: Services,
  token: string,
  method: string | undefined,
  path: string,
  value: unknown,
) {
  const grant = authorizeRunEndpoint(s, token, method, path)
  const input = record(value)
  if (path === '/api/terminals/ticket' || path === '/api/terminals/close') {
    authorizeRunTerminal(s, token, typeof input.id === 'string' ? input.id : '')
    return grant
  }
  if (input.taskId !== grant.taskId) denied()
  const ownsRun =
    input.parentRunId === grant.runId ||
    (grant.bindingId !== undefined && input.parentRunId === grant.bindingId)
  if (input.parentRunId !== undefined && !ownsRun) denied()
  // Endpoints that admit child work or durable mutations must name this exact run.
  if (
    (path.startsWith('/api/subagents/') ||
      path.endsWith('-watch') ||
      ['/api/artifacts/create', '/api/artifacts/update'].includes(path)) &&
    !ownsRun
  )
    denied()
  if (path.startsWith('/api/subagents/')) {
    if (path === '/api/subagents/spawn') {
      const parent = resolveTaskAgent(s.store.taskSummary(grant.taskId), s.store.get().agents)
      if (!parent || !permissionPolicyWithinCeiling(grant.permissions, parent)) denied()
    }
    if (['/api/subagents/read', '/api/subagents/wait', '/api/subagents/cancel'].includes(path)) {
      const child = s.store.get().tasks.find((task) => task.id === input.id)
      if (child?.delegation?.parentTaskId !== grant.taskId) denied()
    }
    // Child access narrowing is enforced by Tasks.subagentSpawn, including read-only parents.
    return grant
  }
  if (path.startsWith('/api/memory/')) {
    if (!grant.memoryScopes.some((scope) => scope === input.scope)) denied()
    if (grant.readOnly && !['/api/memory/agent/list', '/api/memory/agent/read'].includes(path))
      denied()
  } else if (path.startsWith('/api/artifacts/')) {
    if (!grant.artifacts) denied()
    if (grant.readOnly && !['/api/artifacts/list', '/api/artifacts/read'].includes(path)) denied()
    // Artifacts resolves IDs and attached revisions against taskId itself.
  } else if (path === '/api/pipeline-watch' || path === '/api/pull-request-watch') {
    if (
      grant.readOnly ||
      !(path === '/api/pipeline-watch' ? grant.pipelineWatching : grant.pullRequestWatching)
    )
      denied()
  } else if (path === '/api/previews/browser/agent') {
    const command = record(input.command)
    if (grant.readOnly && command.action !== 'snapshot' && command.action !== 'close') denied()
  } else if (path === '/api/terminals/run') {
    if (
      grant.readOnly ||
      (grant.sandboxMode && grant.sandboxMode !== 'danger-full-access') ||
      input.newTerminal !== true
    )
      denied()
  } else {
    if (!grant.deviceHub) denied()
    // The task tool promises loopback-only forwarding; exposing the SSH host to
    // its network is a separate human-client operation.
    if (path === '/api/device-hosts/forward' && input.exposeToNetwork === true) denied()
    if (
      grant.readOnly &&
      path !== '/api/previews/devices' &&
      !(
        path === '/api/previews/action' &&
        (input.action === 'screenshot' ||
          input.action === 'apps' ||
          input.action === 'capabilities')
      )
    )
      denied()
    if (
      path === '/api/previews/simulator/input' &&
      s.simulators.taskId(typeof input.id === 'string' ? input.id : '') !== grant.taskId
    )
      denied()
  }
  return grant
}

export function authorizeRunTerminal(s: Services, token: string, id: string) {
  const grant = s.runCredentials.authenticate(token)
  if (
    grant.readOnly ||
    (grant.sandboxMode && grant.sandboxMode !== 'danger-full-access') ||
    !grant.terminals.has(id) ||
    s.terminals.get(id).info.taskId !== grant.taskId
  )
    denied()
  return grant
}

/** Revalidate delayed operations without admitting run credentials to device/admin authentication. */
export function authenticateRuntimeOperation(s: Services, token: string) {
  if (isRunToken(token)) return s.runCredentials.authenticate(token)
  return s.devices.authenticate(token)
}
