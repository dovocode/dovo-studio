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
export function csp(value: unknown) {
  const domains = resourceCsp(value)
  const resource = domains.resourceDomains.join(' ')
  return `default-src 'none'; script-src 'unsafe-inline' ${resource}; style-src 'unsafe-inline' ${resource}; img-src data: blob: ${resource}; font-src data: ${resource}; media-src data: blob: ${resource}; connect-src ${domains.connectDomains.join(' ') || "'none'"}; frame-src ${domains.frameDomains.join(' ') || "'none'"}; base-uri ${domains.baseUriDomains.join(' ') || "'none'"}; form-action 'none'; object-src 'none'; worker-src blob:;`
}
export function protectHtml(html: string, policy: string) {
  // First parsed policy remains enforced even if guest code removes its meta element.
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">${html}`
}
