import { useApplicationState } from '../runtime/application-state'
import { Glass } from '../ui/glass'
import { MessageAttachments } from './message-attachments'
import { ActivityIndicator, Keyboard, Linking, Pressable, View } from 'react-native'
import { Text } from '../ui/text'
import { useRef } from 'react'
import { type Task } from '@dovo/protocol'
import { useTaskConversation } from './conversation-provider'
import { Action } from '../ui/action'
import { Field } from '../ui/field'
import { Sheet } from '../ui/sheet'
import { Choice } from '../ui/choice'
import { colors, styles } from '../ui/theme'
import { Icon } from '../ui/icon'
import { IconButton } from '../ui/icon-button'
import type { DraftSelection } from './dictation-draft'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { HarnessSettings } from './harness-settings'
import { taskHarnessLabel } from './harness-choices'
export function Composer({ task }: { task: Task }) {
  const insets = useSafeAreaInsets()
  const { actions, send, stop } = useTaskConversation()
  const {
    connected,
    snapshot,
    draft,
    dictation,
    busy,
    stopping,
    error,
    act,
    attaching,
    setAttaching,
    attachmentPicker,
    agent,
    firstMessage,
    checkoutEditable,
    hasInput,
    canSend,
    patch,
  } = actions
  const [focused, setFocused] = useApplicationState(false),
    [settings, setSettings] = useApplicationState(false),
    [checkout, setCheckout] = useApplicationState(false)
  const selection = useRef<DraftSelection | undefined>(undefined)
  const showOptions = focused || hasInput || firstMessage
  const canDictate = draft.ready && !busy && !task.archived && !attaching
  const listening = dictation.isRecording || dictation.isStarting
  const dictationStatus = dictation.isStarting
    ? 'Starting microphone…'
    : dictation.isStopping
      ? 'Finishing dictation…'
      : dictation.isRecording
        ? 'Listening…'
        : dictation.state?.status === 'cleaning'
          ? 'Cleaning up…'
          : dictation.state?.status === 'failed'
            ? 'Original kept. Cleanup unavailable.'
            : dictation.state?.status === 'done'
              ? 'Dictation cleaned up'
              : ''
  if (
    snapshot?.questions.some(
      (question) => question.taskId === task.id && question.prompt.blocking !== false,
    )
  )
    return (
      <View
        style={[
          styles.content,
          {
            paddingVertical: 8,
          },
        ]}
      >
        <Action label="Stop" disabled={!connected || stopping} onPress={stop} />
        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>
    )
  return (
    <View
      testID="Composer"
      style={[
        styles.content,
        {
          paddingHorizontal: 12,
          paddingTop: 6,
          paddingBottom: focused ? 8 : Math.max(8, insets.bottom),
          gap: 4,
        },
      ]}
    >
      <Glass
        style={{
          borderRadius: 26,
          padding: 3,
          gap: 0,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: focused ? colors.accent : colors.border,
        }}
      >
        <MessageAttachments
          taskId={task.id}
          files={task.draftAttachments}
          removable
          disabled={busy || attaching}
          onBusy={setAttaching}
        />
        {/* Keep the input mounted in the same position while its toolbar expands. */}
        <View>
          <View
            testID="Composer input row"
            style={{
              flexDirection: 'row',
              alignItems: 'flex-end',
              minHeight: 44,
            }}
          >
            <View
              style={{
                flex: 1,
                minWidth: 0,
              }}
            >
              <Field
                label="Message"
                hideLabel
                autoCorrect={false}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onSelectionChange={({ nativeEvent }) => {
                  selection.current = nativeEvent.selection
                }}
                placeholder={
                  dictation.isRecording
                    ? 'Listening…'
                    : firstMessage
                      ? 'What would you like to work on?'
                      : task.status === 'running'
                        ? 'Add a follow-up…'
                        : 'Ask a follow-up…'
                }
                value={draft.text}
                onChangeText={draft.update}
                multiline
                editable={draft.ready && !busy && !dictation.active && !task.archived}
                style={[
                  styles.input,
                  styles.chatText,
                  {
                    maxHeight: 144,
                    minHeight: 44,
                    borderWidth: 0,
                    paddingLeft: showOptions ? 12 : 44,
                    paddingRight: showOptions ? 12 : 88,
                    paddingVertical: 10,
                    backgroundColor: 'transparent',
                  },
                ]}
              />
            </View>
            {focused && (
              <IconButton
                label="Dismiss keyboard"
                variant="plain"
                icon="keyboard"
                onPress={Keyboard.dismiss}
              />
            )}
          </View>
          <View
            testID="Composer toolbar"
            pointerEvents="box-none"
            style={[
              {
                flexDirection: 'row',
                alignItems: 'center',
                minHeight: 44,
              },
              !showOptions && {
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
              },
            ]}
          >
            <IconButton
              variant="plain"
              icon="add"
              label="Attach files"
              disabled={!connected || busy || attaching || dictation.active || task.archived}
              onPress={attachmentPicker.pick}
            />
            <View
              pointerEvents="box-none"
              style={{
                flex: 1,
                minWidth: 0,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
              }}
            >
              {showOptions &&
                !dictation.active &&
                (task.status === 'running' && hasInput ? (
                  <View
                    style={[
                      styles.row,
                      {
                        flex: 1,
                        minWidth: 0,
                        gap: 0,
                      },
                    ]}
                  >
                    <Action secondary label="Queue" disabled={!canSend} onPress={() => send()} />
                    <Action
                      secondary
                      label="Steer"
                      disabled={!canSend}
                      onPress={() => send('steer')}
                    />
                  </View>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Agent & model"
                    accessibilityValue={{
                      text: taskHarnessLabel(task, agent),
                    }}
                    accessibilityState={{
                      disabled: busy || task.status === 'running' || !!task.archived,
                    }}
                    disabled={busy || task.status === 'running' || task.archived}
                    onPress={() => {
                      if (dictation.active) dictation.stop()
                      Keyboard.dismiss()
                      setSettings(true)
                    }}
                    style={({ pressed }) => ({
                      flex: 1,
                      minWidth: 44,
                      minHeight: 44,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 5,
                      opacity:
                        pressed || busy || task.status === 'running' || task.archived ? 0.5 : 1,
                    })}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        styles.muted,
                        {
                          flexShrink: 1,
                          fontSize: 13,
                        },
                      ]}
                    >
                      {taskHarnessLabel(task, agent)}
                    </Text>
                    <Icon name="down" size={10} color={colors.muted} />
                  </Pressable>
                ))}
              {showOptions && checkoutEditable && !dictation.active && (
                <Pressable
                  testID="Project & checkout"
                  accessibilityRole="button"
                  accessibilityLabel="Project & checkout"
                  accessibilityValue={{
                    text: `${snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)?.name || 'Choose project'}, ${task.execution === 'worktree' ? 'New worktree' : 'Local checkout'}`,
                  }}
                  accessibilityState={{
                    disabled: busy,
                  }}
                  disabled={busy}
                  onPress={() => {
                    Keyboard.dismiss()
                    setCheckout(true)
                  }}
                  style={({ pressed }) => ({
                    minWidth: 44,
                    minHeight: 44,
                    maxWidth: '55%',
                    flexShrink: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    opacity: pressed || busy ? 0.5 : 1,
                  })}
                >
                  <Icon
                    name={task.execution === 'worktree' ? 'changes' : 'folder'}
                    size={14}
                    color={colors.muted}
                  />
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.muted,
                      {
                        flexShrink: 1,
                        fontSize: 13,
                      },
                    ]}
                  >
                    {task.execution === 'worktree' ? 'Worktree' : 'Local'}
                  </Text>
                  <Icon name="down" size={10} color={colors.muted} />
                </Pressable>
              )}
            </View>
            <IconButton
              variant="plain"
              icon={listening ? 'waveform' : 'microphone'}
              label={listening ? 'Finish dictation' : 'Dictate message'}
              color={listening ? colors.accent : undefined}
              selected={listening}
              disabled={dictation.isStopping || (!listening && !canDictate)}
              onPress={
                listening
                  ? dictation.stop
                  : () => {
                      void dictation.start(selection.current)
                    }
              }
            />
            <IconButton
              variant="filled"
              icon={task.status === 'running' ? 'stop' : 'send'}
              label={task.status === 'running' ? 'Stop' : task.queuePaused ? 'Queue' : 'Send'}
              disabled={task.status === 'running' ? !connected || stopping : !canSend}
              onPress={task.status === 'running' ? stop : () => send()}
            />
          </View>
        </View>
        {!!dictationStatus && (
          <View
            style={[
              styles.row,
              {
                paddingLeft: 12,
                paddingRight: 4,
                gap: 8,
                minHeight: 44,
              },
            ]}
          >
            {dictation.active || dictation.state?.status === 'cleaning' ? (
              <ActivityIndicator size="small" color={colors.muted} />
            ) : null}
            <Text
              accessibilityLiveRegion="polite"
              style={[
                styles.muted,
                {
                  flexGrow: 1,
                  flexShrink: 1,
                  flexBasis: 120,
                },
              ]}
            >
              {dictationStatus}
            </Text>
            {dictation.state?.status === 'cleaning' && (
              <Action secondary label="Keep original" onPress={dictation.keepOriginal} />
            )}
            {dictation.state?.status === 'done' && (
              <Action secondary label="Undo cleanup" onPress={dictation.keepOriginal} />
            )}
            {dictation.state?.status === 'failed' && connected && (
              <Action secondary label="Retry cleanup" onPress={dictation.retry} />
            )}
            {dictation.state?.status !== 'cleaning' && !dictation.active && (
              <IconButton
                variant="plain"
                icon="close"
                label="Dismiss dictation status"
                onPress={dictation.reset}
              />
            )}
          </View>
        )}
      </Glass>
      {!!dictation.state?.error && (
        <Text
          accessibilityRole="alert"
          style={[
            styles.muted,
            {
              paddingHorizontal: 8,
            },
          ]}
        >
          {dictation.state.error}
        </Text>
      )}
      {!!dictation.error && (
        <View
          style={{
            gap: 4,
            paddingHorizontal: 8,
          }}
        >
          <Text accessibilityRole="alert" style={styles.error}>
            {dictation.error}
          </Text>
          {dictation.permissionDenied && (
            <Action
              secondary
              label="Open Settings"
              onPress={() => act(() => Linking.openSettings())}
            />
          )}
        </View>
      )}
      {checkout && checkoutEditable && (
        <Sheet title="Project & checkout" onClose={() => setCheckout(false)}>
          <Choice
            label="Project"
            value={task.repositoryId}
            disabled={busy || !connected || !!task.workItem}
            items={snapshot?.workspace.repositories ?? []}
            onChange={(repositoryId) =>
              act(() =>
                patch({
                  repositoryId: {
                    before: task.repositoryId,
                    after: repositoryId,
                  },
                }),
              )
            }
          />
          <Choice
            label="Working directory"
            value={task.execution ?? 'main'}
            disabled={busy || !connected}
            items={[
              {
                id: 'main',
                name: 'Local checkout',
              },
              {
                id: 'worktree',
                name: 'New worktree',
              },
            ]}
            onChange={(execution) =>
              act(() =>
                patch({
                  execution: {
                    before: task.execution ?? null,
                    after: execution,
                  },
                }),
              )
            }
          />
          <Action label="Done" onPress={() => setCheckout(false)} />
        </Sheet>
      )}
      {!!(error || draft.error || attachmentPicker.error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || draft.error || attachmentPicker.error}
        </Text>
      )}
      {settings && <HarnessSettings task={task} onClose={() => setSettings(false)} />}
    </View>
  )
}
