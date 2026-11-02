/** A preload-created MessagePort transfers binary terminal output straight into the worker. */
export function openElectronTerminalPort(
  url: string,
  signal: AbortSignal,
): Promise<MessagePort | undefined> {
  if (
    !('dovo' in window) ||
    !window.dovo ||
    typeof window.dovo !== 'object' ||
    !('terminalPorts' in window.dovo) ||
    window.dovo.terminalPorts !== true
  )
    return Promise.resolve(undefined)
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const cleanup = () => {
      clearTimeout(timeout)
      window.removeEventListener('message', receive)
      signal.removeEventListener('abort', abort)
    }
    const cancel = () => window.postMessage({ type: 'dovo:terminal-cancel', id }, '*')
    const abort = () => {
      cancel()
      cleanup()
      resolve(undefined)
    }
    const timeout = setTimeout(() => {
      cancel()
      cleanup()
      reject(new Error('Terminal MessagePort connection timed out.'))
    }, 10000)
    const receive = (event: MessageEvent<unknown>) => {
      if (
        event.source !== window ||
        !event.data ||
        typeof event.data !== 'object' ||
        !('type' in event.data) ||
        event.data.type !== 'dovo:terminal-port' ||
        !('id' in event.data) ||
        event.data.id !== id
      )
        return
      cleanup()
      const port = event.ports[0]
      if (port) resolve(port)
      else reject(new Error('Terminal MessagePort was not provided.'))
    }
    window.addEventListener('message', receive)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) {
      abort()
      return
    }
    window.postMessage({ type: 'dovo:terminal-connect', id, url }, '*')
  })
}
