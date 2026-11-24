import {
  remoteMcpAdmits,
  remoteMcpWrites,
  type RemoteMcpClaim,
  type RemoteMcpCommand,
  type remoteMcpReplySchema,
} from '@dovo/protocol'
import type { InternetStore } from './internet-store.js'
import { RequestError } from './http.js'
import { secret } from './store.js'
import type { RemoteMcpGrant, RemoteMcpStore } from './remote-mcp-store.js'

type Host = NonNullable<ReturnType<InternetStore['host']>>
type Job = {
  input: RemoteMcpClaim
  installation: string
  claimed: boolean
  complete: (reply: typeof remoteMcpReplySchema.Type) => void
}
const leaseMs = 12000

/** Content lives in memory through one MCP request. Installations claim only their own work. */
export class RemoteMcpMailbox {
  private seen = new Map<string, { expires: number; events: boolean }>()
  private jobs = new Map<string, Job>()

  constructor(
    private store: RemoteMcpStore,
    private now = Date.now,
  ) {}

  enabled(installation: string) {
    return (this.seen.get(installation)?.expires ?? 0) > this.now()
  }

  eventsEnabled(installation: string) {
    return this.enabled(installation) && this.seen.get(installation)?.events === true
  }

  offer(host: Host, events = false) {
    const now = this.now()
    for (const [key, { expires }] of this.seen) if (expires <= now) this.seen.delete(key)
    this.seen.set(host.installation, { expires: now + leaseMs, events })
    for (const job of this.jobs.values()) {
      if (
        job.installation === host.installation &&
        (job.input.input.part !== 'events' || events) &&
        !job.claimed &&
        this.store.grant(job.input.grantId)
      )
        return { id: job.input.id }
    }
  }

  claim(host: Host, id: string) {
    const job = this.jobs.get(id)
    if (!job || job.installation !== host.installation || job.claimed)
      throw new RequestError(404, 'MCP request is no longer available.')
    const grant = this.store.grant(job.input.grantId)
    if (
      !remoteMcpAdmits({
        active: !!grant,
        boundResource: grant?.runtimeId === host.id,
        boundInstallation: grant?.installation === host.installation,
        hostEnabled:
          job.input.input.part === 'events'
            ? this.eventsEnabled(host.installation)
            : this.enabled(host.installation),
        allowsWrite: grant?.access === 'run',
        writes: remoteMcpWrites(job.input.input),
      })
    )
      throw new RequestError(403, 'MCP access has changed.')
    job.claimed = true
    return job.input
  }

  reply(host: Host, reply: typeof remoteMcpReplySchema.Type) {
    const job = this.jobs.get(reply.id)
    if (!job?.claimed || job.installation !== host.installation)
      throw new RequestError(404, 'MCP request is no longer available.')
    job.complete(reply)
  }

  close() {
    for (const job of this.jobs.values())
      job.complete({
        id: job.input.id,
        ok: false,
        error: 'Connect is restarting. Check the thread before retrying a launch.',
      })
    this.seen.clear()
  }

  async call(grant: RemoteMcpGrant, input: RemoteMcpCommand, signal: AbortSignal) {
    if (!this.enabled(grant.installation))
      throw new RequestError(503, 'This computer is offline or its remote MCP access is disabled.')
    if (input.part === 'events' && !this.eventsEnabled(grant.installation))
      throw new RequestError(503, 'This computer does not currently offer MCP events.')
    if (remoteMcpWrites(input) && grant.access !== 'run')
      throw new RequestError(403, 'This app has read-only access.')
    if (
      this.jobs.size >= 24 ||
      [...this.jobs.values()].filter((job) => job.installation === grant.installation).length >= 4
    )
      throw new RequestError(429, 'This computer has too many ongoing MCP requests.')
    signal.throwIfAborted()
    const id = secret()
    const job: RemoteMcpClaim = { id, grantId: grant.id, access: grant.access, input }
    try {
      const reply = await new Promise<typeof remoteMcpReplySchema.Type>((resolve, reject) => {
        const timer = setTimeout(() => abort(), 22000)
        const abort = () => {
          clearTimeout(timer)
          signal.removeEventListener('abort', abort)
          reject(
            new RequestError(
              504,
              'The computer did not confirm the request. Reuse the same request ID when retrying a launch.',
            ),
          )
        }
        signal.addEventListener('abort', abort, { once: true })
        this.jobs.set(id, {
          input: job,
          installation: grant.installation,
          claimed: false,
          complete: (reply) => {
            clearTimeout(timer)
            signal.removeEventListener('abort', abort)
            resolve(reply)
          },
        })
      })
      if (!this.store.grant(grant.id)) throw new RequestError(403, 'MCP access was revoked.')
      if (!reply.ok) throw new RequestError(409, reply.error)
      return reply.result
    } finally {
      this.jobs.delete(id)
    }
  }
}
