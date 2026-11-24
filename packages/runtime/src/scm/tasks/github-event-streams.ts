import { EventSourceParserStream } from 'eventsource-parser/stream'
import { z } from 'zod'
import { opaqueIdentity, type SourceContext } from '../forges/integration/source-context.js'

const subscriptions = 'https://api.github.com/event-subscriptions'
const eventTypes = [
  'check_suite.status.changed',
  'head.changed',
  'merge_conflict',
  'review.submitted',
  'state.changed',
].map((name) => `com.github.pull_request.${name}.v1`)
const subscription = z.object({
  events_url: z.string().regex(/^https:\/\/api\.github\.com\/event-subscriptions\/[\w-]+\/events$/),
})
type Listener = {
  identity: string
  controller: AbortController
  retryAt: number
  eventsUrl?: string
}

/** Regular PR watch checks revalidate the account and retry interrupted streams. */
export class GithubEventStreams {
  private listeners = new Map<string, Listener>()

  constructor(private changed: (key: string) => void) {}

  has(key: string) {
    return this.listeners.has(key)
  }

  forget(key: string) {
    this.listeners.get(key)?.controller.abort()
    this.listeners.delete(key)
  }

  retain(keys: Set<string>) {
    for (const key of this.listeners.keys()) if (!keys.has(key)) this.forget(key)
  }

  watch(
    key: string,
    url: string,
    number: number,
    scope: SourceContext,
    unavailable: (status: number) => void,
  ) {
    const account = scope.github
    if (
      !account ||
      scope.provider !== 'github' ||
      scope.host.toLowerCase() !== 'github.com' ||
      url.toLowerCase() !== `https://github.com/${scope.repository.toLowerCase()}/pull/${number}`
    ) {
      this.forget(key)
      return
    }
    scope.validate()
    const identity = opaqueIdentity([scope.destination, account.token])
    const previous = this.listeners.get(key)
    if (previous?.identity === identity && previous.retryAt > Date.now()) return
    this.forget(key)
    const listener: Listener = {
      identity,
      controller: new AbortController(),
      retryAt: Infinity,
      eventsUrl: previous?.identity === identity ? previous.eventsUrl : undefined,
    }
    this.listeners.set(key, listener)
    const { signal } = listener.controller
    // GitHub sends an idle comment every 15 seconds. A half-open socket may never report EOF.
    const idle = setTimeout(() => {
      listener.retryAt = Date.now() + 30_000
      listener.controller.abort()
    }, 45_000)
    signal.addEventListener('abort', () => clearTimeout(idle), { once: true })
    const request = async (
      endpoint: string,
      init: { headers: Record<string, string>; method?: 'POST'; body?: string },
    ) => {
      scope.validate()
      const response = await fetch(endpoint, {
        ...init,
        redirect: 'error',
        headers: {
          ...init.headers,
          'User-Agent': 'dovo-studio',
          Authorization: `Bearer ${account.token}`,
        },
        signal,
      })
      if (!response.ok) {
        await response.body?.cancel()
        if (signal.aborted) return null
        if (response.status === 401) account.onUnauthorized?.()
        if (response.status === 404) listener.eventsUrl = undefined
        const reset =
          response.headers.get('x-ratelimit-remaining') === '0'
            ? Number(response.headers.get('x-ratelimit-reset')) * 1000
            : 0
        if (
          !reset &&
          !response.headers.has('retry-after') &&
          ([400, 401, 403, 422].includes(response.status) ||
            (response.status === 404 && endpoint === subscriptions))
        ) {
          unavailable(response.status)
          return null
        }
        listener.retryAt = Math.max(
          reset,
          Date.now() + Math.max(30, Number(response.headers.get('retry-after')) || 0) * 1000,
        )
        return null
      }
      idle.refresh()
      return response
    }
    const listen = async () => {
      if (!listener.eventsUrl) {
        const created = await request(subscriptions, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/vnd.github+json' },
          body: JSON.stringify({ resource_url: url, event_types: eventTypes }),
        })
        if (!created) return
        listener.eventsUrl = subscription.parse(await created.json()).events_url
      }
      const stream = await request(listener.eventsUrl, { headers: { Accept: 'text/event-stream' } })
      if (!stream) return
      if (!stream.body || !stream.headers.get('content-type')?.startsWith('text/event-stream')) {
        await stream.body?.cancel()
        throw new Error('Expected a GitHub event stream')
      }
      const notify = () => {
        if (signal.aborted) return
        scope.validate()
        this.changed(key)
      }
      notify() // The stream has no replay. Catch up after every successful open.
      const events = stream.body.pipeThrough(new TextDecoderStream()).pipeThrough(
        new EventSourceParserStream({
          maxBufferSize: 256 * 1024,
          onComment: () => idle.refresh(),
        }),
      )
      for await (const message of events) {
        idle.refresh()
        if (message.event === 'github.stream.end') {
          const end = z.object({ outcome: z.string() }).safeParse(JSON.parse(message.data))
          if (!end.success || end.data.outcome !== 'reconnect') listener.eventsUrl = undefined
          break
        }
        if (message.event && eventTypes.includes(message.event)) notify()
      }
      listener.retryAt = Date.now() + 30_000
    }
    void listen()
      .catch(() => {
        listener.retryAt = Date.now() + 30_000
      })
      .finally(() => listener.controller.abort())
  }
}
