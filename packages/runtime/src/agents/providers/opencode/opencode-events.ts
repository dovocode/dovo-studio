import {
  ClientError,
  type FormInfo,
  type OpenCodeClient,
  type SessionEventDurable,
  type V2Event,
} from '@opencode/client'
import { setTimeout as delay } from 'node:timers/promises'

/** Reconnect reads state only. It never resubmits a prompt or a provider command. */
export async function* opencodeEvents(
  api: OpenCodeClient,
  sessionID: string,
  signal: AbortSignal,
  state: () => { submitted: boolean; parentFinished: boolean; children?: readonly string[] },
  activity: (text: string) => void,
): AsyncGenerator<
  | V2Event
  | SessionEventDurable
  | { id: string; created: number; type: 'form.created'; data: { form: FormInfo } }
> {
  let cursor: number | undefined
  let reconnect = false
  let attempts = 0
  while (!signal.aborted) {
    const iterator = api.event.subscribe({ signal })[Symbol.asyncIterator]()
    try {
      while (!signal.aborted) {
        // Catch transport failures here, never errors from the consumer's event handler.
        let next: IteratorResult<V2Event>
        try {
          next = await iterator.next()
        } catch (error) {
          if (!(error instanceof ClientError) || error.reason !== 'Transport') throw error
          break
        }
        if (next.done) break
        const event = next.value
        if (event.type === 'server.connected' && reconnect) {
          const current = state()
          if (current.submitted && !current.parentFinished && cursor === undefined)
            throw new Error(
              'OpenCode disconnected before its execution identity was received. Review the session before retrying.',
            )
          // Refresh jobs/goals/checklist before replaying a possible terminal event.
          yield event
          if (current.submitted && !current.parentFinished) {
            let count = 0
            for await (const saved of api.experimental.session.log(
              { sessionID, after: cursor, follow: false },
              { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
            )) {
              if (saved.type === 'log.synced') continue
              if (++count > 2000) throw new Error('OpenCode recovery exceeds the event limit.')
              if (saved.data.sessionID !== sessionID || saved.durable.seq <= (cursor ?? -1))
                continue
              yield saved
              cursor = saved.durable.seq
            }
          }
          if (current.submitted) {
            // Child requests can arrive while disconnected, including after the parent ends.
            const sessions = new Set([
              ...(!current.parentFinished ? [sessionID] : []),
              ...(current.children ?? []),
            ])
            // Permission and form events are not durable. Read pending requests again.
            const [permissions, forms] = await Promise.all([
              api.permission.request.list(
                {},
                { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
              ),
              Promise.all([...sessions].map((id) => api.session.form.list(
                { sessionID: id },
                { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]) },
              ))),
            ])
            for (const request of permissions.data)
              if (sessions.has(request.sessionID))
                yield {
                  id: request.id,
                  created: Date.now(),
                  type: 'permission.asked',
                  data: request,
                }
            for (const form of forms.flat())
              yield { id: form.id, created: Date.now(), type: 'form.created', data: { form } }
          }
          reconnect = false
          continue
        }
        const root =
          'durable' in event && 'sessionID' in event.data && event.data.sessionID === sessionID
        if (root && event.durable.seq <= (cursor ?? -1)) continue
        yield event
        if (root) cursor = event.durable.seq
      }
    } finally {
      await iterator.return?.()
    }
    if (signal.aborted) return
    if (++attempts > 3)
      throw new Error(
        'OpenCode event connection could not be restored. Review the session before retrying.',
      )
    activity('Reconnecting to OpenCode. No work will be replayed.')
    await delay(250 * 2 ** (attempts - 1), undefined, { signal })
    reconnect = true
  }
}
