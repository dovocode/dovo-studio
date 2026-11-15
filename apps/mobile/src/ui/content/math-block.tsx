import { useState } from 'react'
import { Pressable, View } from 'react-native'
import { EnrichedMarkdownText } from 'react-native-enriched-markdown'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { CodeBlock } from './code-block'
import { Text } from './text'
import { useTheme } from '../theme'

/** Only completed fences reach this component. Source stays available for copying and failures. */
export function MathBlock({ content }: { content: string }) {
  const uiText = useInterfaceText()
  const { styles, colors } = useTheme()
  const [source, setSource] = useState(false)
  const [failed, setFailed] = useState<string>()
  const showSource = source || failed === content
  return (
    <View style={{ gap: 8, marginVertical: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showSource }}
        onPress={() => {
          setFailed(undefined)
          setSource(!showSource)
        }}
        style={{ paddingVertical: 8 }}
      >
        <Text style={styles.muted}>
          {uiText(showSource ? 'Show equation' : 'Show equation source')}
        </Text>
      </Pressable>
      {showSource ? (
        <CodeBlock content={content} language="latex" />
      ) : (
        <EnrichedMarkdownText
          markdown={`$$\n${content}\n$$`}
          flavor="github"
          selectable
          allowFontScaling
          md4cFlags={{ latexMath: true }}
          markdownStyle={{
            paragraph: { color: colors.text, fontSize: 17 },
            math: { color: colors.text, backgroundColor: colors.surface, fontSize: 17 },
          }}
          onLatexError={() => setFailed(content)}
        />
      )}
    </View>
  )
}
