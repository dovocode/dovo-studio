/** Binary terminal stream v1. Data payload bytes count toward the consumption window. */
export type TerminalStreamFrame =
  | { type: 'data'; data: Uint8Array }
  | { type: 'replayStart' }
  | { type: 'replayEnd' }
  | { type: 'pong'; nonce: string }

export function encodeTerminalStreamFrame(frame: TerminalStreamFrame): Uint8Array {
  const kind =
    frame.type === 'data'
      ? 0
      : frame.type === 'replayStart'
        ? 1
        : frame.type === 'replayEnd'
          ? 2
          : 3
  const payload =
    frame.type === 'data'
      ? frame.data
      : frame.type === 'pong'
        ? new TextEncoder().encode(JSON.stringify({ type: 'pong', nonce: frame.nonce }))
        : new Uint8Array()
  const result = new Uint8Array(payload.length + 1)
  result[0] = kind
  result.set(payload, 1)
  return result
}

export function decodeTerminalStreamFrame(frame: Uint8Array): TerminalStreamFrame {
  const payload = frame.subarray(1)
  switch (frame[0]) {
    case 0:
      return { type: 'data', data: payload }
    case 1:
      if (!payload.length) return { type: 'replayStart' }
      break
    case 2:
      if (!payload.length) return { type: 'replayEnd' }
      break
    case 3: {
      const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload))
      if (
        value &&
        typeof value === 'object' &&
        'type' in value &&
        value.type === 'pong' &&
        'nonce' in value &&
        typeof value.nonce === 'string'
      )
        return { type: 'pong', nonce: value.nonce }
      break
    }
  }
  throw new Error('Invalid terminal stream frame')
}
