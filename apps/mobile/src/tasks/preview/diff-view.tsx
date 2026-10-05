import { ScrollView } from 'react-native'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
// Android fallback: upstream react-native-diffs 1.0.3 only implements the iOS renderer.
export function DiffView({ patch }: { patch: string }) {
  const { colors } = useTheme()

  return (
    <ScrollView horizontal style={{ flex: 1 }}>
      <ScrollView>
        {patch.split('\n').map((line, index) => (
          <Text
            key={index}
            selectable
            style={{
              color: line.startsWith('+')
                ? colors.success
                : line.startsWith('-')
                  ? colors.error
                  : colors.text,
              backgroundColor: line.startsWith('+')
                ? `${colors.success}15`
                : line.startsWith('-')
                  ? `${colors.error}15`
                  : colors.background,
              fontFamily: 'monospace',
              fontSize: 12,
              lineHeight: 20,
            }}
          >
            {line || ' '}
          </Text>
        ))}
      </ScrollView>
    </ScrollView>
  )
}
