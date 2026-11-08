import { exec, type JsonValue } from 'jsonpath-rfc9535'
import { parseTree, type Node } from 'jsonc-parser'
import { formatBrowserJson } from '@dovo/studio-core/browser-json-format'

/** Select original source ranges so large IDs, escapes and duplicate keys stay intact. */
export function createBrowserJsonFilter(source: string) {
  const document: JsonValue = JSON.parse(source)
  const root = parseTree(source)
  if (!root) throw new Error('Invalid JSON')
  return (expression: string) => {
    const path = expression.trim()
    if (!path || path === '$') return { source, formatted: formatBrowserJson(source), count: 1 }
    const matches: string[] = []
    exec(document, path, (_value, parts) => {
      let node: Node | undefined = root
      for (const part of parts) {
        node =
          node?.type === 'array'
            ? node.children?.[Number(part)]
            : node?.children?.findLast((property) => property.children?.[0].value === part)
                ?.children?.[1]
      }
      if (!node) throw new Error('Could not locate JSONPath result in the response')
      matches.push(source.slice(node.offset, node.offset + node.length))
    })
    const selected = matches.length === 1 ? matches[0] : `[${matches.join(',')}]`
    return { source: selected, formatted: formatBrowserJson(selected), count: matches.length }
  }
}
