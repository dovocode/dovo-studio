/** Development catalog only. Direct service helpers must not bypass the synthetic runtime. */
export function isolateCatalogNetwork() {
  const allowMetro = (input: string) => {
    try {
      const url = new URL(input)
      return (
        ['localhost', '127.0.0.1', '[::1]', '10.0.2.2'].includes(url.hostname) &&
        ['8081', '8082'].includes(url.port)
      )
    } catch {
      return false
    }
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!allowMetro(url))
      return Promise.reject(new Error('Network access is disabled in Dovo UI Catalog'))
    return originalFetch(input, init)
  }
  const OriginalWebSocket = globalThis.WebSocket
  globalThis.WebSocket = class CatalogWebSocket extends OriginalWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      if (!allowMetro(String(url)))
        throw new Error('WebSocket access is disabled in Dovo UI Catalog')
      super(url, protocols)
    }
  }
}
