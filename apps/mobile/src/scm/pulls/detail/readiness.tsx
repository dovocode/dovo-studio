import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import type { PullReadiness, PullReadinessMetric, PullTone } from '@dovo/protocol'
import { Text } from '../../../ui/content/text'
import { Icon } from '../../../ui/controls/icon'
import { useTheme } from '../../../ui/theme'

export function PullReadinessPanel({
  summary,
  onOpen,
  children,
}: {
  summary: PullReadiness
  onOpen: (section: PullReadinessMetric['id']) => void
  children?: ReactNode
}) {
  const uiText = useInterfaceText()

  const { colors, styles } = useTheme()
  const [width, setWidth] = useState<number>()
  const stacked = width === undefined || width < 340
  const tones: Record<PullTone, string> = {
    positive: colors.success,
    danger: colors.error,
    warning: colors.warning,
    accent: colors.done,
    neutral: colors.muted,
  }
  const color = tones[summary.headline.tone]
  return (
    <View
      accessibilityLabel={uiText('Pull request status')}
      onLayout={({ nativeEvent }) => setWidth(Math.round(nativeEvent.layout.width))}
      style={{
        borderWidth: 0.5,
        borderColor: colors.border,
        borderRadius: 14,
        overflow: 'hidden',
        backgroundColor: colors.surface,
      }}
    >
      <View style={{ padding: 14, gap: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View
            style={{
              width: 36,
              height: 36,
              borderRadius: 18,
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: color,
                opacity: 0.1,
              }}
            />
            <Icon
              name={
                summary.headline.tone === 'positive'
                  ? 'check'
                  : summary.headline.tone === 'danger'
                    ? 'close'
                    : summary.headline.tone === 'warning'
                      ? 'history'
                      : 'pulls'
              }
              size={20}
              color={color}
            />
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
            <Text
              accessibilityRole="header"
              style={[styles.text, { fontSize: 16, fontWeight: '600' }]}
            >
              {summary.headline.label}
            </Text>
            <Text style={[styles.muted, { lineHeight: 18 }]}>{summary.description}</Text>
          </View>
        </View>
        {children && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>
        )}
      </View>
      <View
        testID="PR status summaries"
        style={{
          flexDirection: stacked ? 'column' : 'row',
          borderTopWidth: 0.5,
          borderColor: colors.border,
        }}
      >
        {summary.metrics.map((metric, index) => (
          <Pressable
            key={metric.id}
            accessibilityRole="button"
            accessibilityLabel={uiText('View pull request {value0}', { value0: metric.id })}
            accessibilityHint={`${metric.signal.label}. ${metric.description}`}
            onPress={() => onOpen(metric.id)}
            style={({ pressed }) => ({
              flex: stacked ? undefined : 1,
              minWidth: 0,
              minHeight: stacked ? 72 : 100,
              padding: 10,
              gap: 7,
              borderLeftWidth: !stacked && index > 0 ? 0.5 : 0,
              borderTopWidth: stacked && index > 0 ? 0.5 : 0,
              borderColor: colors.border,
              backgroundColor: pressed ? colors.selection : undefined,
            })}
          >
            <Text style={[styles.text, { fontSize: 13, fontWeight: '600' }]}>{metric.title}</Text>
            <Text style={[styles.muted, { lineHeight: 18 }]}>{metric.signal.label}</Text>
            <View
              accessible={false}
              style={{
                marginTop: 'auto',
                height: 5,
                borderRadius: 3,
                flexDirection: 'row',
                overflow: 'hidden',
                backgroundColor: colors.border,
              }}
            >
              {metric.segments.map((segment, index) => (
                <View
                  key={index}
                  style={{ flex: segment.count, backgroundColor: tones[segment.tone] }}
                />
              ))}
            </View>
          </Pressable>
        ))}
      </View>
    </View>
  )
}
