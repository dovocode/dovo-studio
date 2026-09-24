import { Effect, Schema } from 'effect'
import { homedir } from 'node:os'
import type { IncomingMessage } from 'node:http'
import { decode, minValue, maxValue, mutableStruct, resolveTaskAgent } from '@dovo/protocol'
import { RuntimeServices, type Services } from '../services.js'
import { HttpError } from '../errors.js'
import {
  inspectAcp,
  authenticateAcp,
  logoutAcp,
  listAcpSessions,
  deleteAcpSession,
} from '../agents/providers/acp-connection.js'
import { body } from './body.js'
import { routeProgram, serviceResult } from './effect.js'

const idSchema = maxValue(minValue(Schema.String, 1), 200)
const installationRequest = mutableStruct({ id: idSchema })
const authenticationOperations = new WeakMap<Services, Set<string>>()
function operations(s: Services) {
  let set = authenticationOperations.get(s)
  if (!set) {
    set = new Set()
    authenticationOperations.set(s, set)
  }
  return set
}
function requireAvailable(s: Services, id: string) {
  if (
    operations(s).has(id) ||
    s.terminals.list().some((t) => t.taskId === `acp:${id}` && !t.exited)
  )
    throw new HttpError(409, 'Finish or close this agent’s authentication before changing it.')
}
function requireTasksIdle(s: Services, id: string) {
  const workspace = s.store.get()
  for (const task of workspace.tasks) {
    if (resolveTaskAgent(task, workspace.agents)?.acpInstallationId === id) {
      s.tasks.requireIdle(task.id)
      s.jobs.requireTaskIdle(task.id)
    }
  }
}
export function acpRoute(request: IncomingMessage, path: string) {
  return routeProgram(
    Effect.gen(function* () {
      const s = yield* RuntimeServices
      if (request.method !== 'POST') throw new HttpError(404, 'Endpoint not found')
      if (path === '/api/agents/acp/registry')
        return yield* serviceResult(s.acpInstallations.registry())
      if (path === '/api/agents/acp/list') return { installations: s.acpInstallations.list() }
      if (path === '/api/agents/acp/install') {
        const { registryId } = decode(
          mutableStruct({ registryId: idSchema }),
          yield* serviceResult(body(request)),
        )
        for (const installation of s.acpInstallations
          .list()
          .filter((entry) => entry.registryId === registryId)) {
          requireAvailable(s, installation.id)
          requireTasksIdle(s, installation.id)
        }
        return yield* serviceResult(s.acpInstallations.install(registryId))
      }
      const input = yield* serviceResult(body(request))
      const { id } = decode(installationRequest, input)
      if (path === '/api/agents/acp/remove') {
        requireAvailable(s, id)
        const workspace = s.store.get()
        if (
          workspace.agents.some((agent) => agent.acpInstallationId === id) ||
          workspace.tasks.some(
            (task) =>
              task.harness?.acpInstallationId === id ||
              task.agentOverrides?.acpInstallationId === id,
          )
        )
          throw new HttpError(
            409,
            'Choose another installation in the saved agents and threads that use this agent before removing it.',
          )
        yield* serviceResult(s.acpInstallations.remove(id))
        return { ok: true }
      }
      const launch = s.acpInstallations.launch(id)
      if (path === '/api/agents/acp/sessions') {
        const { cursor } = decode(
          mutableStruct({ cursor: Schema.optional(maxValue(Schema.String, 4096)) }),
          input,
        )
        const result = yield* serviceResult(
          listAcpSessions(launch, { cursor }, s.acpController.signal),
        )
        return {
          sessions: result.sessions.map((session) => ({
            sessionId: session.sessionId,
            cwd: session.cwd,
            ...(session.title ? { title: session.title } : {}),
            ...(session.updatedAt ? { updatedAt: session.updatedAt } : {}),
          })),
          ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}),
          canDelete: result.canDelete,
        }
      }
      if (path === '/api/agents/acp/sessions/delete') {
        const { sessionId } = decode(
          mutableStruct({ sessionId: maxValue(minValue(Schema.String, 1), 4096) }),
          input,
        )
        requireAvailable(s, id)
        const workspace = s.store.get()
        if (workspace.tasks.some((task) => task.sessionId === sessionId))
          throw new HttpError(
            409,
            'This session belongs to a Dovo thread. Start a new session or delete that thread first.',
          )
        yield* serviceResult(deleteAcpSession(launch, sessionId, s.acpController.signal))
        return { ok: true }
      }
      if (path === '/api/agents/acp/inspect') {
        const terminal = s.terminals
          .list()
          .find((terminal) => terminal.taskId === `acp:${id}` && !terminal.exited)
        if (terminal) return { authMethods: [], canLogout: false, terminal }
        const result = yield* serviceResult(inspectAcp(launch, s.acpController.signal))
        return {
          authMethods: result.authMethods.map((method) => ({
            id: method.id,
            name: method.name,
            ...(method.description ? { description: method.description } : {}),
            type: 'type' in method && method.type === 'terminal' ? 'terminal' : 'agent',
          })),
          canLogout: result.canLogout,
          terminal: s.terminals
            .list()
            .find((terminal) => terminal.taskId === `acp:${id}` && !terminal.exited),
        }
      }
      if (path === '/api/agents/acp/authenticate' || path === '/api/agents/acp/logout') {
        requireAvailable(s, id)
        requireTasksIdle(s, id)
        operations(s).add(id)
        try {
          if (path.endsWith('/logout')) {
            yield* serviceResult(logoutAcp(launch, s.acpController.signal))
            return { ok: true }
          }
          const { methodId } = decode(mutableStruct({ methodId: idSchema }), input)
          const result = yield* serviceResult(inspectAcp(launch, s.acpController.signal))
          const method = result.authMethods.find((entry) => entry.id === methodId)
          if (!method)
            throw new HttpError(
              400,
              'This authentication method is no longer available. Refresh the agent.',
            )
          if ('type' in method && method.type === 'terminal') {
            for (const previous of s.terminals.list()) {
              if (previous.taskId === `acp:${id}` && previous.exited) s.terminals.close(previous.id)
            }
            const terminal = s.terminals.createCommand(
              `acp:${id}`,
              homedir(),
              {
                command: launch.command,
                args: [...launch.args, ...(method.args ?? [])],
                env: { ...launch.env, ...method.env },
              },
              `${s.acpInstallations.list().find((entry) => entry.id === id)?.name ?? 'ACP'} · Sign in`,
            )
            return { ok: true, terminal }
          }
          yield* serviceResult(authenticateAcp(launch, methodId, s.acpController.signal))
          return { ok: true }
        } finally {
          operations(s).delete(id)
        }
      }
      throw new HttpError(404, 'Endpoint not found')
    }),
  )
}
