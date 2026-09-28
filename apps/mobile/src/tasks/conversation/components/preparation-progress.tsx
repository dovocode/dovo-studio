import { useEffect, useRef, useState } from 'react'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  StyleSheet,
  View,
} from 'react-native'
import { preparationElapsed, type TaskPreparation } from '@dovo/protocol'
import { Text } from '../../../ui/content/text'
import { Icon } from '../../../ui/controls/icon'
import { colors } from '../../../ui/theme'
import { Action } from '../../../ui/controls/action'

const monospace = Platform.OS === 'ios' ? 'Menlo' : 'monospace'

function useReduceMotion() {
  const [reduce, setReduce] = useState(false)
  useEffect(() => {
    let active = true
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduce(value)
    })
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce)
    return () => {
      active = false
      subscription.remove()
    }
  }, [])
  return reduce
}

/** Step-by-step progress while the runtime creates a task's worktree and runs its setup. */
export function PreparationProgress({
  preparation,
  onRetry,
  retrying = false,
  retryError = '',
}: {
  preparation: TaskPreparation
  /** Offered when setup failed; starts the run again from the failed step. */
  onRetry?: () => void
  retrying?: boolean
  retryError?: string
}) {
  const { failed } = preparation
  const reduceMotion = useReduceMotion() || failed
  const [now, setNow] = useState(() => Date.now())
  const [trackWidth, setTrackWidth] = useState(0)
  const progress = useRef(new Animated.Value(preparation.progress)).current
  const sweep = useRef(new Animated.Value(0)).current
  useEffect(() => {
    if (failed) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [failed])
  useEffect(() => {
    if (reduceMotion) {
      progress.setValue(preparation.progress)
      return
    }
    Animated.timing(progress, {
      toValue: preparation.progress,
      duration: 450,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start()
  }, [preparation.progress, reduceMotion, progress])
  useEffect(() => {
    if (reduceMotion || !trackWidth) return
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: 1600,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    )
    sweep.setValue(0)
    loop.start()
    return () => loop.stop()
  }, [reduceMotion, trackWidth, sweep])
  const active = preparation.steps.find(
    (step) => step.state === 'active' || step.state === 'failed',
  )
  const elapsed = failed ? '' : preparationElapsed(preparation.startedAt, now)
  return (
    <View
      accessible
      accessibilityRole={failed ? undefined : 'progressbar'}
      accessibilityLabel={`${failed ? 'Worktree setup stopped' : 'Setting up the worktree'}. ${active ? active.label : ''}`}
      accessibilityValue={
        failed ? undefined : { min: 0, max: 100, now: Math.round(preparation.progress * 100) }
      }
      style={[local.card, failed && local.failedCard]}
    >
      <View style={local.header}>
        <Icon name="changes" size={16} color={colors.muted} />
        <Text style={local.title}>
          {failed ? 'Worktree setup stopped' : 'Setting up the worktree'}
        </Text>
        {!!elapsed && <Text style={local.elapsed}>{elapsed}</Text>}
      </View>
      <View style={local.steps}>
        {preparation.steps.map((step) => (
          <View key={step.id} style={local.step}>
            <View style={local.marker}>
              {step.state === 'done' ? (
                <View style={local.done}>
                  <Icon name="check" size={11} color={colors.success} />
                </View>
              ) : step.state === 'failed' ? (
                <View style={local.failedMarker}>
                  <Icon name="close" size={11} color={colors.error} />
                </View>
              ) : step.state === 'active' ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <View style={local.pending} />
              )}
            </View>
            <View style={local.stepText}>
              <Text
                style={[
                  local.label,
                  step.state === 'active' && local.activeLabel,
                  step.state === 'done' && local.doneLabel,
                  step.state === 'failed' && local.failedLabel,
                ]}
              >
                {step.label}
              </Text>
              {!!step.detail && (
                <Text numberOfLines={1} style={local.detail}>
                  {step.detail}
                </Text>
              )}
            </View>
          </View>
        ))}
      </View>
      {failed && (
        <View style={local.failure}>
          {!!preparation.error && (
            <Text selectable style={local.error}>
              {preparation.error}
            </Text>
          )}
          {onRetry && (
            <>
              <Action
                label={retrying ? 'Retrying…' : 'Retry'}
                disabled={retrying}
                onPress={onRetry}
              />
              <Text style={local.hint}>
                {retryError || 'Your message stays queued until the run starts.'}
              </Text>
            </>
          )}
        </View>
      )}
      <View
        style={[local.track, failed && local.hidden]}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      >
        <Animated.View
          style={[
            local.fill,
            {
              width: progress.interpolate({
                inputRange: [0, 1],
                outputRange: ['4%', '100%'],
                extrapolate: 'clamp',
              }),
            },
          ]}
        />
        {!reduceMotion && !!trackWidth && (
          <Animated.View
            style={[
              local.sweep,
              {
                width: trackWidth / 4,
                transform: [
                  {
                    translateX: sweep.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-trackWidth / 4, trackWidth],
                    }),
                  },
                ],
              },
            ]}
          />
        )}
      </View>
    </View>
  )
}

const local = StyleSheet.create({
  card: {
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 12,
  },
  title: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  elapsed: { color: colors.muted, fontSize: 12, fontVariant: ['tabular-nums'] },
  steps: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  marker: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  done: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(138, 213, 176, 0.15)',
  },
  pending: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.muted,
    opacity: 0.6,
  },
  stepText: { flex: 1, minHeight: 20, justifyContent: 'center', gap: 2 },
  label: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  activeLabel: { color: colors.text, fontWeight: '600' },
  doneLabel: { textDecorationLine: 'line-through' },
  detail: { color: colors.muted, fontSize: 12, fontFamily: monospace },
  track: { height: 3, backgroundColor: colors.elevated, overflow: 'hidden' },
  hidden: { display: 'none' },
  failedCard: { borderColor: 'rgba(255, 152, 152, 0.4)' },
  failedMarker: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 152, 152, 0.15)',
  },
  failedLabel: { color: colors.error, fontWeight: '600' },
  failure: {
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  error: { color: colors.error, fontSize: 12, lineHeight: 17 },
  hint: { color: colors.muted, fontSize: 12 },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.accent },
  sweep: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.accent,
    opacity: 0.45,
  },
})
