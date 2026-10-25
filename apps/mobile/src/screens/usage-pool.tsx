import { View } from 'react-native'
import { pooledPlanLimits, formatQuotaReset, type accountPlanLimits } from '@dovo/protocol'
import { Text } from '../ui/content/text'
import { useSettingsTheme } from './settings-theme'
export function UsagePool({
  limits,
  now,
}: {
  limits: ReturnType<typeof accountPlanLimits>
  now: number
}) {
  const { colors, styles } = useSettingsTheme()
  const pools = pooledPlanLimits(limits, now)
  if (!pools.length) return null
  return (
    <View style={{ gap: 12 }}>
      <Text style={styles.title}>Pooled availability</Text>
      <Text style={styles.muted}>
        Each segment is one account. Plans have different capacities; percentages are not combined.
      </Text>
      {pools.map((pool) => (
        <View key={pool.key} style={[styles.card, { gap: 8 }]}>
          <Text style={styles.text}>
            {pool.provider === 'codex' ? 'Codex' : 'Claude'} · {pool.window}
          </Text>
          <Text style={styles.muted}>
            {pool.available} of {pool.segments.length} reported accounts available
            {pool.unknown ? ` · ${pool.unknown} without a fresh reading` : ''}
          </Text>
          <View style={{ flexDirection: 'row', gap: 4 }}>
            {pool.segments.map((segment) => (
              <View
                key={segment.accountKey}
                accessibilityRole="image"
                accessibilityLabel={`${segment.label}: ${segment.remaining === null ? segment.state : `${Math.round(segment.remaining)}% left`}${segment.gatedByWeekly ? ' · Weekly limit reached' : ''}`}
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
              Next depleted account: {formatQuotaReset(pool.nextReset, now)}
            </Text>
          )}
        </View>
      ))}
    </View>
  )
}
