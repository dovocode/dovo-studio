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
