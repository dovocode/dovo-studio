/** CSP sources are origins only; never accept raw CSP syntax from an MCP server. */
export function sources(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .slice(0, 32)
    .filter((entry) => {
      if (/[\s;'"<>]/.test(entry)) return false
      try {
        const url = new URL(entry)
        return (
          ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) &&
          (!url.hostname.includes('*') ||
            (url.hostname.startsWith('*.') &&
              !url.hostname.slice(2).includes('*') &&
              url.hostname.slice(2).includes('.'))) &&
          !url.username &&
          !url.password &&
          url.pathname === '/' &&
          !url.search &&
          !url.hash
        )
      } catch {
        return false
      }
    })
}
export function resourceCsp(value: unknown) {
  const data = value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : {}
  return {
    connectDomains: sources(data.connectDomains),
    resourceDomains: sources(data.resourceDomains),
    frameDomains: sources(data.frameDomains),
    baseUriDomains: sources(data.baseUriDomains),
  }
}
export const a2uiMediaPolicy = 'img-src data: http: https:; media-src data: http: https:;'

export function csp(value: unknown, builtInA2ui = false) {
  const domains = resourceCsp(value)
  const resource = domains.resourceDomains.join(' ')
  const media = builtInA2ui
    ? a2uiMediaPolicy
    : `img-src data: blob: ${resource}; media-src data: blob: ${resource};`
  return `default-src 'none'; script-src 'unsafe-inline' ${resource}; style-src 'unsafe-inline' ${resource}; ${media} font-src data: ${resource}; connect-src ${domains.connectDomains.join(' ') || "'none'"}; frame-src ${domains.frameDomains.join(' ') || "'none'"}; base-uri ${domains.baseUriDomains.join(' ') || "'none'"}; form-action 'none'; object-src 'none'; worker-src blob:;`
}
// Web Crypto supplies secure random bytes on HTTP, where randomUUID is unavailable.
const guestUuid = `<script>
  if (typeof crypto.randomUUID !== 'function') {
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      writable: true,
      value() {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;
        const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
      }
    });
  }
</script>`

export function protectHtml(html: string, policy: string) {
  // First parsed policy remains enforced even if guest code removes its meta element.
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${guestUuid}${html}`
}
