/** Credit-limited, ordered TCP framing over one reliable WebRTC data channel.
 * Acknowledging after socket.write completes bounds both native and JS queues.
 * END preserves half-close; closing a data channel prematurely truncates downloads. */
export function createPeerPipe(options: {
  stream: {
    onData: (callback: (bytes: Uint8Array) => void) => void
    onEnd: (callback: () => void) => void
    onClose: (callback: (hadError?: boolean) => void) => void
    onError: (callback: () => void) => void
    write: (bytes: Uint8Array, callback: (error?: Error | null) => void) => void
    pause: () => void
    resume: () => void
    end: () => void
    destroy: () => void
  }
  send: (value: Uint8Array | string) => void
  close: () => void
  window?: 8 | 64
}) {
  const { stream } = options
  const window = options.window ?? 8
  let ready = false,
    stopped = false,
    sourceClosed = false,
    sourceEnded = false,
    sentEnd = false,
    receivedEnd = false
  let credits = window,
    received = 0,
    bytes = 0
  const queue: Uint8Array[] = []
  stream.pause()
  const stop = () => {
    if (stopped) return
    stopped = true
    queue.length = 0
    stream.destroy()
    options.close()
  }
  const send = (value: Uint8Array | string) => {
    if (stopped) return
    try {
      options.send(value)
    } catch {
      stop()
    }
  }
  const finish = () => {
    // A graceful socket close can precede delivery of the data-channel tail. Credits
    // return only after the peer's socket writes finish, including under backpressure.
    if (sourceClosed && sentEnd && credits === window && received === 0) stop()
  }
  const flush = () => {
    if (!ready || stopped) return
    while (credits > 0 && queue.length && !stopped) {
      const chunk = queue.shift()!
      bytes -= chunk.byteLength
      credits--
      send(chunk)
    }
    if (stopped) return
    if (!queue.length && sourceEnded && !sentEnd) {
      sentEnd = true
      send('end')
    }
    if (stopped) return
    if (credits > 0 && !queue.length && !sourceEnded) stream.resume()
    else stream.pause()
    finish()
  }
  stream.onData((chunk) => {
    if (stopped) return
    stream.pause()
    if (sourceEnded || bytes + chunk.byteLength > 1024 * 1024) {
      stop()
      return
    }
    for (let offset = 0; offset < chunk.byteLength; offset += 16384) {
      const part = chunk.slice(offset, offset + 16384)
      queue.push(part)
      bytes += part.byteLength
    }
    flush()
  })
  stream.onEnd(() => {
    sourceEnded = true
    flush()
  })
  stream.onError(stop)
  stream.onClose((hadError) => {
    if (hadError || !sourceEnded || !receivedEnd) {
      stop()
      return
    }
    sourceClosed = true
    finish()
  })
  return {
    ready: () => {
      ready = true
      flush()
    },
    stop,
    receive: (value: string | Uint8Array) => {
      if (stopped) return
      if (value === 'ack') {
        if (++credits > window) {
          stop()
          return
        }
        flush()
      } else if (value === 'end') {
        if (receivedEnd) {
          stop()
          return
        }
        receivedEnd = true
        if (received === 0) stream.end()
      } else if (
        typeof value === 'string' ||
        receivedEnd ||
        value.byteLength === 0 ||
        value.byteLength > 16384 ||
        ++received > window
      ) {
        stop()
      } else {
        try {
          // Native sockets throw when closing races an inbound data-channel frame.
          stream.write(value, (error) => {
            if (stopped) return
            received--
            if (error) stop()
            else {
              send('ack')
              if (!stopped && receivedEnd && received === 0) stream.end()
              finish()
            }
          })
        } catch {
          stop()
        }
      }
    },
  }
}
