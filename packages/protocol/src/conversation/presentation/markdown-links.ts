import { parseStudioLink } from './studio-links.js'
/** Resolve repository files at the reviewed revision and navigation links at their source. */
export function resolveMarkdownLink(url: string, baseURL?: string, fileBaseURL?: string) {
  if (parseStudioLink(url)) return url
  try {
    const fileBase = fileBaseURL ? new URL(fileBaseURL) : undefined
    // Azure uses a query parameter for repository files instead of /blob/<revision>/ paths.
    if (
      fileBase?.pathname.includes('/_git/') &&
      fileBase.searchParams.has('path') &&
      !url.startsWith('#') &&
      !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(url)
    ) {
      const file = new URL(url, 'https://repository.invalid/')
      fileBase.searchParams.set('path', decodeURIComponent(file.pathname))
      fileBase.hash = file.hash
      return fileBase.toString()
    }
    // GitHub PR bodies use ../blob/... and parent paths to link to other repository pages.
    const navigation = url.startsWith('#') || url.startsWith('../')
    const target = new URL(url, navigation ? baseURL : (fileBaseURL ?? baseURL))
    return ['http:', 'https:', 'mailto:'].includes(target.protocol) ? target.toString() : undefined
  } catch {
    return undefined
  }
}

/** Local Markdown destinations, including source line suffixes, retain their runtime identity. */
export function localMarkdownPath(url: string): string | undefined {
  if (!url || url.startsWith('#') || url.startsWith('//')) return undefined
  if (/^sandbox:/i.test(url)) {
    const path = url
      .slice('sandbox:'.length)
      .split(/[?#]/)[0]!
      .replace(/:\d+(?::\d+)?$/, '')
    if (!path.startsWith('/')) return undefined
    try {
      const decoded = decodeURIComponent(path)
      if (decoded.length < 2 || /^[/\\]{2}/.test(decoded) || /[\0\t\r\n]/.test(decoded))
        return undefined
      return /^\/[a-z]:[/\\]/i.test(decoded) ? path.slice(1) : path
    } catch {
      return undefined
    }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^file:/i.test(url) && !/^[a-z]:[\\/]/i.test(url))
    return undefined
  return url.split('#')[0]!.replace(/:\d+(?::\d+)?$/, '') || undefined
}

export function localMarkdownLine(url: string) {
  const match = /#L(\d+)(?:-L?\d+)?$/i.exec(url) ?? /:(\d+)(?::\d+)?$/.exec(url)
  const line = Number(match?.[1])
  return Number.isSafeInteger(line) && line > 0 ? line : undefined
}

// A render-only URL: clients intercept it and request a file-scoped preview from the runtime.
const localLinkOrigin = 'https://dovo-local-file.invalid'
export function localMarkdownURL(url: string) {
  const path = localMarkdownPath(url)
  if (path === undefined) return
  const line = localMarkdownLine(url)
  return `${localLinkOrigin}/?path=${encodeURIComponent(path)}${line ? `&line=${line}` : ''}`
}
export function markdownURLLocalPath(url: string, includeLine = false) {
  try {
    const value = new URL(url)
    if (value.origin !== localLinkOrigin) return
    const path = value.searchParams.get('path')
    const line = Number(value.searchParams.get('line'))
    if (!path) return
    return includeLine && Number.isSafeInteger(line) && line > 0 ? `${path}#L${line}` : path
  } catch {
    return undefined
  }
}
