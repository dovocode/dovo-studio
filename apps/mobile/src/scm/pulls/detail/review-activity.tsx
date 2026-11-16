import { pullReviewActivity } from '@dovo/studio-core/pull-code-review'
import { useEffect, useRef } from 'react'
import { Animated, Easing, View } from 'react-native'
import type { PullCodeReview } from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useTheme } from '../../../ui/theme'
import { Text } from '../../../ui/content/text'

export function ReviewActivity({
  review,
  reviewers = 1,
}: {
  review?: PullCodeReview
  reviewers?: number
}) {
  const uiText = useInterfaceText()
  const { colors, styles, reduceMotion } = useTheme()
  const pulse = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (reduceMotion) {
      pulse.setValue(0)
      return
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 1600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    )
    animation.start()
    return () => animation.stop()
  }, [pulse, reduceMotion])
  const { phase, label, completed, batches, count, activeBatch, percent } = pullReviewActivity(
    review,
    reviewers,
  )
  return (
    <View
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      style={[styles.card, { gap: 10 }]}
    >
      <View
        accessible={false}
        importantForAccessibility="no-hide-descendants"
        style={{
          height: 76,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 12,
        }}
      >
        <View style={{ gap: 5 }}>
          {Array.from({ length: count }, (_, index) => (
            <View
              key={index}
              style={{
                width: 29,
                height: 15,
                borderWidth: 1,
                borderColor: colors.accent,
                borderRadius: 4,
                opacity: review?.reviewerResults?.[index]?.status === 'pending' ? 0.3 : 0.8,
              }}
            />
          ))}
        </View>
        <View style={{ height: 1, backgroundColor: colors.border, flex: 1 }} />
        <Animated.View
          style={{
            width: 48,
            height: 48,
            borderRadius: 24,
            borderWidth: 1,
            borderColor: colors.accent,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: reduceMotion
              ? 1
              : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }),
            transform: [
              {
                scale: reduceMotion
                  ? 1
                  : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.04] }),
              },
            ],
          }}
        >
          <View style={{ gap: 5 }}>
            {[22, 16, 22].map((width, index) => (
              <View
                key={index}
                style={{ width, height: 2, borderRadius: 1, backgroundColor: colors.accent }}
              />
            ))}
          </View>
        </Animated.View>
        <View style={{ height: 1, backgroundColor: colors.border, flex: 1 }} />
        <View
          style={{
            width: 30,
            height: 38,
            borderWidth: 1,
            borderColor: colors.accent,
            borderRadius: 5,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 5,
          }}
        >
          {[16, 12, 16].map((width, index) => (
            <View
              key={index}
              style={{ width, height: 2, backgroundColor: colors.accent, opacity: 0.6 }}
            />
          ))}
        </View>
      </View>
      <Text style={[styles.text, { fontSize: 13, fontWeight: '600' }]}>{uiText(label)}</Text>
      {!!batches && phase !== 'combining' && (
        <Text style={[styles.muted, { fontSize: 12 }]}>
          {uiText('Batch {value0} of {value1}', {
            value0: activeBatch,
            value1: batches,
          })}
        </Text>
      )}
      <View
        accessibilityRole="progressbar"
        accessibilityLabel={uiText('Review progress')}
        accessibilityValue={batches ? { min: 0, max: batches, now: completed } : undefined}
        style={{ height: 3, borderRadius: 2, overflow: 'hidden', backgroundColor: colors.border }}
      >
        <View
          style={{
            height: 3,
            width: `${percent}%`,
            backgroundColor: colors.accent,
          }}
        />
      </View>
    </View>
  )
}
