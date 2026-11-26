import {
  dictationStatusSchema,
  dictationUpdateSchema,
  decode,
  randomUUID,
  type DesktopDictationBridge,
  type DictationLanguage,
} from '@dovo/protocol'

export type DictationState = {
  id: string
  scope: string
  taskId: string
  runtimeId?: string
  title: string
  remote?: boolean
  transient?: true
  phase: 'starting' | 'recording' | 'transcribing' | 'review' | 'error'
  preview: string
  transcript: string
  error: string
}
type Recorder = { stop(): Promise<void>; cancel(): void }
type Capture = (
  signal: AbortSignal,
  stop: () => void,
  fail: (error: Error) => void,
  feed: (pcm: ArrayBuffer) => void,
) => Promise<Recorder>
type Active = {
  state: DictationState
  bridge: DesktopDictationBridge
  abort: AbortController
  recorder?: Recorder
  unsubscribe?: () => void
  pending: Promise<void>
  accept: (text: string) => boolean
}
let active: Active | undefined
const listeners = new Set<() => void>()
const composers = new Map<string, number>()
const notify = () => listeners.forEach((listener) => listener())
const publish = (session: Active, patch: Partial<DictationState>) => {
  if (active !== session) return
  session.state = { ...session.state, ...patch }
  notify()
}
export const dictationSession = {
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  read: () => active?.state,
  readBackground: () => {
    const state = active?.state
    if (state && !state.transient && !composers.has(state.scope)) return state
  },
  showInComposer(scope: string) {
    composers.set(scope, (composers.get(scope) ?? 0) + 1)
    notify()
    return () => {
      const remaining = (composers.get(scope) ?? 1) - 1
      if (remaining) composers.set(scope, remaining)
      else composers.delete(scope)
      notify()
    }
  },
  clear() {
    active = undefined
    notify()
  },
  async cancel() {
    const session = active
    if (!session) return
    session.abort.abort()
    session.recorder?.cancel()
    session.unsubscribe?.()
    // Keep the session visible if the speech computer cannot confirm cancellation.
    try {
      await session.bridge.cancel(session.state.id)
      if (active === session) this.clear()
    } catch (error) {
      publish(session, {
        phase: 'error',
        error: `Could not confirm dictation stopped: ${String(error)}`,
      })
    }
  },
  async finish() {
    const session = active
    if (!session?.recorder || session.state.phase !== 'recording') return
    publish(session, { phase: 'transcribing' })
    try {
      await session.recorder.stop()
      await session.pending
      if (active !== session || session.abort.signal.aborted) return
      const text = await session.bridge.finish(session.state.id)
      if (active !== session || session.abort.signal.aborted) return
      if (!text.trim()) throw new Error('No speech was detected. Please try again.')
      session.unsubscribe?.()
      if (session.accept(text)) this.clear()
      else
        publish(session, {
          phase: 'review',
          transcript: text,
        })
    } catch (error) {
      if (active === session && !session.abort.signal.aborted) {
        session.abort.abort()
        session.recorder?.cancel()
        session.unsubscribe?.()
        const message = error instanceof Error ? error.message : String(error)
        publish(session, {
          phase: 'error',
          error: message,
        })
        try {
          await session.bridge.cancel(session.state.id)
        } catch (cause) {
          publish(session, {
            error: `${message}. Could not confirm cancellation: ${String(cause)}`,
          })
        }
      }
    }
  },
  async start(options: {
    scope: string
    taskId: string
    runtimeId?: string
    title: string
    remote?: boolean
    transient?: true
    bridge: DesktopDictationBridge
    language: DictationLanguage
    capture: Capture
    accept: (text: string) => boolean
  }) {
    if (active) return
    const session: Active = {
      state: {
        id: randomUUID(),
        scope: options.scope,
        taskId: options.taskId,
        runtimeId: options.runtimeId,
        title: options.title,
        remote: options.remote,
        ...(options.transient && { transient: true as const }),
        phase: 'starting',
        preview: '',
        transcript: '',
        error: '',
      },
      bridge: options.bridge,
      abort: new AbortController(),
      pending: Promise.resolve(),
      accept: options.accept,
    }
    active = session
    notify()
    const fail = (error: Error) => {
      if (active !== session) return
      session.abort.abort()
      session.recorder?.cancel()
      session.unsubscribe?.()
      publish(session, { phase: 'error', error: error.message })
      void session.bridge.cancel(session.state.id).catch((cause: unknown) =>
        publish(session, {
          error: `${error.message}. Could not confirm cancellation: ${String(cause)}`,
        }),
      )
    }
    try {
      const status = decode(dictationStatusSchema, await options.bridge.status())
      if (active !== session || session.abort.signal.aborted) return
      if (!status.engine || !status.model)
        throw new Error('Download and enable dictation in Settings → General → Speech.')
      session.unsubscribe = session.bridge.subscribe(session.state.id, (value) => {
        if (active !== session || session.abort.signal.aborted) return
        try {
          const update = decode(dictationUpdateSchema, value)
          if (update.type === 'error') fail(new Error(update.message))
          else publish(session, { preview: update.text })
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
        }
      })
      await session.bridge.start(session.state.id, options.language)
      if (active !== session || session.abort.signal.aborted) return
      session.recorder = await options.capture(
        session.abort.signal,
        () => void this.finish(),
        fail,
        (pcm) => {
          session.pending = session.pending
            .then(async () => {
              if (active === session && !session.abort.signal.aborted)
                await session.bridge.feed(session.state.id, pcm)
            })
            .catch((error: unknown) =>
              fail(error instanceof Error ? error : new Error(String(error))),
            )
        },
      )
      if (active !== session || session.abort.signal.aborted) {
        session.recorder.cancel()
        return
      }
      publish(session, { phase: 'recording' })
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)))
    }
  },
}
