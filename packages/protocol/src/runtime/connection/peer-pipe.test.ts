/// <reference types="node" />
import { connect, createServer, type Socket } from 'node:net'
import { once } from 'node:events'
import { expect, it, vi } from 'vite-plus/test'
import { createPeerPipe } from './peer-pipe.js'

function fixture(writeError?: Error, sendError?: Error, window?: 8 | 64) {
  let data: (chunk: Uint8Array) => void = () => {},
    end: () => void = () => {},
    closed: (hadError?: boolean) => void = () => {},
    error: () => void = () => {}
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
      onClose: (f) => {
        closed = f
      },
      onError: (f) => {
        error = f
      },
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
    closed: (hadError?: boolean) => closed(hadError),
    error: () => error(),
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
  expect(Buffer.concat(sent).equals(bytes)).toBe(true)
  f.pipe.receive(new Uint8Array([0, 255, 128]))
  expect(f.send.mock.calls.at(-1)?.[0]).not.toBe('ack')
  f.writes[0]!.done()
  expect(f.send.mock.calls.at(-1)?.[0]).toBe('ack')
})

it.each([8, 64] as const)(
  'drains the queued tail and waits for every socket-write ACK after graceful close (window %i)',
  (window) => {
    const f = fixture(undefined, undefined, window)
    const head = Uint8Array.from({ length: window * 16384 }, (_, i) => i % 251)
    const tail = Uint8Array.from({ length: 49152 }, (_, i) => (i + 19) % 251)
    f.pipe.ready()
    f.pipe.receive('end')
    f.data(head)
    f.data(tail)
    f.end()
    f.closed()
    expect(f.close).not.toHaveBeenCalled()
    expect(f.destroy).not.toHaveBeenCalled()
    for (let i = 0; i < window + 2; i++) {
      f.pipe.receive('ack')
      expect(f.close).not.toHaveBeenCalled()
    }
    const frames = f.send.mock.calls.map(([frame]) => frame)
    const data = frames.filter((frame): frame is Uint8Array => frame instanceof Uint8Array)
    // Compare every byte without deep-enumerating a megabyte of indexed properties.
    expect(Buffer.concat(data).equals(Buffer.concat([head, tail]))).toBe(true)
    expect(frames.at(-1)).toBe('end')
    expect(frames.filter((frame) => frame === 'end')).toHaveLength(1)
    f.pipe.receive('ack')
    expect(f.close).toHaveBeenCalledOnce()
    expect(f.destroy).toHaveBeenCalledOnce()
    f.closed()
    expect(f.close).toHaveBeenCalledOnce()
  },
)

it.each(['error', 'stop', 'abort', 'error-close'] as const)(
  'keeps %s teardown immediate while outbound frames await ACKs',
  (reason) => {
    const f = fixture()
    f.pipe.ready()
    f.data(new Uint8Array(16384 * 9))
    if (reason !== 'abort') {
      f.pipe.receive('end')
      f.end()
      if (reason !== 'error-close') {
        f.closed()
      }
    }
    expect(f.close).not.toHaveBeenCalled()
    if (reason === 'error') f.error()
    else if (reason === 'stop') f.pipe.stop()
    else if (reason === 'error-close') f.closed(true)
    else f.closed()
    expect(f.close).toHaveBeenCalledOnce()
    expect(f.destroy).toHaveBeenCalledOnce()
    const count = f.send.mock.calls.length
    f.pipe.receive('ack')
    expect(f.send).toHaveBeenCalledTimes(count)
  },
)

it('finishes an already acknowledged transfer when the socket closes', () => {
  const f = fixture()
  f.pipe.ready()
  f.pipe.receive('end')
  f.data(new Uint8Array([42]))
  f.end()
  f.pipe.receive('ack')
  expect(f.close).not.toHaveBeenCalled()
  f.closed()
  expect(f.close).toHaveBeenCalledOnce()
  expect(f.destroy).toHaveBeenCalledOnce()
})

it.each([8, 64] as const)(
  'preserves a real TCP response after early remote END until its final ACK (window %i)',
  async (window) => {
    const payload = Buffer.from(Uint8Array.from({ length: 1024 * 1024 }, (_, i) => i % 251))
    const serverErrors: Error[] = []
    let source: Socket | undefined
    const server = createServer({ allowHalfOpen: true }, (socket) => {
      source = socket
      socket.on('error', (error) => serverErrors.push(error))
      socket.end(payload)
    })
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No TCP listener')
    const socket = connect({ host: '127.0.0.1', port: address.port, allowHalfOpen: true })
    const frames: Uint8Array[] = []
    const close = vi.fn<() => void>()
    let ended = false,
      sentBytes = 0
    const pipe = createPeerPipe({
      window,
      stream: {
        onData: (f) => {
          socket.on('data', f)
        },
        onEnd: (f) => {
          socket.on('end', f)
        },
        onClose: (f) => {
          socket.on('close', f)
        },
        onError: (f) => {
          socket.on('error', f)
        },
        write: (bytes, done) => {
          socket.write(bytes, done)
        },
        pause: () => {
          socket.pause()
        },
        resume: () => {
          socket.resume()
        },
        end: () => {
          socket.end()
        },
        destroy: () => {
          socket.destroy()
        },
      },
      send: (frame) => {
        if (frame instanceof Uint8Array) {
          frames.push(frame)
          sentBytes += frame.byteLength
          // Model receiver backpressure, retaining the final ACK until local TCP close.
          if (sentBytes < payload.length) setImmediate(() => pipe.receive('ack'))
        } else if (frame === 'end') ended = true
      },
      close,
    })
    try {
      const closed = once(socket, 'close')
      pipe.ready()
      pipe.receive('end')
      await closed
      expect(ended).toBe(true)
      expect(Buffer.concat(frames).equals(payload)).toBe(true)
      expect(serverErrors).toEqual([])
      expect(close).not.toHaveBeenCalled()
      pipe.receive('ack')
      expect(close).toHaveBeenCalledOnce()
    } finally {
      pipe.stop()
      socket.destroy()
      source?.destroy()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    }
  },
)
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
