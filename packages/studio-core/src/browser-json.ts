import { applyEdits, format } from 'jsonc-parser'
import { codeToTokens } from '@pierre/highlights'
import { pierreTheme } from './pierre-theme'
import type { resolveCodeTheme } from './code-themes'

const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Validate without reserializing: IDs, exponents, duplicate keys and escapes stay intact. */
export function formatBrowserJson(source: string) {
  JSON.parse(source)
  return applyEdits(
    source,
    format(source, undefined, { insertSpaces: true, tabSize: 2, eol: '\n' }),
  )
}

/** Use the same engine and palette as Studio code blocks; classes also work under strict CSP. */
export function highlightBrowserJson(source: string, theme: ReturnType<typeof resolveCodeTheme>) {
  const styles: string[] = []
  if (/^#[\da-f]{3,8}$/i.test(theme.bg) && /^#[\da-f]{3,8}$/i.test(theme.fg))
    styles.push(`html[data-dovo-json]{background:${theme.bg};color:${theme.fg}}`)
  const classes = new Map<string, string>()
  // Large documents remain readable without allocating millions of syntax token elements.
  if (source.length > 512 * 1024) return { html: escape(source), css: styles.join('\n') }
  const result = codeToTokens(source, { lang: 'json', theme: pierreTheme(theme) })
  const html = result.tokens
    .map((line) =>
      line
        .map((token) => {
          const color = token.color
          if (!color || !/^#[\da-f]{3,8}$/i.test(color)) return escape(token.content)
          let name = classes.get(color)
          if (!name) {
            name = `dovo-json-token-${classes.size}`
            classes.set(color, name)
            styles.push(`html[data-dovo-json] .${name}{color:${color}}`)
          }
          return `<span class="${name}">${escape(token.content)}</span>`
        })
        .join(''),
    )
    .join('\n')
  return { html, css: styles.join('\n') }
}
