import { stripVTControlCharacters } from 'node:util'
import type { AcpLaunch } from '../../execution/types.js'
import { authenticateAcp } from './acp-connection.js'

type AuthenticationJob = {
  status: 'waiting' | 'completed' | 'failed'
  output: string
  error?: string
  controller: AbortController
  privateInput?: boolean
}

/** Authentication outlives the HTTP request, so remote clients can follow browser sign-in. */
export class AcpAuthenticationJobs {
  private readonly jobs = new Map<string, AuthenticationJob>()
  constructor(private readonly signal: AbortSignal) {}

  state(id: string) {
    const job = this.jobs.get(id)
    if (!job) return undefined
    const output = stripVTControlCharacters(job.output)
    const urls = [...new Set(output.match(/https?:\/\/[^\s<>"']+/g) ?? [])].filter((value) => {
      try {
        return ['http:', 'https:'].includes(new URL(value).protocol)
      } catch {
        return false
      }
    })
    return {
      status: job.status,
      output,
      urls,
      ...(job.error ? { error: job.error } : {}),
    }
  }

  async start(id: string, launch: AcpLaunch, methodId: string, finished: () => void) {
    const controller = new AbortController()
    const job: AuthenticationJob = {
      status: 'waiting',
      output: '',
      controller,
    }
    this.jobs.set(id, job)
    const abort = () => controller.abort()
    this.signal.addEventListener('abort', abort, { once: true })
    if (this.signal.aborted) abort()
    try {
      await authenticateAcp(launch, methodId, controller.signal, (text) => {
        // Bounded, in-memory diagnostics only: OAuth links never enter task history or logs.
        if (!job.privateInput) job.output = (job.output + text).slice(-16_384)
      })
      job.status = 'completed'
      job.output = ''
    } catch (error) {
      job.status = 'failed'
      job.error = controller.signal.aborted
        ? 'Sign-in cancelled.'
        : job.privateInput
          ? 'Sign-in failed. Start sign-in again.'
          : error instanceof Error
            ? error.message
            : String(error)
    } finally {
      this.signal.removeEventListener('abort', abort)
      finished()
    }
  }

  callbackConsumer(id: string) {
    const job = this.jobs.get(id)
    if (!job || job.status !== 'waiting')
      throw new Error('Start sign-in before requesting secure input.')
    return async (value: string, signal: AbortSignal) => {
      if (this.jobs.get(id) !== job) throw new Error('This sign-in has been replaced.')
      await this.complete(id, value, signal)
    }
  }
  async complete(id: string, callback: string, signal?: AbortSignal) {
    const job = this.jobs.get(id)
    if (!job || job.status !== 'waiting')
      throw new Error('Start sign-in before submitting its callback.')
    let target: URL
    try {
      target = new URL(callback)
    } catch {
      throw new Error('Paste the full browser callback URL.')
    }
    const advertised = this.state(id)?.urls.some((url) => {
      const authorization = new URL(url)
      const redirect = authorization.searchParams.get('redirect_uri')
      if (!redirect) return false
      let expected: URL
      try {
        expected = new URL(redirect)
      } catch {
        return false
      }
      const state = authorization.searchParams.get('state')
      return (
        expected.origin === target.origin &&
        expected.pathname === target.pathname &&
        (!state || state === target.searchParams.get('state'))
      )
    })
    if (
      !advertised ||
      target.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname) ||
      Number(target.port) < 1024 ||
      target.username ||
      target.password ||
      !target.searchParams.has('code')
    )
      throw new Error('This callback does not match the active agent sign-in.')
    // A CLI can echo its callback while handling it. Stop retaining diagnostics first.
    job.privateInput = true
    job.output = ''
    const response = await fetch(target, {
      redirect: 'manual',
      signal: AbortSignal.any([
        job.controller.signal,
        AbortSignal.timeout(10_000),
        ...(signal ? [signal] : []),
      ]),
    })
    await response.body?.cancel()
    if (response.status >= 400)
      throw new Error('The agent rejected the browser callback. Start sign-in again.')
  }

  cancel(id: string) {
    this.jobs.get(id)?.controller.abort()
  }
}
