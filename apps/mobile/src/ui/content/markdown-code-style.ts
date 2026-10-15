import type { MarkdownStyle } from 'react-native-enriched-markdown'
import type { MobileTheme } from '../theme'

/** Keep source previews and fenced Markdown on the selected editor palette. */
export function markdownCodeStyle({ colors, code }: Pick<MobileTheme, 'colors' | 'code'>) {
  const palette = code?.colors
  const text = palette?.text ?? colors.text
  const keyword = palette?.keyword ?? colors.syntaxKeyword
  const number = palette?.number ?? colors.warning
  return {
    color: text,
    backgroundColor: palette?.background ?? colors.surface,
    syntaxColors: {
      keyword,
      operator: text,
      punctuation: text,
      string: palette?.string ?? colors.success,
      number,
      constant: number,
      comment: palette?.comment ?? colors.muted,
      function: palette?.function ?? colors.syntaxFunction,
      type: palette?.type ?? colors.warning,
      variable: text,
      property: text,
      tag: keyword,
      attribute: palette?.type ?? colors.warning,
      embedded: text,
    },
  } satisfies Pick<
    NonNullable<MarkdownStyle['codeBlock']>,
    'color' | 'backgroundColor' | 'syntaxColors'
  >
}
