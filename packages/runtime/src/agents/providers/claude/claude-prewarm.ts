import type { ChildProcess } from 'node:child_process'
import {
  prewarm,
  type Options,
  type SpareProcess,
  type Query,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk/core'
import type { AgentRun } from '../../execution/types.js'
import { IdleProviders, releaseIdleProvider } from '../../execution/warm-processes.js'

export type ClaudeBinding = {
  child?: ChildProcess
  activeRun: (
    agentId?: string,
    signal?: AbortSignal,
    sessionRequest?: boolean,
  ) => AgentRun | undefined
  capabilities: { unanswered: boolean }
}

// Callbacks are rebound through a provider-owned closure, never shared across active sessions.
export class ClaudePrewarmer {
  private idle = new IdleProviders<{
    spare: SpareProcess
    key: string
    bind: (value: ClaudeBinding) => void
  }>(async ({ spare }) => spare.close())
  private pending?: Promise<void>
  private stopped = false
  private generation = 0
  private unavailableKey?: string
  private template?: () => { options: Options; bind: (value: ClaudeBinding) => void }
  constructor(private start = prewarm) {}
  private host(options: Options): Options {
    const {
      cwd: _cwd,
      additionalDirectories: _directories,
      model: _model,
      effort: _effort,
      resume: _resume,
      abortController: _abort,
      ...host
    } = options
    return {
      ...host,
      systemPrompt:
        typeof host.systemPrompt === 'object' &&
        !Array.isArray(host.systemPrompt) &&
        host.systemPrompt.type === 'preset'
          ? { ...host.systemPrompt, append: '' }
          : host.systemPrompt,
      extraArgs: Object.fromEntries(
        Object.entries(host.extraArgs ?? {}).filter(([key]) => key !== 'mcp-config'),
      ),
      mcpServers: {},
    }
  }
  private key(options: Options) {
    return JSON.stringify(this.host(options), (_key, value: unknown) =>
      typeof value === 'function' ? undefined : value,
    )
  }
  remember(template: () => { options: Options; bind: (value: ClaudeBinding) => void }) {
    this.template = template
  }
  prepare() {
    if (
      this.stopped ||
      this.pending ||
      this.idle.get('spare') ||
      releaseIdleProvider() ||
      !this.template
    )
      return
    const template = this.template()
    const key = this.key(template.options)
    if (this.unavailableKey === key) return
    const generation = this.generation
    this.pending = (async () => {
      try {
        const spare = await this.start({
          options: this.host(template.options),
          initializeTimeoutMs: 15_000,
        })
        // A parked process's rejected claim must always have an observer.
        void spare.claimed.catch(() => {})
        if (this.stopped || generation !== this.generation || releaseIdleProvider()) {
          spare.close()
          return
        }
        const record = { spare, key, bind: template.bind }
        this.idle.set('spare', record)
        void spare.exited.then(() => {
          if (this.idle.get('spare') === record) this.idle.delete('spare')
        })
        await this.idle.prune()
      } catch (error) {
        this.unavailableKey = key
        console.warn(
          'Claude prewarming unavailable:',
          error instanceof Error ? error.message : String(error),
        )
      } finally {
        this.pending = undefined
      }
    })()
  }
  async claim(
    options: Options,
    binding: ClaudeBinding,
    prompt: string | AsyncIterable<SDKUserMessage>,
    signal?: AbortSignal,
  ): Promise<Query | undefined> {
    const record = this.idle.get('spare')
    this.idle.delete('spare')
    this.generation++ // A pending spare belongs to the previous host configuration.
    if (!record) return
    if (record.key !== this.key(options) || releaseIdleProvider() || options.resume) {
      record.spare.close()
      return
    }
    record.bind(binding)
    const abort = () => record.spare.close()
    if (signal?.aborted) {
      record.spare.close()
      signal.throwIfAborted()
    }
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const stream = record.spare.claim({
        prompt,
        options: {
          cwd: options.cwd!,
          additionalDirectories: options.additionalDirectories,
          model: options.model,
          permissionMode: options.permissionMode,
          ...(options.effort ? { settings: { effortLevel: options.effort } } : {}),
          ...(typeof options.systemPrompt === 'object' &&
          !Array.isArray(options.systemPrompt) &&
          options.systemPrompt.type === 'preset'
            ? { appendSystemPrompt: options.systemPrompt.append }
            : {}),
        },
      })
      await record.spare.claimed
      signal?.throwIfAborted()
      return stream
    } catch (error) {
      record.spare.close()
      signal?.throwIfAborted()
      // This rejection means a session already started. Retrying could execute twice.
      if (error instanceof Error && error.message.startsWith('option_not_applied')) throw error
      console.warn(
        'Claude spare refused the session; starting normally:',
        error instanceof Error ? error.message : String(error),
      )
      return undefined
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }
  async dispose() {
    this.stopped = true
    this.template = undefined
    await this.idle.release('spare')
    await this.pending
  }
}
