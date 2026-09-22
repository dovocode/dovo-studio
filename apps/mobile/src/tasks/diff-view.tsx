import { ScrollView } from 'react-native'
import { Text } from '../ui/text'
import { colors } from '../ui/theme'
// Android fallback: upstream react-native-diffs 1.0.3 only implements the iOS renderer.
export function DiffView({ patch }: { patch: string }) {
  return (
    <ScrollView horizontal style={{ flex: 1 }}>
      <ScrollView>
        {patch.split('\n').map((line, index) => (
          <Text
            key={index}
            selectable
            style={{
              color: line.startsWith('+')
                ? '#a8dfb2'
                : line.startsWith('-')
                  ? '#ffabab'
                  : colors.text,
              backgroundColor: line.startsWith('+')
                ? '#152a20'
                : line.startsWith('-')
                  ? '#321d23'
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
