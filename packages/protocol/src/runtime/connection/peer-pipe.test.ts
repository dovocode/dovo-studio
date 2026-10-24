import { expect, it, vi } from 'vite-plus/test'
import { createPeerPipe } from './peer-pipe.js'

function fixture(writeError?: Error, sendError?: Error, window?: 8 | 64) {
  let data: (chunk: Uint8Array) => void = () => {},
    end: () => void = () => {}
  const writes: Array<{ bytes: Uint8Array; done: (error?: Error | null) => void }> = []
  const send = vi.fn<(value: Uint8Array | string) => void>(() => {
      if (sendError) throw sendError
    }),
    close = vi.fn<() => void>(),
    destroy = vi.fn<() => void>(),
    remoteEnd = vi.fn<() => void>()
  const resume = vi.fn<() => void>()
  const pipe = createPeerPipe({
    window,
    stream: {
      onData: (f) => {
        data = f
      },
      onEnd: (f) => {
        end = f
      },
      onClose: () => {},
      onError: () => {},
      write: (bytes, done) => {
        if (writeError) throw writeError
        writes.push({ bytes, done })
      },
      end: remoteEnd,
      pause: vi.fn<() => void>(),
      resume,
      destroy,
    },
    send,
    close,
  })
  return {
    pipe,
    data: (bytes: Uint8Array) => data(bytes),
    end: () => end(),
    writes,
    send,
    close,
    destroy,
    remoteEnd,
    resume,
  }
}
it('preserves binary bytes and limits send credits until the receiver flushes its socket', () => {
  const f = fixture(),
    bytes = Uint8Array.from({ length: 200000 }, (_, i) => i % 256)
  f.data(bytes)
  expect(f.send).not.toHaveBeenCalled()
  f.pipe.ready()
  expect(f.send).toHaveBeenCalledTimes(8)
  for (let i = 0; i < 5; i++) f.pipe.receive('ack')
  const sent = f.send.mock.calls
    .map(([part]) => part)
    .filter((part): part is Uint8Array => part instanceof Uint8Array)
  expect(new Uint8Array(sent.flatMap((part) => Array.from(part)))).toEqual(bytes)
  f.pipe.receive(new Uint8Array([0, 255, 128]))
  expect(f.send.mock.calls.at(-1)?.[0]).not.toBe('ack')
  f.writes[0]!.done()
  expect(f.send.mock.calls.at(-1)?.[0]).toBe('ack')
})
it('closes only the pipe when a native socket write throws during teardown', () => {
  const f = fixture(new Error('Socket is closed.'))
  f.pipe.ready()
  expect(() => f.pipe.receive(new Uint8Array([1]))).not.toThrow()
  expect(f.close).toHaveBeenCalledOnce()
  expect(f.destroy).toHaveBeenCalledOnce()
})
it('ignores late write callbacks after a pipe has stopped', () => {
  const f = fixture()
  f.pipe.ready()
  f.pipe.receive(new Uint8Array([1]))
  f.pipe.receive('end')
  f.pipe.stop()
  f.writes[0]!.done()
  expect(f.send).not.toHaveBeenCalled()
  expect(f.remoteEnd).not.toHaveBeenCalled()
})
it('does not resume a destroyed native socket after a data-channel send fails', () => {
  const f = fixture(undefined, new Error('Data channel is closed.'))
  f.data(new Uint8Array([1]))
  f.pipe.ready()
  expect(f.close).toHaveBeenCalledOnce()
  expect(f.destroy).toHaveBeenCalledOnce()
  expect(f.resume).not.toHaveBeenCalled()
})
it('sends END after queued bytes and keeps the reverse direction open', () => {
  const f = fixture()
  f.pipe.ready()
  f.data(new Uint8Array(16384 * 9))
  f.end()
  expect(f.send.mock.calls.some(([v]) => v === 'end')).toBe(false)
  f.pipe.receive('ack')
  expect(f.send.mock.calls.at(-1)?.[0]).toBe('end')
  f.pipe.receive(new Uint8Array([42]))
  expect(f.writes[0]?.bytes).toEqual(new Uint8Array([42]))
  f.pipe.receive('end')
  expect(f.remoteEnd).not.toHaveBeenCalled()
  f.writes[0]!.done()
  expect(f.remoteEnd).toHaveBeenCalledOnce()
  expect(f.close).not.toHaveBeenCalled()
})
it.each(['bogus', 'ack', new Uint8Array(16385), new Uint8Array(0)])(
  'closes invalid or over-credit frames',
  (frame) => {
    const f = fixture()
    f.pipe.ready()
    f.pipe.receive(frame)
    expect(f.close).toHaveBeenCalledOnce()
    expect(f.destroy).toHaveBeenCalledOnce()
  },
)
it('bounds inbound writes and outgoing queues and rejects data after END', () => {
  for (const attack of [
    (f: ReturnType<typeof fixture>) => {
      for (let i = 0; i < 9; i++) f.pipe.receive(new Uint8Array([1]))
    },
    (f: ReturnType<typeof fixture>) => f.data(new Uint8Array(1024 * 1024 + 1)),
    (f: ReturnType<typeof fixture>) => {
      f.pipe.receive('end')
      f.pipe.receive(new Uint8Array([1]))
    },
  ]) {
    const f = fixture()
    f.pipe.ready()
    attack(f)
    expect(f.close).toHaveBeenCalledOnce()
  }
})

it('negotiates a bounded 1 MiB window without changing legacy credit limits', () => {
  const legacy = fixture(),
    fast = fixture(undefined, undefined, 64)
  for (const f of [legacy, fast]) {
    f.pipe.ready()
    f.data(new Uint8Array(1024 * 1024))
  }
  expect(legacy.send).toHaveBeenCalledTimes(8)
  expect(fast.send).toHaveBeenCalledTimes(64)
  fast.data(new Uint8Array(16384))
  expect(fast.send).toHaveBeenCalledTimes(64)
  fast.pipe.receive('ack')
  expect(fast.send).toHaveBeenCalledTimes(65)
  expect(fast.close).not.toHaveBeenCalled()
  const receiving = fixture(undefined, undefined, 64)
  for (let i = 0; i < 64; i++) receiving.pipe.receive(new Uint8Array(16384))
  expect(receiving.close).not.toHaveBeenCalled()
  receiving.pipe.receive(new Uint8Array(1))
  expect(receiving.close).toHaveBeenCalledOnce()
})
