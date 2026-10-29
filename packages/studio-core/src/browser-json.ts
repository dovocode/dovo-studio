import { codeToTokens } from '@pierre/highlights'
import { pierreTheme } from './pierre-theme'
import type { resolveCodeTheme } from './code-themes'

const escape = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export { formatBrowserJson } from './browser-json-format'

/** Use the same engine and palette as Studio code blocks; classes also work under strict CSP. */
export function highlightBrowserJson(source: string, theme: ReturnType<typeof resolveCodeTheme>) {
  const styles: string[] = []
  const palette = pierreTheme(theme)
  for (const category of ['property', 'string', 'number', 'boolean', 'constant']) {
    const setting = palette.style.syntax?.[category]
    const color = typeof setting === 'string' ? setting : setting?.color
    if (color && /^#[\da-f]{3,8}$/i.test(color))
      styles.push(`html[data-dovo-json] .dovo-json-${category}{color:${color}}`)
  }
  if (/^#[\da-f]{3,8}$/i.test(theme.bg) && /^#[\da-f]{3,8}$/i.test(theme.fg))
    styles.push(`html[data-dovo-json]{background:${theme.bg};color:${theme.fg}}`)
  const classes = new Map<string, string>()
  // Large documents remain readable without allocating millions of syntax token elements.
  if (source.length > 512 * 1024) return { html: escape(source), css: styles.join('\n') }
  const result = codeToTokens(source, { lang: 'json', theme: palette })
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
