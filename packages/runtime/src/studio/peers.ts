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
    const peers: Registration['peers'] = []
    for (const [id, session] of this.sessions) {
      try {
        if (Date.now() - session.seen > 45000) throw new Error('Disconnected')
        session.authorize()
      } catch {
        this.sessions.delete(id)
        continue
      }
      // Sessions are not merged by profile ID, so conflicting computers remain detectable.
      peers.push(...session.peers)
    }
    return peers
  }
}
type Peer = Registration['peers'][number]
/** A computer's persisted runtime ID owns its threads; older pairings only have a profile ID. */
const peerOwner = (peer: Peer) => peer.connection.runtimeId ?? peer.id
/** Only a local Studio registration grants durable control. Retrieval-only peers stay read-only.
 * Live registrations follow durable ones, so a matching live connection is preferred. */
function availablePeers(
  s: Services,
  peers = [...s.retrievalPeers.list(true), ...studioPeers(s).list()],
) {
  return peers.filter((peer) => peer.connection.runtimeId !== s.runtimeId)
}
function matchComputer(
  s: Services,
  runtimeId: string,
  peers: Peer[],
): { id: string; peer?: Peer } | undefined {
  if (runtimeId === 'local' || runtimeId === s.runtimeId) return { id: 'local' }
  const matches = peers.filter(
    (peer) => peer.id === runtimeId || peer.connection.runtimeId === runtimeId,
  )
  if (new Set(matches.map(peerOwner)).size > 1)
    throw new HttpError(
      409,
      'This computer ID matches more than one paired computer. Refresh saved connections in Studio.',
    )
  const peer = matches.at(-1)
  return peer && { id: peerOwner(peer), peer }
}
/** The authenticated snapshot records which runtime a watch reached through its saved ID. */
function reportedComputer(s: Services, watch: ThreadWatchSummary) {
  const id = watch.runtimeId === 'local' ? 'local' : watch.snapshot?.runtimeId
  return id === s.runtimeId ? 'local' : id
}
/** Resolves a discovered ID, saved profile ID or snapshot runtime ID to one owning computer.
 * Undefined means no paired computer matches; this computer's own runtime ID is local. */
export function studioComputer(
  s: Services,
  runtimeId: string | undefined,
  taskId?: string,
  peers = availablePeers(s),
): ReturnType<typeof matchComputer> {
  if (!runtimeId) return { id: 'local' }
  const computer = matchComputer(s, runtimeId, peers)
  if (!taskId || computer?.id === 'local') return computer
  // Watches saved under an older profile ID keep the runtime their snapshots reported.
  const reported = new Set(
    s.threadWatch
      .list(taskId)
      .filter((watch) => watch.runtimeId === runtimeId)
      .flatMap((watch) => reportedComputer(s, watch) ?? []),
  )
  if (reported.size > 1)
    throw new HttpError(
      409,
      'Saved watches for this computer ID reached different computers. Watch each thread again using studio_discover.',
    )
  const [owner] = reported
  if (!owner) return computer
  if (computer?.peer?.connection.runtimeId) {
    if (computer.id !== owner)
      throw new HttpError(
        409,
        'This saved computer ID now names a different computer. Watch the thread again using studio_discover.',
      )
    return computer
  }
  // An unverified profile may carry other credentials; only a pairing verified as the owner routes.
  return matchComputer(
    s,
    owner,
    peers.filter((peer) => peer.connection.runtimeId === owner),
  )
}
/** A reported runtime is authoritative, so a reused alias cannot claim another computer's watch. */
function sameComputer(s: Services, peers: Peer[], watch: ThreadWatchSummary, owner: string) {
  const reported = reportedComputer(s, watch)
  if (reported !== undefined) return reported === owner
  if (watch.runtimeId === owner) return true
  try {
    return matchComputer(s, watch.runtimeId, peers)?.id === owner
  } catch {
    return false
  }
}
export function studioComputerName(s: Services, runtimeId: string) {
  const computer = studioComputer(s, runtimeId)
  return computer?.id === 'local' ? 'This computer' : (computer?.peer?.name ?? runtimeId)
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
  const computer =
    studioComputer(s, runtimeId, taskId) ??
    (durableSnapshot && policy?.readOnly && part === 'threads' && input.action === 'snapshot'
      ? studioComputer(s, runtimeId, taskId, availablePeers(s, s.retrievalPeers.list()))
      : undefined)
  // An unavailable computer keeps the caller's ID, so its saved watches can still be stopped.
  const owner = computer?.id ?? runtimeId ?? 'local'
  const owned = (threadId: string, peers = availablePeers(s)) =>
    s.threadWatch
      .list(taskId)
      .filter((watch) => watch.threadId === threadId && sameComputer(s, peers, watch, owner))
  if (part === 'threads') {
    const command = decode(studioThreadsCommandSchema, input)
    if (command.action === 'watches') return { watches: s.threadWatch.list(taskId) }
    if (command.action === 'send' || command.action === 'resume') {
      const previous = owned(command.id)[0]
      // Reserve monitoring capacity before restarting remote work. A failed send is safe to recheck.
      if (previous?.status === 'completed') {
        restarted = previous
        restartMonitor()
      }
    }
    if (command.action === 'unwatch') {
      let watches = s.threadWatch.stop(taskId, owner, command.id)
      for (const saved of new Set(owned(command.id).map((watch) => watch.runtimeId)))
        if (saved !== owner) watches = s.threadWatch.stop(taskId, saved, command.id)
      return { watches }
    }
    if (command.action === 'watch') {
      if (!computer) throw new HttpError(404, 'Paired computer unavailable')
      const saved = owned(command.id)
      return {
        watch: s.threadWatch.watch(
          taskId,
          // Rearm a watch saved under an older ID for this computer instead of duplicating it.
          (saved.find((watch) => watch.status === 'watching') ?? saved[0])?.runtimeId ?? owner,
          command.id,
          computer.peer?.name ?? 'This computer',
          policy,
        ),
      }
    }
  }
  if (owner === 'local') {
    const result = await studioTool(s, taskId, part, command, authorize, policy)
    restartMonitor()
    if (part !== 'discover') return result
    const computers = new Map(
      availablePeers(s).map((peer) => [peerOwner(peer), { id: peerOwner(peer), name: peer.name }]),
    )
    return {
      ...decode(Schema.Record(Schema.String, Schema.Unknown), result),
      computers: [
        { id: 'local', name: 'This computer', local: true },
        ...[...computers.values()].map((computer) => ({ ...computer, local: false })),
      ],
    }
  }
  const peer = computer?.peer
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
        s.threadWatch.watch(taskId, owner, created.id, peer.name, policy, 'spawned')
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
