import { useEffect, useState } from 'react'
import { prepareSyntax } from './syntax-engine'
import type { SyntaxTokenize } from './syntax-highlighter'
import { useTheme } from '../theme'

export function useSyntax<T>(
  languages: readonly (string | undefined)[],
  highlight: (tokenize: SyntaxTokenize) => T,
) {
  const { syntaxTheme } = useTheme()
  const key = [...new Set(languages.filter((language) => language !== undefined))].sort().join(',')
  const [result, setResult] = useState<{
    key: string
    theme: typeof syntaxTheme
    highlight: typeof highlight
    value?: T
    error?: string
  }>()
  useEffect(() => {
    if (!key) return
    let active = true
    void (async () => {
      try {
        const tokenize = await prepareSyntax(key.split(','), syntaxTheme)
        if (active) setResult({ key, theme: syntaxTheme, highlight, value: highlight(tokenize) })
      } catch (error: unknown) {
        console.error('Could not highlight source', error)
        if (active)
          setResult({
            key,
            theme: syntaxTheme,
            highlight,
            error: 'Syntax highlighting unavailable. Showing plain text.',
          })
      }
    })()
    return () => {
      active = false
    }
  }, [key, syntaxTheme, highlight])
  return result?.key === key && result.theme === syntaxTheme && result.highlight === highlight
    ? result
    : undefined
}
