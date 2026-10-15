import { useCallback, useMemo } from 'react'
import { Platform, ScrollView, View } from 'react-native'
import { useTheme } from '../theme'
import { syntaxLanguage, type SyntaxTokenize } from './syntax-highlighter'
import { useSyntax } from './use-syntax'
import { SyntaxText } from './syntax-text'
import { Text } from './text'

/** Inline source viewer: one native selectable paragraph keeps copied code intact. */
export function CodeBlock({ content, language }: { content: string; language?: string }) {
  const { colors, syntaxTheme } = useTheme()
  const lang = syntaxLanguage(language)
  const highlight = useCallback(
    (tokenize: SyntaxTokenize) => tokenize(content, lang),
    [content, lang],
  )
  const syntax = useSyntax([lang], highlight)
  const lines = syntax?.value
  const breaks = useMemo(() => content.match(/\r\n|\r|\n/g) ?? [], [content])
  return (
    <View
      style={{
        backgroundColor: syntaxTheme.bg,
        borderColor: colors.border,
        borderWidth: 1,
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {syntax?.error && (
        <Text
          accessibilityRole="alert"
          style={{ color: syntaxTheme.fg, padding: 14, fontSize: 13 }}
        >
          {syntax.error}
        </Text>
      )}
      <ScrollView horizontal contentContainerStyle={{ padding: 14, minWidth: '100%' }}>
        <Text
          selectable
          style={{
            color: syntaxTheme.fg,
            fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
            fontSize: 13,
            lineHeight: 20,
            includeFontPadding: false,
          }}
        >
          {lines
            ? lines.map((tokens, index) => (
                <Text key={index}>
                  {index > 0 ? breaks[index - 1] : ''}
                  <SyntaxText tokens={tokens} />
                </Text>
              ))
            : content || ' '}
        </Text>
      </ScrollView>
    </View>
  )
}
