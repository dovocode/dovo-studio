import type { ThemedToken } from '@shikijs/types'
import type { SyntaxTokenize } from './syntax-highlighter'

/** Shared across screens, bounded by source + token storage. Themes own separate caches. */
export function cachedSyntax(tokenize: SyntaxTokenize, budget = 1024 * 1024): SyntaxTokenize {
  const entries = new Map<string, { lines: ThemedToken[][]; bytes: number }>()
  let bytes = 0
  return (content, language) => {
    const key = `${language ?? ''}\0${content}`
    const cached = entries.get(key)
    if (cached) {
      entries.delete(key)
      entries.set(key, cached)
      return cached.lines
    }
    const lines = tokenize(content, language)
    if (!lines) return undefined
    const size = content.length * 4 + lines.reduce((sum, line) => sum + 32 + line.length * 96, 0)
    if (size > budget) return lines
    while (bytes + size > budget || entries.size >= 20) {
      const oldest = entries.entries().next().value
      if (!oldest) break
      entries.delete(oldest[0])
      bytes -= oldest[1].bytes
    }
    entries.set(key, { lines, bytes: size })
    bytes += size
    return lines
  }
}
