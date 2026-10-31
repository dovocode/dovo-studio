import { defaultRehypePlugins, type StreamdownProps } from 'streamdown'
import { resolveMarkdownLink, localMarkdownURL, markdownURLLocalPath } from '@dovo/protocol'

type MarkdownNode = {
  children?: MarkdownNode[]
  value?: string
  tagName?: string
  properties?: Record<string, unknown>
}
type LinkOptions = { baseURL?: string; fileBaseURL?: string; localFiles: boolean }

// Streamdown caches processors by plugin name and JSON options, so plugins stay
// module-level and receive every link context value through serializable options.
function resolveLinks({ baseURL, fileBaseURL, localFiles }: LinkOptions) {
  return (tree: MarkdownNode) => {
    const link = (url: string) =>
      localFiles && !baseURL && !fileBaseURL
        ? ((markdownURLLocalPath(url) !== undefined ? url : localMarkdownURL(url)) ??
          resolveMarkdownLink(url) ??
          '')
        : (resolveMarkdownLink(url, baseURL, fileBaseURL) ?? '')
    const visit = (node: MarkdownNode) => {
      if (node.tagName === 'a' && typeof node.properties?.href === 'string')
        node.properties.href = link(node.properties.href)
      if (localFiles && node.tagName === 'img' && typeof node.properties?.src === 'string')
        node.properties.src = link(node.properties.src)
      for (const child of node.children ?? []) visit(child)
    }
    visit(tree)
  }
}
function labelTaskItems() {
  return (tree: MarkdownNode) => {
    const text = (node: MarkdownNode): string =>
      node.tagName === 'ul' || node.tagName === 'ol'
        ? ''
        : (node.value ?? (node.children ?? []).map(text).join(''))
    const visit = (node: MarkdownNode, label?: string) => {
      const taskLabel = node.tagName === 'li' ? text(node).replace(/\s+/g, ' ').trim() : label
      if (node.tagName === 'input' && node.properties?.type === 'checkbox')
        node.properties.ariaLabel = taskLabel || 'Task item'
      for (const child of node.children ?? []) visit(child, taskLabel)
    }
    visit(tree)
  }
}

export function markdownPluginsForLinks(
  baseURL?: string,
  fileBaseURL?: string,
  localFiles = false,
): StreamdownProps['rehypePlugins'] {
  const links: [typeof resolveLinks, LinkOptions] = [
    resolveLinks,
    { baseURL, fileBaseURL, localFiles },
  ]
  // Bare repository paths must become URLs before rehype-harden checks them.
  // Keep Streamdown's HTML parsing, sanitization and hardening in their original order.
  return [
    ...Object.entries(defaultRehypePlugins).flatMap(([name, plugin]) =>
      name === (localFiles ? 'sanitize' : 'harden') ? [links, plugin] : [plugin],
    ),
    labelTaskItems,
  ]
}
