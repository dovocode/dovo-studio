import { afterEach, expect, it, vi } from 'vite-plus/test'
import { dictationSession } from './dictation-session'
import type { DesktopDictationBridge } from '@dovo/protocol'
afterEach(async () => {
  await dictationSession.cancel()
  dictationSession.clear()
})
function fixture() {
  const bridge: DesktopDictationBridge = {
    status: async () => ({ engine: true, model: true, downloading: false, downloaded: 0 }),
    install: async () => {},
    start: vi.fn<DesktopDictationBridge['start']>(async () => {}),
    feed: vi.fn<DesktopDictationBridge['feed']>(async () => {}),
    finish: vi.fn<DesktopDictationBridge['finish']>(async () => 'Original transcript'),
    cancel: vi.fn<DesktopDictationBridge['cancel']>(async () => {}),
    subscribe: () => () => {},
  }
  const recorder = { stop: vi.fn<() => Promise<void>>(async () => {}), cancel: vi.fn<() => void>() }
  const accept = vi.fn<(text: string) => boolean>(() => false)
  return {
    bridge,
    recorder,
    accept,
    options: {
      scope: 'computer-a:thread-a',
      taskId: 'thread-a',
      runtimeId: 'computer-a',
      title: 'Original',
      bridge,
      language: 'auto' as const,
      capture: async () => recorder,
      accept,
    },
  }
}
it('keeps the original destination through navigation and retains text when its draft is no longer mounted', async () => {
  const f = fixture()
  await dictationSession.start(f.options)
  expect(dictationSession.read()?.phase).toBe('recording')
  await dictationSession.start({ ...f.options, scope: 'computer-b:thread-b', taskId: 'thread-b' })
  expect(f.bridge.start).toHaveBeenCalledTimes(1)
  await dictationSession.finish()
  expect(f.accept).toHaveBeenCalledWith('Original transcript')
  expect(dictationSession.read()).toMatchObject({
    scope: 'computer-a:thread-a',
    taskId: 'thread-a',
    phase: 'review',
    transcript: 'Original transcript',
  })
})
it('inserts only when the original draft accepts the transcript', async () => {
  const f = fixture()
  f.accept.mockReturnValue(true)
  await dictationSession.start(f.options)
  await dictationSession.finish()
  expect(dictationSession.read()).toBeUndefined()
  expect(f.recorder.stop).toHaveBeenCalledTimes(1)
})
it('ignores a late transcription after explicit cancellation', async () => {
  const f = fixture()
  let resolve!: (text: string) => void
  f.bridge.finish = vi.fn<DesktopDictationBridge['finish']>(
    () =>
      new Promise<string>((done) => {
        resolve = done
      }),
  )
  await dictationSession.start(f.options)
  const finishing = dictationSession.finish()
  await vi.waitFor(() => expect(f.bridge.finish).toHaveBeenCalledTimes(1))
  await dictationSession.cancel()
  resolve('Late text')
  await finishing
  expect(f.accept).not.toHaveBeenCalled()
  expect(dictationSession.read()).toBeUndefined()
})
it('stops capture and cancels the speech session when finishing fails', async () => {
  const f = fixture()
  f.recorder.stop.mockRejectedValue(new Error('Microphone disconnected'))
  await dictationSession.start(f.options)
  await dictationSession.finish()
  expect(f.recorder.cancel).toHaveBeenCalledTimes(1)
  expect(f.bridge.cancel).toHaveBeenCalledTimes(1)
  expect(f.accept).not.toHaveBeenCalled()
  expect(dictationSession.read()).toMatchObject({
    phase: 'error',
    error: 'Microphone disconnected',
  })
})
