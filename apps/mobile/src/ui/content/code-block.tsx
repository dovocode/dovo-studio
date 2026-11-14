import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useCallback, useMemo, useState } from 'react'
import { Platform, Pressable, ScrollView, View } from 'react-native'
import { useTheme } from '../theme'
import { syntaxLanguage, type SyntaxTokenize } from './syntax-highlighter'
import { useSyntax } from './use-syntax'
import { SyntaxText } from './syntax-text'
import { Text } from './text'

/** Inline source viewer: one native selectable paragraph keeps copied code intact. */
export function CodeBlock({ content, language }: { content: string; language?: string }) {
  const uiText = useInterfaceText()

  const { colors, syntaxTheme } = useTheme()
  const [wrap, setWrap] = useState(false)
  const lang = syntaxLanguage(language)
  const highlight = useCallback(
    (tokenize: SyntaxTokenize) => tokenize(content, lang),
    [content, lang],
  )
  const syntax = useSyntax([lang], highlight)
  const lines = syntax?.value
  const breaks = useMemo(() => content.match(/\r\n|\r|\n/g) ?? [], [content])
  const code = (
    <Text
      selectable
      style={{
        color: syntaxTheme.fg,
        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
        fontSize: 13,
        lineHeight: 20,
        includeFontPadding: false,
        flexShrink: 0,
        ...(wrap ? {} : { alignSelf: 'flex-start' as const }),
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
  )
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
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 14,
          borderBottomWidth: 1,
          borderColor: colors.border,
        }}
      >
        <Text style={{ color: syntaxTheme.fg, fontSize: 12 }}>{language || uiText('Code')}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={wrap ? uiText('Scroll code horizontally') : uiText('Wrap code lines')}
          onPress={() => setWrap((value) => !value)}
          style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 }}
        >
          <Text style={{ color: syntaxTheme.fg, fontSize: 12 }}>
            {wrap ? uiText('Scroll') : uiText('Wrap')}
          </Text>
        </Pressable>
      </View>
      {wrap ? (
        <View style={{ padding: 14 }}>{code}</View>
      ) : (
        <ScrollView
          horizontal
          directionalLockEnabled
          nestedScrollEnabled
          alwaysBounceHorizontal={false}
          alwaysBounceVertical={false}
          showsHorizontalScrollIndicator
          style={{ maxWidth: '100%', flexGrow: 0 }}
          contentContainerStyle={{ padding: 14, minWidth: '100%' }}
        >
          {code}
        </ScrollView>
      )}
    </View>
  )
}
