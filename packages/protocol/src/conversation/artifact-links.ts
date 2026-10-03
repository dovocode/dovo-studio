import type { ArtifactLink } from './artifacts.js'

export const artifactLinkLabel = (provider: ArtifactLink['provider']) =>
  provider === 'claude' ? 'Claude artifact' : 'ChatGPT Site'

/** Collect hosted artifacts already referenced in a thread; never fetch external content. */
export function externalArtifactLinks(values: Iterable<unknown>): ArtifactLink[] {
  const links = new Map<string, ArtifactLink>()
  const add = (input: string, title = '', site = false) => {
    try {
      const url = new URL(input)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return
      const claude =
        url.hostname === 'claude.ai' &&
        /^\/(?:public\/artifacts|artifacts|code\/artifact)\/[\w-]+\/?$/.test(url.pathname)
      const chatgpt = url.hostname.endsWith('.chatgpt.site') || site
      if (!claude && !chatgpt) return
      url.hash = ''
      if (claude) url.search = ''
      url.pathname = url.pathname.replace(/\/$/, '') || '/'
      const key = url.href
      const previous = links.get(key)
      links.set(key, {
        url: key,
        provider: claude ? 'claude' : 'chatgpt',
        title: (
          title.trim() ||
          previous?.title ||
          (claude ? `Claude artifact · ${url.pathname.split('/').at(-1)}` : url.hostname)
        ).slice(0, 200),
      })
    } catch {
      // Unrelated or incomplete streaming URLs are not artifacts.
    }
  }
  const text = (value: string) => {
    for (const match of value.matchAll(
      /\[([^\]\n]+)\]\(<?(https?:\/\/[^\s<>]+?)>?(?:\s+"[^"]*")?\)/gi,
    ))
      add(match[2]!, match[1]!)
    for (const match of value.matchAll(/https?:\/\/[^\s<>"'`\\]+/gi))
      add(match[0].replace(/[.,;:!?)\]}]+$/, ''))
  }
  const visit = (value: unknown) => {
    if (typeof value === 'string') {
      // MCP result content is frequently a JSON string inside a text block.
      if (/^\s*[[{]/.test(value)) {
        try {
          const parsed: unknown = JSON.parse(value)
          visit(parsed)
          return
        } catch {
          // Markdown or prose may also start with a bracket.
        }
      }
      text(value)
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else if (value && typeof value === 'object') {
      const site = 'id' in value && 'slug' in value && 'latest_version_number' in value
      const title = 'title' in value && typeof value.title === 'string' ? value.title : ''
      if (site) {
        const live = 'current_live_url' in value ? value.current_live_url : undefined
        const preview = 'current_preview_url' in value ? value.current_preview_url : undefined
        // A Sites result also identifies custom domains that prose alone cannot classify.
        if (typeof live === 'string') add(live, title, true)
        else if (typeof preview === 'string') add(preview, title, true)
      }
      for (const [key, item] of Object.entries(value)) {
        if (site && ['current_live_url', 'current_preview_url', 'expected_url'].includes(key))
          continue
        if (title && typeof item === 'string' && /^https?:\/\//i.test(item)) add(item, title)
        visit(item)
      }
    }
  }
  for (const value of values) visit(value)
  return [...links.values()]
}
