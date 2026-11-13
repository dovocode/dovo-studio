import { afterEach, expect, it, vi } from 'vite-plus/test'
import type { DesktopDictationBridge } from '@dovo/protocol'
import type { recordDictation } from '../chat/composer/dictation-audio'
import { browserBotCallAudio } from './bot-call-audio'
const recording = vi.hoisted(() => ({
  audio: undefined as ((pcm: ArrayBuffer) => void) | undefined,
  stop: vi.fn<() => Promise<void>>(async () => {}),
  cancel: vi.fn<() => void>(),
}))
vi.mock('../chat/composer/dictation-audio', () => ({
  recordDictation: vi.fn<typeof recordDictation>(
    async (
      _signal: AbortSignal,
      _limit: () => void,
      _error: (error: Error) => void,
      audio: (pcm: ArrayBuffer) => void,
    ) => {
      recording.audio = audio
      return recording
    },
  ),
}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}
function bridge() {
  const b: DesktopDictationBridge = {
    start: vi.fn<DesktopDictationBridge['start']>(async () => {}),
    feed: vi.fn<DesktopDictationBridge['feed']>(async () => {}),
    finish: vi.fn<DesktopDictationBridge['finish']>(async () => 'Recognized speech'),
    cancel: vi.fn<DesktopDictationBridge['cancel']>(async () => {}),
    status: vi.fn<DesktopDictationBridge['status']>(),
    install: vi.fn<DesktopDictationBridge['install']>(),
    subscribe: () => () => {},
  }
  return b
}
const samples = (value: number, count: number) => {
  const buffer = new ArrayBuffer(count * 2),
    view = new DataView(buffer)
  for (let at = 0; at < count * 2; at += 2) view.setInt16(at, value, true)
  return buffer
}
it('finishes once after speech and silence, using the configured transcription bridge', async () => {
  vi.stubGlobal('speechSynthesis', {})
  const b = bridge(),
    events = {
      preview: vi.fn<(text: string) => void>(),
      finish: vi.fn<(text: string) => void>(),
      error: vi.fn<(error: Error) => void>(),
    },
    signal = new AbortController()
  await browserBotCallAudio(b, 'nl-NL').listen(signal.signal, events)
  recording.audio!(samples(3000, 4000))
  recording.audio!(samples(0, 18000))
  await flush()
  expect(b.feed).toHaveBeenCalledTimes(2)
  expect(b.finish).toHaveBeenCalledTimes(1)
  expect(events.finish).toHaveBeenCalledExactlyOnceWith('Recognized speech')
  expect(events.error).not.toHaveBeenCalled()
})
it('recycles silence without transcription and releases audio on cancellation', async () => {
  vi.stubGlobal('speechSynthesis', {})
  const b = bridge(),
    events = {
      preview: vi.fn<(text: string) => void>(),
      finish: vi.fn<(text: string) => void>(),
      error: vi.fn<(error: Error) => void>(),
    },
    signal = new AbortController()
  await browserBotCallAudio(b, 'auto').listen(signal.signal, events)
  recording.audio!(samples(0, 480000))
  await flush()
  expect(events.finish).toHaveBeenCalledExactlyOnceWith('')
  expect(b.finish).not.toHaveBeenCalled()
  const other = new AbortController()
  await browserBotCallAudio(b, 'auto').listen(other.signal, events)
  other.abort()
  await flush()
  expect(recording.cancel).toHaveBeenCalledTimes(1)
  expect(b.cancel).toHaveBeenCalledTimes(2)
})
it('cancels an in-flight transcription and ignores its late result', async () => {
  vi.stubGlobal('speechSynthesis', {})
  const b = bridge()
  let resolve!: (value: string) => void
  vi.mocked(b.finish).mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done
      }),
  )
  const events = {
      preview: vi.fn<(text: string) => void>(),
      finish: vi.fn<(text: string) => void>(),
      error: vi.fn<(error: Error) => void>(),
    },
    signal = new AbortController()
  await browserBotCallAudio(b, 'auto').listen(signal.signal, events)
  recording.audio!(samples(3000, 4000))
  recording.audio!(samples(0, 18000))
  await flush()
  signal.abort()
  await flush()
  resolve('Late')
  await flush()
  expect(b.cancel).toHaveBeenCalledTimes(1)
  expect(events.finish).not.toHaveBeenCalled()
})
