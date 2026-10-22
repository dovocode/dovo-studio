import {
  createRuntimeClient,
  decode,
  studioPeerRegistrationSchema,
  RuntimeRequestError,
  noStudioTools,
  studioThreadsCommandSchema,
  type ThreadWatchSummary,
} from '@dovo/protocol'
import { createHash } from 'node:crypto'
import { Schema } from 'effect'
import { runClientEffect } from '@dovo/client-runtime'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'
import { requireStudioPart, studioReadAction, studioTool, type StudioPolicy } from './tools.js'

type Registration = typeof studioPeerRegistrationSchema.Type
type Session = Registration & { deviceId: string; seen: number; authorize: () => void }
const instances = new WeakMap<Services, StudioPeers>()
export function studioPeers(s: Services) {
  let peers = instances.get(s)
  if (!peers) instances.set(s, (peers = new StudioPeers()))
  return peers
}
/** Pairings stay in memory while the local Studio client is connected. */
export class StudioPeers {
  private sessions = new Map<string, Session>()
  register(deviceId: string, value: unknown, authorize: () => void) {
    authorize()
    const input = decode(studioPeerRegistrationSchema, value)
    if (
      input.peers.some((peer) => peer.id === 'local') ||
      new Set(input.peers.map((peer) => peer.id)).size !== input.peers.length
    )
      throw new HttpError(400, 'Paired computer IDs must be unique and cannot be local')
    const existing = [...this.sessions.values()].find(
      (session) => session.sessionId === input.sessionId,
    )
    if (existing && existing.deviceId !== deviceId)
      throw new HttpError(403, 'Pairing session belongs to another device')
    this.list()
    if (!this.sessions.has(deviceId) && this.sessions.size >= 32)
      throw new HttpError(429, 'Too many Studio pairing sessions')
    this.sessions.set(deviceId, { ...input, deviceId, seen: Date.now(), authorize })
    return { ok: true }
  }
  list() {
    const peers = new Map<string, Registration['peers'][number]>()
    for (const [id, session] of this.sessions) {
      try {
        if (Date.now() - session.seen > 45000) throw new Error('Disconnected')
        session.authorize()
      } catch {
        this.sessions.delete(id)
        continue
      }
      for (const peer of session.peers) peers.set(peer.id, peer)
    }
    return [...peers.values()]
  }
}
/** Only a local Studio registration grants durable control. Retrieval-only peers stay read-only. */
function availablePeers(s: Services) {
  const peers = new Map(s.retrievalPeers.list(true).map((peer) => [peer.id, peer]))
  for (const peer of studioPeers(s).list()) peers.set(peer.id, peer)
  return [...peers.values()]
}
export function studioComputerName(s: Services, runtimeId: string) {
  return runtimeId === 'local'
    ? 'This computer'
    : (availablePeers(s).find(
        (peer) => peer.id === runtimeId || peer.connection.runtimeId === runtimeId,
      )?.name ?? runtimeId)
}
export async function routedStudioTool(
  s: Services,
  taskId: string,
  part: string,
  command: unknown,
  runtimeId: string | undefined,
  authorize: () => void,
  policy?: StudioPolicy,
  signal?: AbortSignal,
  durableSnapshot = false,
) {
  authorize()
  requireStudioPart(s, part, policy)
  const input = decode(Schema.Record(Schema.String, Schema.Unknown), command)
  if (policy?.readOnly && !studioReadAction(part, input.action))
    throw new HttpError(403, 'This agent has read-only Studio Tools access')
  if (runtimeId && part === 'ui')
    throw new HttpError(403, 'Studio UI interaction stays on this machine')
  let restarted: ThreadWatchSummary | undefined
  const restartMonitor = () => {
    if (!restarted) return
    const previous = restarted
    const current = s.threadWatch
      .list(taskId)
      .find(
        (watch) => watch.runtimeId === previous.runtimeId && watch.threadId === previous.threadId,
      )
    if (!current || current.status === 'stopped' || current.stopRequested) return
    s.threadWatch.watch(
      taskId,
      previous.runtimeId,
      previous.threadId,
      previous.computerName,
      policy,
      previous.relation,
      previous.delegated,
    )
  }
  if (part === 'threads') {
    const command = decode(studioThreadsCommandSchema, input)
    if (command.action === 'watches') return { watches: s.threadWatch.list(taskId) }
    if (command.action === 'send' || command.action === 'resume') {
      const previous = s.threadWatch
        .list(taskId)
        .find(
          (watch) => watch.threadId === command.id && watch.runtimeId === (runtimeId ?? 'local'),
        )
      // Reserve monitoring capacity before restarting remote work. A failed send is safe to recheck.
      if (previous?.status === 'completed') {
        restarted = previous
        restartMonitor()
      }
    }
    if (command.action === 'watch' || command.action === 'unwatch') {
      const computer =
        runtimeId && runtimeId !== 'local'
          ? availablePeers(s).find(
              (peer) => peer.id === runtimeId || peer.connection.runtimeId === runtimeId,
            )
          : undefined
      if (command.action === 'unwatch')
        return { watches: s.threadWatch.stop(taskId, runtimeId ?? 'local', command.id) }
      if (runtimeId && runtimeId !== 'local' && !computer)
        throw new HttpError(404, 'Paired computer unavailable')
      return {
        watch: s.threadWatch.watch(
          taskId,
          runtimeId ?? 'local',
          command.id,
          computer?.name ?? 'This computer',
          policy,
        ),
      }
    }
  }
  if (!runtimeId || runtimeId === 'local') {
    const result = await studioTool(s, taskId, part, command, authorize, policy)
    restartMonitor()
    if (part !== 'discover') return result
    return {
      ...decode(Schema.Record(Schema.String, Schema.Unknown), result),
      computers: [
        { id: 'local', name: 'This computer', local: true },
        ...availablePeers(s).map(({ id, name }) => ({ id, name, local: false })),
      ],
    }
  }
  const peer =
    availablePeers(s).find(
      (peer) => peer.id === runtimeId || peer.connection.runtimeId === runtimeId,
    ) ??
    (durableSnapshot && policy?.readOnly && part === 'threads' && input.action === 'snapshot'
      ? s.retrievalPeers
          .list()
          .find((peer) => peer.id === runtimeId || peer.connection.runtimeId === runtimeId)
      : undefined)
  if (!peer)
    throw new HttpError(
      404,
      'Paired computer unavailable. Open Studio on this computer and refresh its saved connections.',
    )
  const forwardedPolicy = policy && {
    permissions: policy.permissions,
    readOnly: policy.readOnly,
    studioTools: { ...(policy.studioTools ?? noStudioTools()), ui: false },
  }
  const scope = createHash('sha256')
    .update(JSON.stringify([s.runtimeId, taskId]))
    .digest('hex')
  try {
    const result = await runClientEffect(
      createRuntimeClient(peer.connection).requestEffect(
        part === 'threads' && (input.action === 'create' || input.allowPermissionIncrease === true)
          ? '/api/studio/forward-v2'
          : '/api/studio/forward',
        { taskId: `paired:${scope}`, part, command, policy: forwardedPolicy },
        Schema.Unknown,
        { method: 'POST', timeoutMs: durableSnapshot ? 10000 : 120000 },
      ),
      signal,
    )
    authorize()
    requireStudioPart(s, part, policy)
    // Invalidate reads that began before the mutation; their old completion must not retire the new run.
    restartMonitor()
    if (
      part === 'threads' &&
      input.action === 'create' &&
      input.watch !== false &&
      s.store.get().tasks.some((task) => task.id === taskId)
    ) {
      const created = decode(Schema.Struct({ id: Schema.String }), result)
      try {
        s.threadWatch.watch(taskId, runtimeId, created.id, peer.name, policy, 'spawned')
      } catch (error) {
        // Creation already succeeded: keep its ID reviewable instead of suggesting a duplicate retry.
        return {
          ...decode(Schema.Record(Schema.String, Schema.Unknown), result),
          watchError:
            error instanceof HttpError
              ? error.message
              : 'Thread created, but monitoring could not be registered. Use watch with this thread ID to retry.',
        }
      }
    }
    return result
  } catch (error) {
    if (error instanceof RuntimeRequestError) {
      const message =
        error.status === 404 && error.message === 'Endpoint not found'
          ? 'Update this paired runtime to use cross-computer Studio Tools.'
          : error.message
      throw new HttpError(error.status ?? 502, `Paired computer ${peer.name}: ${message}`)
    }
    throw error
  }
}
