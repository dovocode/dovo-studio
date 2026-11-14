import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
import { contextMeter, type Task } from '@dovo/protocol'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function ThreadInfoUsage({ task }: { task: Task }) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const meter = contextMeter(task)
  const usage = task.contextUsage
  return (
    <View accessibilityLabel={uiText('Context usage')} style={{ gap: 8 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <Text style={styles.muted}>
          <InterfaceText>{'Context'}</InterfaceText>
        </Text>
        <Text style={styles.text}>
          {meter
            ? `${meter.short}${meter.percent !== undefined ? uiText(' used') : uiText(' tokens')}`
            : uiText('Not reported')}
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
          ? uiText('{value0}{value1} tokens in this session{value2}', {
              value0: usage.used.toLocaleString(),
              value1: usage.limit ? ` of ${usage.limit.toLocaleString()}` : '',
              value2: usage.limit ? '.' : ' · Window size not reported.',
            })
          : uiText('Available after the provider reports context usage.')}
      </Text>
    </View>
  )
}
