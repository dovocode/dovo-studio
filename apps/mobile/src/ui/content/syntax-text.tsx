import type { ThemedToken } from '@shikijs/types'
import { Text } from './text'

/** Shiki fontStyle uses TextMate's italic, bold and underline bit flags. */
export function SyntaxText({ tokens }: { tokens: readonly ThemedToken[] }) {
  return tokens.map((token, index) => (
    <Text
      key={index}
      style={{
        color: token.color || undefined,
        fontStyle: (token.fontStyle ?? 0) & 1 ? 'italic' : 'normal',
        fontWeight: (token.fontStyle ?? 0) & 2 ? 'bold' : 'normal',
        textDecorationLine: (token.fontStyle ?? 0) & 4 ? 'underline' : 'none',
      }}
    >
      {token.content}
    </Text>
  ))
}
