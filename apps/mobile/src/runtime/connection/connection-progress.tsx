import { View } from 'react-native'
import { connectionProgress, type RuntimeOverview } from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { useConnectionTypes } from './connection-type'

export function ConnectionProgress({
  entry,
  recovering = false,
}: {
  entry: RuntimeOverview
  recovering?: boolean
}) {
  const { colors, styles } = useTheme()
  const connectionType = useConnectionTypes()
  return (
    <View style={{ gap: 6 }}>
      <View
        accessibilityLabel="Connection stages"
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}
      >
        {connectionProgress(entry, recovering).map((step) => (
          <Text
            key={step.label}
            accessibilityLabel={`${step.label}: ${step.state}`}
            style={[
              styles.muted,
              {
                fontSize: 12,
                color:
                  step.state === 'failed'
                    ? colors.error
                    : step.state === 'current'
                      ? colors.text
                      : colors.muted,
              },
            ]}
          >
            {step.state === 'done'
              ? '✓'
              : step.state === 'failed'
                ? '×'
                : step.state === 'current'
                  ? '◉'
                  : '○'}{' '}
            {step.label}
          </Text>
        ))}
      </View>
      {entry.connected && (
        <Text style={styles.muted}>{connectionType(entry.profile.connection, true)?.label}</Text>
      )}
    </View>
  )
}
