export type BotCallReply = {
  id: string
  status: 'waiting' | 'completed' | 'failed'
  text?: string
  error?: string
}
export type BotCallState = {
  phase:
    | 'idle'
    | 'starting'
    | 'listening'
    | 'sending'
    | 'waiting'
    | 'speaking'
    | 'needs-input'
    | 'error'
    | 'ended'
  muted: boolean
  heard: string
  reply: string
  error: string
  retrySend: boolean
  continuous: boolean
}
export type BotCallAudio = {
  listen(
    signal: AbortSignal,
    events: {
      preview: (text: string) => void
      finish: (text: string) => void
      error: (error: Error) => void
      speechStarted?: () => void
      released?: () => void
    },
  ): Promise<void>
  speak(text: string, signal: AbortSignal): Promise<void>
}
let owner: (() => void) | undefined
/** One microphone owner per client. Calls never cancel agent work or edit the composer draft. */
export function createBotCall(
  audio: BotCallAudio,
  send: (id: string, text: string) => Promise<void>,
  newId: () => string,
) {
  let state: BotCallState = {
    phase: 'idle',
    muted: false,
    heard: '',
    reply: '',
    error: '',
    retrySend: false,
    continuous: false,
  }
  const subscribers = new Set<() => void>()
  let active = false,
    epoch = 0,
    capture: AbortController | undefined,
    speech: AbortController | undefined
  let sending: { id: string; text: string } | undefined
  let delivering = false
  const queued: { id: string; text: string }[] = []
  const processing = new Set<AbortController>()
  const pending = new Set<string>()
  const completed = new Map<string, BotCallReply>()
  let needsInput = false
  const update = (patch: Partial<BotCallState>) => {
    state = { ...state, ...patch }
    subscribers.forEach((fn) => fn())
  }
  const stopCapture = () => {
    capture?.abort()
    capture = undefined
  }
  const stopSpeech = () => {
    speech?.abort()
    speech = undefined
  }
  const fail = (error: unknown) => {
    if (!active) return
    epoch++
    stopCapture()
    for (const controller of processing) controller.abort()
    processing.clear()
    stopSpeech()
    update({
      phase: 'error',
      error: error instanceof Error ? error.message : String(error),
      retrySend: !!sending,
    })
  }
  const listen = async () => {
    if (
      !active ||
      state.muted ||
      capture ||
      (!state.continuous && (speech || sending)) ||
      queued.length >= 4 ||
      processing.size >= 4 ||
      needsInput ||
      state.phase === 'error'
    )
      return
    const own = new AbortController(),
      generation = epoch
    capture = own
    if (!speech && !sending) update({ phase: 'starting' })
    try {
      await audio.listen(own.signal, {
        released: () => {
          if (capture !== own || !active || !state.continuous) return
          capture = undefined
          processing.add(own)
          if (!speech && !sending) update({ phase: 'waiting' })
          void listen()
        },
        speechStarted: () => {
          if (capture === own && state.continuous) {
            stopSpeech()
            if (!sending) update({ phase: 'listening' })
          }
        },
        preview: (text) => {
          if (capture === own) update({ heard: text })
        },
        finish: (text) => {
          if ((capture !== own && !processing.has(own)) || !active) return
          processing.delete(own)
          if (capture === own) stopCapture()
          else own.abort()
          const value = text.trim()
          if (value.length > 12000) {
            fail(new Error('This voice message is too long. Use the chat to send it.'))
            return
          }
          // Speech recognizers can emit punctuation for room noise or silence.
          if (/[\p{L}\p{N}]/u.test(value)) {
            queued.push({ id: newId(), text: value })
            update({ heard: value })
            if (!sending) {
              sending = queued.shift()
              void deliver()
            } else pump()
          } else {
            update({ heard: '' })
            pump()
          }
        },
        error: (error) => {
          if (capture === own || processing.has(own)) fail(error)
        },
      })
      if (capture === own && generation === epoch && !speech && !sending)
        update({ phase: pending.size ? 'waiting' : 'listening' })
    } catch (error) {
      if (capture === own && !own.signal.aborted) fail(error)
    }
  }
  const deliver = async () => {
    const item = sending,
      generation = epoch
    if (!item || !active || delivering || needsInput) return
    delivering = true
    update({ phase: 'sending', error: '', retrySend: false })
    if (state.continuous) void listen()
    try {
      await send(item.id, item.text)
      delivering = false
      if (!active || generation !== epoch || sending !== item) return
      pending.add(item.id)
      sending = queued.shift()
      if (sending) {
        void deliver()
        return
      }
      pump()
    } catch (error) {
      delivering = false
      if (active && generation === epoch) fail(error)
    }
  }
  const pump = () => {
    if (!active || state.phase === 'error') return
    if (needsInput) {
      stopCapture()
      update({ phase: 'needs-input' })
      return
    }
    if (sending || speech) {
      if (sending && !delivering) void deliver()
      if (state.continuous) void listen()
      return
    }
    const next = [...pending]
      .map((id) => completed.get(id))
      .find((reply) => reply && reply.status !== 'waiting')
    if (next) {
      pending.delete(next.id)
      completed.delete(next.id)
      if (next.status === 'failed') {
        fail(new Error(next.error || 'The Bot stopped. Review the conversation before continuing.'))
        return
      }
      if (!state.continuous) stopCapture()
      const text = next.text?.trim()
      if (!text) {
        pump()
        return
      }
      update({ reply: text.length > 12000 ? text.slice(0, 12000) + '\nFull reply in chat.' : text })
      const own = new AbortController()
      speech = own
      update({ phase: 'speaking' })
      void audio.speak(text, own.signal).then(
        () => {
          if (speech === own) {
            speech = undefined
            pump()
          }
        },
        (error) => {
          if (speech === own && !own.signal.aborted) fail(error)
        },
      )
      if (state.continuous) void listen()
      return
    }
    if (state.muted) {
      stopCapture()
      update({ phase: pending.size ? 'waiting' : 'listening' })
      return
    }
    void listen()
  }
  const end = () => {
    active = false
    epoch++
    stopCapture()
    for (const controller of processing) controller.abort()
    processing.clear()
    stopSpeech()
    pending.clear()
    completed.clear()
    sending = undefined
    queued.length = 0
    if (owner === end) owner = undefined
    update({ phase: 'ended', retrySend: false })
  }
  return {
    subscribe: (fn: () => void) => {
      subscribers.add(fn)
      return () => {
        subscribers.delete(fn)
      }
    },
    getSnapshot: () => state,
    requests: () => [
      ...pending,
      ...(sending ? [sending.id] : []),
      ...queued.map((item) => item.id),
    ],
    setContinuous(enabled: boolean) {
      stopCapture()
      update({ continuous: enabled })
      if (active) pump()
    },
    start() {
      if (active) return
      owner?.()
      owner = end
      active = true
      needsInput = false
      update({ phase: 'idle', error: '', muted: false })
      pump()
    },
    end,
    mute() {
      if (!active) return
      const muted = !state.muted
      stopCapture()
      update({ muted })
      pump()
    },
    interrupt() {
      if (!active) return
      stopSpeech()
      stopCapture()
      update({ phase: 'idle', muted: false })
      pump()
    },
    retry() {
      if (!active || state.phase !== 'error') return
      update({ phase: 'idle', error: '' })
      if (sending) void deliver()
      else pump()
    },
    sync(
      replies: readonly BotCallReply[],
      input: { available: boolean; needsInput: boolean; error?: string },
    ) {
      if (!active) return
      if (!input.available) {
        fail(new Error(input.error || 'Connection lost. Reconnect before continuing the call.'))
        return
      }
      needsInput = input.needsInput
      if (needsInput) {
        stopCapture()
        stopSpeech()
      }
      for (const reply of replies) completed.set(reply.id, reply)
      // Bound the cache to requests from this call, including an acknowledgement still in flight.
      for (const id of completed.keys())
        if (!pending.has(id) && sending?.id !== id) completed.delete(id)
      pump()
    },
  }
}
/** Speak bounded plain text. Keep code and links in chat. */
export function botCallSpeech(text: string) {
  const plain = text
    .slice(0, 24000)
    .replace(/```[\s\S]*?(?:```|$)/g, ' Code is in the chat. ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'link in chat')
    .replace(/<[^>]+>/g, '')
    .replace(/[*#`_>|]/g, '')
    .trim()
  return plain.length > 3500 ? plain.slice(0, 3400) + '. The full answer is in the chat.' : plain
}
