import { defaultRehypePlugins, type StreamdownProps } from 'streamdown'
import { resolveMarkdownLink } from '@dovo/protocol'

type MarkdownNode = {
  children?: MarkdownNode[]
  tagName?: string
  properties?: Record<string, unknown>
}

export function markdownPluginsForLinks(
  baseURL?: string,
  fileBaseURL?: string,
): StreamdownProps['rehypePlugins'] {
  const resolveLinks = () => (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.tagName === 'a' && typeof node.properties?.href === 'string')
        node.properties.href = resolveMarkdownLink(node.properties.href, baseURL, fileBaseURL) ?? ''
      for (const child of node.children ?? []) visit(child)
    }
    visit(tree)
  }
  // Bare repository paths must become URLs before rehype-harden checks them.
  // Keep Streamdown's HTML parsing, sanitization and hardening in their original order.
  return Object.entries(defaultRehypePlugins).flatMap(([name, plugin]) =>
    name === 'harden' ? [resolveLinks, plugin] : [plugin],
  )
}
