import { ActivityIndicator, Linking, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Task } from '@dovo/protocol'
import { useTaskConversation } from '../conversation/state/provider'
import { Icon } from '../../ui/controls/icon'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

/** Car mode: speech first. One large button starts and finishes dictation, the transcript
 * stays readable at a glance, and sending is a single large target. */
export function CarComposer({ task, onType }: { task: Task; onType: () => void }) {
  const { colors, styles } = useTheme()

  const insets = useSafeAreaInsets()
  const { actions, send, stop } = useTaskConversation()
  const { draft, dictation, canSend, connected, stopping, busy, error, act } = actions
  const listening = dictation.isRecording || dictation.isStarting
  const finishing = dictation.isStopping || dictation.state?.status === 'cleaning'
  const text = draft.text.trim()
  const running = task.status === 'running'
  const canDictate = draft.ready && !busy && !task.archived && !finishing
  const label = dictation.isStarting
    ? 'Starting microphone…'
    : dictation.isRecording
      ? 'Listening… tap to finish'
      : dictation.isStopping
        ? 'Finishing…'
        : dictation.state?.status === 'cleaning'
          ? 'Cleaning up…'
          : text
            ? 'Tap to add more'
            : 'Tap to talk'
  const problem = dictation.error || dictation.state?.error || error || draft.error
  return (
    <View
      testID="Car composer"
      style={{
        paddingHorizontal: 16,
        paddingTop: 8,
        paddingBottom: Math.max(12, insets.bottom),
        gap: 10,
      }}
    >
      {!!text && !listening && (
        <Text
          numberOfLines={4}
          accessibilityLabel={`Message: ${draft.text}`}
          style={styles.chatText}
        >
          {draft.text}
        </Text>
      )}
      <Pressable
        testID="Car dictation"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: !listening && !canDictate, busy: finishing }}
        disabled={dictation.isStopping || (!listening && !canDictate)}
        onPress={listening ? dictation.stop : () => void dictation.start()}
        style={({ pressed }) => ({
          minHeight: 76,
          borderRadius: 38,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 14,
          paddingHorizontal: 20,
          backgroundColor: listening ? colors.action : colors.elevated,
          borderWidth: 1,
          borderColor: listening ? colors.action : colors.border,
          opacity: pressed ? 0.7 : !listening && !canDictate ? 0.5 : 1,
        })}
      >
        {finishing ? (
          <ActivityIndicator color={colors.text} />
        ) : (
          <Icon
            name={listening ? 'waveform' : 'microphone'}
            size={28}
            color={listening ? colors.onAccent : colors.text}
          />
        )}
        <Text
          style={{
            color: listening ? colors.onAccent : colors.text,
            fontSize: 20,
            lineHeight: 26,
            fontWeight: '600',
          }}
        >
          {label}
        </Text>
      </Pressable>
      {!listening && (!!text || running) && (
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {!!text && (
            <CarButton
              label="Clear"
              secondary
              onPress={() => {
                dictation.reset()
                draft.update('')
              }}
            />
          )}
          {text ? (
            <CarButton
              label={running ? 'Queue' : 'Send'}
              disabled={!canSend || finishing}
              onPress={() => send()}
            />
          ) : (
            <CarButton label="Stop" secondary disabled={!connected || stopping} onPress={stop} />
          )}
        </View>
      )}
      {!!problem && (
        <Text accessibilityRole="alert" style={styles.error}>
          {problem}
        </Text>
      )}
      {dictation.permissionDenied && (
        <CarButton
          label="Allow microphone in Settings"
          secondary
          onPress={() => act(() => Linking.openSettings())}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Type instead"
        hitSlop={8}
        disabled={listening}
        onPress={onType}
        style={({ pressed }) => ({
          alignSelf: 'center',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          minHeight: 36,
          opacity: pressed ? 0.5 : listening ? 0.3 : 1,
        })}
      >
        <Icon name="keyboard" size={15} color={colors.muted} />
        <Text style={[styles.muted, { fontSize: 14 }]}>Type instead</Text>
      </Pressable>
    </View>
  )
}

function CarButton({
  label,
  onPress,
  disabled = false,
  secondary = false,
}: {
  label: string
  onPress: () => void
  disabled?: boolean
  secondary?: boolean
}) {
  const { colors } = useTheme()

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: 60,
        borderRadius: 30,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: secondary ? colors.surface : colors.action,
        borderWidth: secondary ? 1 : 0,
        borderColor: colors.border,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Text
        style={{
          color: secondary ? colors.text : colors.onAccent,
          fontSize: 18,
          lineHeight: 24,
          fontWeight: '600',
        }}
      >
        {label}
      </Text>
    </Pressable>
  )
}
