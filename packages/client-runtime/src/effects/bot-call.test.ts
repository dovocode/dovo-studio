import { afterEach, expect, it, vi } from 'vite-plus/test'
import { createBotCall, botCallSpeech, type BotCallAudio } from './bot-call'
const cleanup: Array<() => void> = []
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn())
})
function setup(send = vi.fn<(id: string, text: string) => Promise<void>>(async () => {})) {
  const recordings: Array<{ signal: AbortSignal; events: Parameters<BotCallAudio['listen']>[1] }> =
    []
  const spoken: Array<{ text: string; signal: AbortSignal; done(): void }> = []
  const audio: BotCallAudio = {
    async listen(signal, events) {
      recordings.push({ signal, events })
    },
    speak: (text, signal) =>
      new Promise<void>((resolve) => {
        spoken.push({ text, signal, done: resolve })
      }),
  }
  let count = 0
  const call = createBotCall(audio, send, () => 'message-' + ++count)
  cleanup.push(call.end)
  return { call, recordings, spoken, send }
}
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}
it('delivers a turn once, reads only its reply, interrupts playback and keeps listening', async () => {
  const f = setup()
  f.call.start()
  await flush()
  f.recordings[0].events.preview('Hello')
  f.recordings[0].events.finish('Hello')
  f.recordings[0].events.finish('Duplicate')
  await flush()
  expect(f.send).toHaveBeenCalledExactlyOnceWith('message-1', 'Hello')
  expect(f.recordings[0].signal.aborted).toBe(true)
  f.call.sync(
    [
      { id: 'routine', status: 'completed', text: 'Unrelated result' },
      { id: 'message-1', status: 'completed', text: 'Hello back' },
    ],
    { available: true, needsInput: false },
  )
  expect(f.spoken.map((s) => s.text)).toEqual(['Hello back'])
  expect(f.recordings[1].signal.aborted).toBe(true)
  f.call.interrupt()
  await flush()
  expect(f.spoken[0].signal.aborted).toBe(true)
  expect(f.call.getSnapshot().phase).toBe('listening')
  f.spoken[0].done()
  await flush()
  expect(f.recordings).toHaveLength(3)
})
it('retries an uncertain send with the same identity and text, including an early reply', async () => {
  const send = vi
    .fn<(id: string, text: string) => Promise<void>>()
    .mockRejectedValueOnce(new Error('Connection lost'))
    .mockResolvedValue(undefined)
  const f = setup(send)
  f.call.start()
  await flush()
  f.recordings[0].events.finish('Keep this request')
  await flush()
  expect(f.call.getSnapshot()).toMatchObject({ phase: 'error', retrySend: true })
  f.call.sync([{ id: 'message-1', status: 'completed', text: 'Already done' }], {
    available: true,
    needsInput: false,
  })
  f.call.retry()
  f.call.retry()
  await flush()
  expect(send.mock.calls).toEqual([
    ['message-1', 'Keep this request'],
    ['message-1', 'Keep this request'],
  ])
  expect(f.spoken[0].text).toBe('Already done')
})
it('stops microphone on Mute, keeps reply playback, and waits for explicit recovery after disconnect', async () => {
  const f = setup()
  f.call.start()
  await flush()
  f.recordings[0].events.finish('Check')
  await flush()
  f.call.mute()
  expect(f.recordings.at(-1)?.signal.aborted).toBe(true)
  f.call.sync([{ id: 'message-1', status: 'completed', text: 'Checked' }], {
    available: true,
    needsInput: false,
  })
  expect(f.spoken).toHaveLength(1)
  f.call.sync([], { available: false, needsInput: false })
  expect(f.spoken[0].signal.aborted).toBe(true)
  f.call.sync([], { available: true, needsInput: false })
  expect(f.call.getSnapshot().phase).toBe('error')
})
it('pauses for human input and never treats a spoken answer as an approval', async () => {
  const f = setup()
  f.call.start()
  await flush()
  f.call.sync([], { available: true, needsInput: true })
  expect(f.recordings[0].signal.aborted).toBe(true)
  expect(f.call.getSnapshot().phase).toBe('needs-input')
  f.recordings[0].events.finish('Yes')
  await flush()
  expect(f.send).not.toHaveBeenCalled()
  f.call.sync([], { available: true, needsInput: false })
  await flush()
  expect(f.call.getSnapshot().phase).toBe('listening')
})
it('releases old calls and ignores late audio, sends and playback after End', async () => {
  let sent!: () => void
  const f = setup(
    vi.fn(
      () =>
        new Promise<void>((resolve) => {
          sent = resolve
        }),
    ),
  )
  f.call.start()
  await flush()
  f.recordings[0].events.finish('Work')
  const other = setup()
  other.call.start()
  await flush()
  expect(f.call.getSnapshot().phase).toBe('ended')
  sent()
  await flush()
  f.recordings[0].events.finish('Late')
  f.call.sync([{ id: 'message-1', status: 'completed', text: 'Late answer' }], {
    available: true,
    needsInput: false,
  })
  expect(f.spoken).toHaveLength(0)
  expect(f.recordings).toHaveLength(1)
  expect(f.send).toHaveBeenCalledTimes(1)
})
it('keeps speech bounded and leaves code and links in chat', () => {
  expect(
    botCallSpeech('Hello **Dominic**. [Source](https://example.test). ```ts\nsecretCode()\n```'),
  ).toBe('Hello Dominic. Source.  Code is in the chat.')
  expect(botCallSpeech('x'.repeat(1000000)).length).toBeLessThan(3500)
  expect(botCallSpeech('```unfinished code')).not.toContain('unfinished code')
})
