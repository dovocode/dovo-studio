/** Resolve repository files at the reviewed revision and navigation links at their source. */
export function resolveMarkdownLink(url: string, baseURL?: string, fileBaseURL?: string) {
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
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^file:/i.test(url) && !/^[a-z]:[\\/]/i.test(url))
    return undefined
  return url.split('#')[0]!.replace(/:\d+(?::\d+)?$/, '') || undefined
}

// A render-only URL: clients intercept it and request a file-scoped preview from the runtime.
const localLinkOrigin = 'https://dovo-local-file.invalid'
export function localMarkdownURL(url: string) {
  const path = localMarkdownPath(url)
  return path === undefined ? undefined : `${localLinkOrigin}/?path=${encodeURIComponent(path)}`
}
export function markdownURLLocalPath(url: string) {
  try {
    const value = new URL(url)
    return value.origin === localLinkOrigin
      ? (value.searchParams.get('path') ?? undefined)
      : undefined
  } catch {
    return undefined
  }
}
