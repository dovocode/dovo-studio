import { View } from 'react-native'
import { contextMeter, type Task } from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function ThreadInfoUsage({ task }: { task: Task }) {
  const { colors, styles } = useTheme()
  const meter = contextMeter(task)
  const usage = task.contextUsage
  return (
    <View accessibilityLabel="Context usage" style={{ gap: 8 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Text style={styles.muted}>Context</Text>
        <Text style={styles.text}>
          {meter
            ? `${meter.short}${meter.percent !== undefined ? ' used' : ' tokens'}`
            : 'Not reported'}
        </Text>
      </View>
      {meter?.percent !== undefined && (
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={meter.label}
          accessibilityValue={{ min: 0, max: 100, now: meter.percent }}
          style={{ height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden' }}
        >
          <View
            style={{
              height: 4,
              width: `${meter.percent}%`,
              backgroundColor:
                meter.level === 'full'
                  ? colors.error
                  : meter.level === 'warn'
                    ? colors.warning
                    : colors.muted,
            }}
          />
        </View>
      )}
      <Text style={styles.muted}>
        {usage?.used !== undefined
          ? `${usage.used.toLocaleString()}${usage.limit ? ` of ${usage.limit.toLocaleString()}` : ''} tokens in this session${usage.limit ? '.' : ' · Window size not reported.'}`
          : 'Available after the provider reports context usage.'}
      </Text>
    </View>
  )
}
