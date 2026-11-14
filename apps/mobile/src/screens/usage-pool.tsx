import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { InterfaceText } from '@dovo/studio-core/interface-language'
import { View } from 'react-native'
import {
  pooledPlanLimits,
  formatQuotaReset,
  type UsageHubAccount,
  type accountPlanLimits,
} from '@dovo/protocol'
import { Text } from '../ui/content/text'
import { useSettingsTheme } from './settings-theme'
export function UsagePool({
  limits,
  now,
  accounts = [],
}: {
  limits: ReturnType<typeof accountPlanLimits>
  now: number
  accounts?: UsageHubAccount[]
}) {
  const uiText = useInterfaceText()

  const { colors, styles } = useSettingsTheme()
  const pools = pooledPlanLimits(limits, now, accounts)
  if (!pools.length) return null
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.title}>
        <InterfaceText>{'Pooled availability'}</InterfaceText>
      </Text>
      <Text style={styles.muted}>
        <InterfaceText>
          {
            'Each segment is one account. Plans have different capacities; percentages are not combined.'
          }
        </InterfaceText>
      </Text>
      {pools.map((pool) => (
        <View key={pool.key} style={[styles.card, { gap: 8 }]}>
          <Text style={styles.text}>
            {pool.provider === 'codex'
              ? 'Codex'
              : pool.provider === 'opencode'
                ? 'OpenCode'
                : 'Claude'}{' '}
            · {pool.window}
          </Text>
          <Text style={styles.muted}>
            <InterfaceText
              values={{
                value0: pool.available,
                value1: pool.segments.length,
                value2: pool.unknown
                  ? uiText(' · {value0} without a fresh reading', { value0: pool.unknown })
                  : '',
              }}
            >
              {'{value0} of {value1} accounts available{value2}'}
            </InterfaceText>
          </Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {pool.segments.map((segment) => (
              <View
                key={segment.accountKey}
                accessibilityRole="image"
                accessibilityLabel={`${segment.label}: ${segment.remaining === null ? segment.state : uiText('{value0}% left', { value0: Math.round(segment.remaining) })}${segment.gatedByWeekly ? uiText(' · Weekly limit reached') : ''}`}
                style={{
                  flex: 1,
                  height: 12,
                  borderRadius: 4,
                  overflow: 'hidden',
                  backgroundColor: colors.border,
                }}
              >
                <View
                  style={{
                    height: 12,
                    width: segment.remaining === null ? '100%' : `${segment.remaining}%`,
                    backgroundColor: segment.remaining === null ? colors.muted : colors.accent,
                  }}
                />
              </View>
            ))}
          </View>
          {pool.nextReset && (
            <Text style={styles.muted}>
              <InterfaceText values={{ value0: formatQuotaReset(pool.nextReset, now) }}>
                {'Next depleted account: {value0}'}
              </InterfaceText>
            </Text>
          )}
        </View>
      ))}
    </View>
  )
}
