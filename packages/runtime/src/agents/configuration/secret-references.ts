import { readSecretCommand } from './secret-command.js'
import { OwnedProcessShutdownError } from '../execution/stop-owned-child.js'
import {
  decode,
  agentSecretReferenceSchema,
  agentSecretReferencesSchema,
  mutableArray,
  mutableStruct,
  type AgentSecretReference,
  type AgentDiscovery,
} from '@dovo/protocol'
import { Schema } from 'effect'

type ReadCommand = (command: string, args: string[], signal: AbortSignal) => Promise<string>
type Entry = {
  controller: AbortController
  promise: Promise<string>
  users: number
  settled: boolean
  shutdown?: OwnedProcessShutdownError
}
const labels = {
  environment: 'host environment',
  onepassword: '1Password',
  bitwarden: 'Bitwarden',
  infisical: 'Infisical',
}
const infisicalOutput = mutableArray(
  mutableStruct({ secretKey: Schema.String, secretValue: Schema.String }),
)

/** Values and failures stay local to this registry, never workspace documents, diagnostics or caches on disk. */
export class SecretReferences {
  private cache = new Map<string, Entry>()
  private pending = new Set<Entry>()
  private active = 0
  private waiting: (() => void)[] = []
  generation = 0
  constructor(
    private environment: () => NodeJS.ProcessEnv = () => process.env,
    private command: ReadCommand = readSecretCommand,
  ) {}
  refresh() {
    // Existing launches finish with the configuration they captured; new launches read again.
    this.cache.clear()
    this.generation++
  }
  async close() {
    for (const entry of this.pending) entry.controller.abort()
    const results = await Promise.allSettled([...this.pending].map((entry) => entry.promise))
    this.cache.clear()
    const unconfirmed = results.flatMap((result) =>
      result.status === 'rejected' && result.reason instanceof OwnedProcessShutdownError
        ? [result.reason]
        : [],
    )
    if (unconfirmed.length)
      throw new AggregateError(unconfirmed, 'Secret provider shutdown was not confirmed')
  }
  private async permit(signal: AbortSignal) {
    signal.throwIfAborted()
    if (this.active >= 2)
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          signal.removeEventListener('abort', aborted)
          this.active++
          resolve()
        }
        const aborted = () => {
          this.waiting = this.waiting.filter((item) => item !== ready)
          reject(signal.reason)
        }
        signal.addEventListener('abort', aborted, { once: true })
        this.waiting.push(ready)
        if (signal.aborted) aborted()
      })
    else this.active++
    if (signal.aborted) {
      this.active--
      this.waiting.shift()?.()
      signal.throwIfAborted()
    }
    return () => {
      this.active--
      this.waiting.shift()?.()
    }
  }
  private async fetch(reference: AgentSecretReference, signal: AbortSignal) {
    if (reference.provider === 'environment') {
      const value = this.environment()[reference.reference]
      if (value === undefined) throw new Error('Missing environment variable')
      return value
    }
    const release = await this.permit(signal)
    let held = false
    try {
      if (reference.provider === 'onepassword')
        return await this.command(
          'op',
          [
            '--cache=false',
            'read',
            '--no-newline',
            ...(reference.account ? [`--account=${reference.account}`] : []),
            reference.reference,
          ],
          signal,
        )
      if (reference.provider === 'bitwarden') {
        const output = await this.command(
          'bw',
          ['get', reference.field ?? 'password', reference.reference],
          signal,
        )
        // bw appends a record separator; whitespace inside the stored value remains significant.
        return output.replace(/\r?\n$/, '')
      }
      const output = await this.command(
        'infisical',
        [
          'secrets',
          'get',
          reference.reference,
          `--projectId=${reference.projectId}`,
          `--env=${reference.environment}`,
          `--path=${reference.path}`,
          '--output=json',
          '--silent',
          '--log-destination=stderr',
          ...(reference.domain ? [`--domain=${reference.domain}`] : []),
        ],
        signal,
      )
      const secrets = decode(infisicalOutput, JSON.parse(output))
      const matching = secrets.filter((secret) => secret.secretKey === reference.reference)
      if (matching.length !== 1 || matching[0].secretValue === '*not found*')
        throw new Error('Secret not found')
      return matching[0].secretValue
    } catch (cause) {
      if (cause instanceof OwnedProcessShutdownError) {
        held = true
        void cause.confirmed?.then(release)
      }
      throw cause
    } finally {
      if (!held) release()
    }
  }
  private async read(reference: AgentSecretReference, signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted()
    const key = JSON.stringify(reference)
    let entry = this.cache.get(key)
    if (!entry) {
      if (this.cache.size >= 128) {
        for (const [oldKey, old] of this.cache)
          if (old.settled) {
            this.cache.delete(oldKey)
            break
          }
      }
      if (this.cache.size >= 128 || this.pending.size >= 128)
        throw new Error(
          'Too many secret references are resolving. Wait for active launches, then refresh secret references.',
        )
      const controller = new AbortController()
      const timer = setTimeout(
        () => controller.abort(new Error('Secret provider timed out')),
        45_000,
      )
      timer.unref()
      const created: Entry = { controller, users: 0, settled: false, promise: Promise.resolve('') }
      created.promise = this.fetch(reference, controller.signal)
        .then((value) => {
          if (!value || value.includes('\0') || Buffer.byteLength(value) > 64 * 1024)
            throw new Error('Invalid environment value')
          return value
        })
        .catch((cause) => {
          if (cause instanceof OwnedProcessShutdownError) {
            created.shutdown = new OwnedProcessShutdownError(
              'Secret provider shutdown was not confirmed',
              { confirmed: cause.confirmed },
            )
            throw created.shutdown
          }
          // Provider stderr/arguments can contain credentials. Keep them out of errors and activity.
          throw new Error(
            `Could not resolve a ${labels[reference.provider]} reference. Check the provider login on this computer, then refresh secret references.`,
          )
        })
        .finally(() => {
          created.settled = true
          clearTimeout(timer)
          if (created.shutdown) {
            void created.shutdown.confirmed?.then(() => this.pending.delete(created))
          } else this.pending.delete(created)
          // A TOTP is time-sensitive; only concurrent reads share it.
          if (
            reference.provider === 'bitwarden' &&
            reference.field === 'totp' &&
            this.cache.get(key) === created
          )
            this.cache.delete(key)
        })
      // Attach a handler immediately: cancellation may remove the last awaiting caller.
      void created.promise.catch(() => {})
      entry = created
      this.pending.add(created)
      this.cache.set(key, created)
    }
    const owned = entry
    owned.users++
    let abort: (() => void) | undefined
    try {
      if (!signal) return await owned.promise
      return await Promise.race([
        owned.promise,
        new Promise<never>((_, reject) => {
          abort = () => reject(signal.reason ?? new Error('Secret resolution cancelled'))
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
        }),
      ])
    } finally {
      if (abort) signal?.removeEventListener('abort', abort)
      owned.users--
      if (!owned.settled && owned.users === 0) {
        owned.controller.abort()
        if (this.cache.get(key) === owned) this.cache.delete(key)
        await owned.promise.catch((cause) => {
          if (cause instanceof OwnedProcessShutdownError) throw cause
        })
      }
    }
  }
  /** One reference for host-private runtime use, such as a source control credential. */
  value(reference: AgentSecretReference, signal?: AbortSignal) {
    return this.read(decode(agentSecretReferenceSchema, reference), signal)
  }
  async resolve<T extends AgentDiscovery>(
    agent: T,
    signal?: AbortSignal,
  ): Promise<Omit<T, 'env' | 'envSecrets'> & Pick<AgentDiscovery, 'env' | 'envSecrets'>> {
    if (!agent.envSecrets || !Object.keys(agent.envSecrets).length) return agent
    const references = decode(agentSecretReferencesSchema, agent.envSecrets)
    const controller = new AbortController()
    const cancelled = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', cancelled, { once: true })
    if (signal?.aborted) cancelled()
    const reads = Object.entries(references).map(async ([name, reference]) => {
      try {
        return [name, await this.read(reference, controller.signal)] as const
      } catch (error) {
        if (signal?.aborted || error instanceof OwnedProcessShutdownError) throw error
        throw new Error(
          `Environment variable ${name}: ${error instanceof Error ? error.message : 'Secret reference unavailable'}`,
        )
      }
    })
    try {
      const entries = await Promise.all(reads)
      return {
        ...agent,
        envSecrets: undefined,
        env: Object.fromEntries([...Object.entries(agent.env ?? {}), ...entries]),
      }
    } catch (error) {
      controller.abort()
      await Promise.allSettled(reads)
      throw error
    } finally {
      signal?.removeEventListener('abort', cancelled)
    }
  }
}
