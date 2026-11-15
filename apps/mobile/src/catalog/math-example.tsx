import { useMemo, useState } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { MathBlock } from '../ui/content/math-block'
import { createMobileTheme, MobileThemeContext } from '../ui/theme'
import { useInterfaceText } from '@dovo/studio-core/interface-language'

/** Isolated native rendering checks. Contains no runtime connection or user content. */
export function MathExample() {
  const uiText = useInterfaceText()
  const [dark, setDark] = useState(true)
  const theme = useMemo(() => createMobileTheme('dovo', dark ? 'dark' : 'light'), [dark])
  return (
    <MobileThemeContext value={theme}>
      <ScrollView
        contentContainerStyle={{
          padding: 24,
          paddingTop: 70,
          gap: 16,
          backgroundColor: theme.colors.background,
          flexGrow: 1,
        }}
      >
        <Text style={{ color: theme.colors.text, fontSize: 24 }}>
          {uiText('Math verification')}
        </Text>
        <Pressable accessibilityRole="button" onPress={() => setDark(!dark)}>
          <Text style={{ color: theme.colors.text }}>{uiText('Switch theme')}</Text>
        </Pressable>
        <Text style={{ color: theme.colors.text }}>{uiText('Quadratic equation')}</Text>
        <MathBlock content={String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`} />
        <Text style={{ color: theme.colors.text }}>{uiText('Long equation')}</Text>
        <MathBlock
          content={String.raw`\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6} \qquad ${'x + '.repeat(30)} y`}
        />
        <Text style={{ color: theme.colors.text }}>
          {uiText('Invalid expression keeps source')}
        </Text>
        <View>
          <MathBlock content={String.raw`\thisCommandDoesNotExist{broken`} />
        </View>
      </ScrollView>
    </MobileThemeContext>
  )
}
