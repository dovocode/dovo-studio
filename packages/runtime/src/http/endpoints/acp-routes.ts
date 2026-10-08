import { AcpAuthenticationJobs } from '../../agents/providers/acp/acp-authentication.js'
import { Effect, Schema } from 'effect'
import { homedir } from 'node:os'
import type { IncomingMessage } from 'node:http'
import { decode, minValue, maxValue, mutableStruct, resolveTaskAgent } from '@dovo/protocol'
import { RuntimeServices, type Services } from '../../services.js'
import { HttpError } from '../../errors.js'
import {
  inspectAcp,
  authenticateAcp,
  logoutAcp,
  listAcpSessions,
  deleteAcpSession,
} from '../../agents/providers/acp/acp-connection.js'
import { body } from '../support/body.js'
import { routeProgram, serviceResult } from '../support/effect.js'

const idSchema = maxValue(minValue(Schema.String, 1), 200)
const installationRequest = mutableStruct({ id: idSchema })
const authenticationJobs = new WeakMap<Services, AcpAuthenticationJobs>()
function jobs(s: Services) {
  let value = authenticationJobs.get(s)
  if (!value) {
    value = new AcpAuthenticationJobs(s.acpController.signal)
    authenticationJobs.set(s, value)
  }
  return value
}
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
      if (path === '/api/agents/acp/authenticate/callback') {
        const { url } = decode(mutableStruct({ url: maxValue(Schema.String, 16_384) }), input)
        yield* serviceResult(jobs(s).complete(id, url))
        return { ok: true }
      }
      if (path === '/api/agents/acp/authenticate/cancel') {
        jobs(s).cancel(id)
        return { ok: true }
      }
      const authentication = jobs(s).state(id)
      if (path === '/api/agents/acp/inspect' && authentication?.status === 'waiting')
        return { authMethods: [], canLogout: false, authentication }
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
          ...(authentication ? { authentication } : {}),
          terminal: s.terminals
            .list()
            .find((terminal) => terminal.taskId === `acp:${id}` && !terminal.exited),
        }
      }
      if (path === '/api/agents/acp/authenticate' || path === '/api/agents/acp/logout') {
        requireAvailable(s, id)
        requireTasksIdle(s, id)
        const { background } = decode(
          mutableStruct({ background: Schema.optional(Schema.Boolean) }),
          input,
        )
        if (path.endsWith('/authenticate') && background) {
          const { methodId } = decode(mutableStruct({ methodId: idSchema }), input)
          operations(s).add(id)
          // initialize/authenticate validates the advertised method inside the job.
          // No second process probe or long-running request is needed to start sign-in.
          void jobs(s).start(id, launch, methodId, () => operations(s).delete(id))
          return { ok: true }
        }
        operations(s).add(id)
        // A failed or interrupted yield never resumes the generator, so a try/finally
        // would leave the installation marked busy until the runtime restarts.
        return yield* Effect.gen(function* () {
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
              if (previous.taskId === `acp:${id}` && previous.exited)
                yield* serviceResult(s.terminals.close(previous.id))
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
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              operations(s).delete(id)
            }),
          ),
        )
      }
      throw new HttpError(404, 'Endpoint not found')
    }),
  )
}
