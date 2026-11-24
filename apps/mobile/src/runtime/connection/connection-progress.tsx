import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
import {
  activeRuntimeStreamRoute,
  connectionProgress,
  selectedRuntimeRoute,
  runtimeRouteLabel,
  type RuntimeOverview,
} from '@dovo/protocol'
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
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const connectionType = useConnectionTypes()
  const connection = entry.profile.connection
  const stream = activeRuntimeStreamRoute(connection)
  return (
    <View style={{ gap: 6 }}>
      <View
        accessibilityLabel={uiText('Connection stages')}
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
        <>
          <Text style={styles.muted}>{connectionType(connection, true)?.label}</Text>
          <Text selectable style={styles.muted}>
            {uiText('HTTP requests: {value0}', {
              value0: runtimeRouteLabel(selectedRuntimeRoute(connection)),
            })}
          </Text>
          <Text selectable style={styles.muted}>
            {uiText('Live updates: {value0}', {
              value0: stream ? runtimeRouteLabel(stream) : uiText('HTTP polling'),
            })}
          </Text>
        </>
      )}
    </View>
  )
}
