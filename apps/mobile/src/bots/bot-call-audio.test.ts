import { afterEach, expect, it, vi } from 'vite-plus/test'
import type { DictationCallbacks } from '../tasks/composer/dictation'
import { mobileBotCallAudio } from './bot-call-audio'
const native = vi.hoisted(() => ({
  callbacks: undefined as DictationCallbacks | undefined,
  cancel: vi.fn<() => void>(),
  stop: vi.fn<() => void>(),
  error: null as string | null,
  stopping: false,
  changed: () => {},
  speech: undefined as
    | { onDone?: () => void; onError?: (e: Error) => void; onStopped?: () => void }
    | undefined,
  speechStop: vi.fn<() => Promise<void>>(async () => {}),
}))
vi.mock('../tasks/composer/use-dictation', () => ({
  createMobileDictation: () => ({
    activate() {},
    start: async (callbacks: DictationCallbacks) => {
      native.callbacks = callbacks
    },
    stop: native.stop,
    cancel: native.cancel,
    getSnapshot: () => ({ error: native.error, locale: 'nl-NL', isStopping: native.stopping }),
    subscribe: (fn: () => void) => {
      native.changed = fn
      return () => {
        native.changed = () => {}
      }
    },
  }),
}))
vi.mock('expo-speech', () => ({
  speak: (_text: string, options: typeof native.speech) => {
    native.speech = options
  },
  stop: native.speechStop,
}))
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  native.error = null
  native.stopping = false
})
it('finishes recognition after a pause and cancels the owned native microphone on End', async () => {
  vi.useFakeTimers()
  const signal = new AbortController(),
    events = {
      preview: vi.fn<(text: string) => void>(),
      finish: vi.fn<(text: string) => void>(),
      error: vi.fn<(error: Error) => void>(),
    }
  await mobileBotCallAudio().listen(signal.signal, events)
  native.callbacks!.onResult('Hallo')
  await vi.advanceTimersByTimeAsync(1000)
  expect(native.stop).not.toHaveBeenCalled()
  native.callbacks!.onResult('Hallo Ada')
  await vi.advanceTimersByTimeAsync(1100)
  expect(native.stop).toHaveBeenCalledTimes(1)
  native.callbacks!.onFinish('Hallo Ada')
  expect(events.finish).toHaveBeenCalledExactlyOnceWith('Hallo Ada')
  const other = new AbortController()
  await mobileBotCallAudio().listen(other.signal, events)
  other.abort()
  expect(native.cancel).toHaveBeenCalledTimes(1)
  native.callbacks!.onFinish('Late words')
  expect(events.finish).toHaveBeenCalledTimes(1)
})
it('rejects permission failures and releases speech playback on interruption', async () => {
  native.error = 'Microphone access denied'
  await expect(
    mobileBotCallAudio().listen(new AbortController().signal, {
      preview: vi.fn<(text: string) => void>(),
      finish: vi.fn<(text: string) => void>(),
      error: vi.fn<(error: Error) => void>(),
    }),
  ).rejects.toThrow('Microphone access denied')
  native.error = null
  native.stopping = false
  const signal = new AbortController(),
    pending = mobileBotCallAudio().speak('Dag', signal.signal)
  signal.abort()
  await pending
  expect(native.speechStop).toHaveBeenCalledTimes(1)
})

it('waits for the old microphone to stop before a new call can capture', async () => {
  const first = new AbortController(),
    events = {
      preview: vi.fn<(text: string) => void>(),
      finish: vi.fn<(text: string) => void>(),
      error: vi.fn<(error: Error) => void>(),
    }
  await mobileBotCallAudio().listen(first.signal, events)
  native.cancel.mockImplementationOnce(() => {
    native.stopping = true
  })
  first.abort()
  let started = false
  const second = mobileBotCallAudio()
    .listen(new AbortController().signal, events)
    .then(() => {
      started = true
    })
  await Promise.resolve()
  expect(started).toBe(false)
  native.stopping = false
  native.changed()
  await second
  expect(started).toBe(true)
})
