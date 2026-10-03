import { useModelCatalog } from '../../agents/use-model-catalog'
import { CheckoutChoice } from '../creation/checkout-choice'
import { TaskMachineSelector } from '../creation/task-machine-selector'
import { WorktreeBasePicker } from '../creation/worktree-base-picker'
import { useApplicationState } from '../../runtime/state/application-state'
import { Glass } from '../../ui/layout/glass'
import { MessageAttachments } from '../conversation/components/message-attachments'
import { ActivityIndicator, Alert, Keyboard, Linking, Pressable, View } from 'react-native'
import { Text } from '../../ui/content/text'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  REVIEW_PROMPT,
  contextMeter,
  composerPlanLimit,
  responses,
  taskResources,
  worktreeChoicesSchema,
  type WorktreeChoices,
  type Task,
} from '@dovo/protocol'
import { Effect } from 'effect'
import { useTaskConversation } from '../conversation/state/provider'
import { Action } from '../../ui/controls/action'
import { ComposerField } from './composer-field'
import { Sheet } from '../../ui/layout/sheet'
import { colors, styles } from '../../ui/theme'
import { Icon } from '../../ui/controls/icon'
import { IconButton } from '../../ui/controls/icon-button'
import type { DraftSelection } from './dictation-draft'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { HarnessSettings } from '../detail/harness-settings'
import { taskHarnessLabel } from '../creation/harness-choices'
import { CarComposer } from './car-composer'
import { FileMentions, type ComposerCommandId } from '../conversation/components/file-mentions'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { randomUUID } from 'expo-crypto'
import { useCarMode } from '../../runtime/preferences/app-preferences'
export function Composer({ task, onAsk }: { task: Task; onAsk?: () => void }) {
  const insets = useSafeAreaInsets()
  const { actions, send, stop } = useTaskConversation()
  const {
    connected,
    snapshot,
    draft,
    dictation,
    busy: actionBusy,
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
  const { modelName, catalog: modelCatalog } = useModelCatalog(agent)
  const [machineMoving, setMachineMoving] = useApplicationState(false)
  const busy = actionBusy || machineMoving
  const [focused, setFocused] = useApplicationState(false),
    [settings, setSettings] = useApplicationState(false),
    [checkout, setCheckout] = useApplicationState(false)
  const selection = useRef<DraftSelection | undefined>(undefined)
  const [caret, setCaret] = useState(0)
  const focus = useCallback(() => setFocused(true), [setFocused])
  const blur = useCallback(() => setFocused(false), [setFocused])
  const select = useCallback(
    (value: DraftSelection) => {
      selection.current = value
      setCaret(value.end)
    },
    [setCaret],
  )
  const meter = contextMeter(task)
  const { callEffect: commandCall } = useRuntime()
  const quota = composerPlanLimit(task, snapshot?.workspace.planLimits ?? [], connected)
  const commandAction = useAction()
  const hasGit = !snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)
    ?.kind
  const worktreeAction = useAction()
  const [worktrees, setWorktrees] = useApplicationState<WorktreeChoices | null>(null)
  const [choosingWorktree, setChoosingWorktree] = useApplicationState(false)
  const loadWorktrees = () => {
    setChoosingWorktree(true)
    worktreeAction.act(() =>
      commandCall(
        '/api/scm/worktrees/choices',
        { repositoryId: task.repositoryId },
        worktreeChoicesSchema,
      ).pipe(Effect.tap((list) => Effect.sync(() => setWorktrees(list)))),
    )
  }
  useEffect(() => {
    if (commandAction.error) Alert.alert('Could not run the command', commandAction.error)
  }, [commandAction.error])
  const runCommand = (id: ComposerCommandId) => {
    if (id === 'compact')
      return commandAction.act(() =>
        commandCall('/api/tasks/compact', { id: task.id }, responses.ok),
      )
    if (id === 'review')
      return commandAction.act(() =>
        commandCall(
          '/api/tasks/message',
          { id: task.id, messageId: randomUUID(), text: REVIEW_PROMPT, review: true },
          responses.ok,
        ),
      )
    if (id === 'new-session')
      return Alert.alert(
        'Start a new agent session?',
        'The next message starts the agent fresh, with this conversation as context.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Start fresh',
            onPress: () =>
              commandAction.act(() =>
                commandCall('/api/tasks/new-session', { id: task.id }, responses.ok),
              ),
          },
        ],
      )
    const turn = [...(task.turns ?? [])]
      .reverse()
      .find(
        (item) =>
          item.status !== 'running' &&
          !!item.checkpoint?.after &&
          !item.checkpoint.error &&
          !item.checkpoint.undone &&
          item.checkpoint.files.length + item.checkpoint.omitted.length > 0,
      )
    if (!turn) return Alert.alert('Nothing to undo', 'No turn has file changes left to undo.')
    Alert.alert(
      'Undo the last turn’s changes?',
      'Those files go back to how they were before it. Your current files are saved first, so you can redo this.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Undo changes',
          style: 'destructive',
          onPress: () =>
            commandAction.act(() =>
              commandCall(
                '/api/tasks/turn/restore',
                { id: task.id, turnId: turn.id, direction: 'undo' },
                responses.ok,
              ),
            ),
        },
      ],
    )
  }
  const car = useCarMode()
  // Car mode starts with speech; the regular composer is one tap away for a passenger.
  const [typing, setTyping] = useApplicationState(false)
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
  if (car && !typing) return <CarComposer task={task} onType={() => setTyping(true)} />
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
      {meter && meter.level !== 'ok' && (
        <Text accessibilityRole="text" style={{ color: colors.warning, fontSize: 12 }}>
          Context {meter.short} used · Compact suggested
        </Text>
      )}
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
          files={actions.draftAttachments}
          removable
          disabled={busy || attaching}
          onBusy={setAttaching}
        />
        {focused && (
          <FileMentions
            taskId={task.id}
            text={draft.text}
            caret={caret}
            resources={taskResources(task, {
              agents: snapshot?.workspace.agents ?? [],
              repositories: snapshot?.workspace.repositories ?? [],
            })}
            onChange={draft.update}
            onCommand={
              task.messages.length || task.queue?.length || task.turns?.length
                ? runCommand
                : undefined
            }
            prompts={
              snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)
                ?.prompts
            }
          />
        )}
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
              <ComposerField
                onFocus={focus}
                onBlur={blur}
                onSelectionChange={select}
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
                editable={draft.ready && !busy && !dictation.active && !task.archived}
                showOptions={showOptions}
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
              label="Attach photos or files"
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
              {showOptions && !dictation.active && !(task.status === 'running' && hasInput) && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Agent & model"
                  accessibilityValue={{
                    text: taskHarnessLabel(
                      task,
                      agent,
                      snapshot?.acpInstallations,
                      modelName,
                      modelCatalog?.harness?.name,
                    ),
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
                    {taskHarnessLabel(
                      task,
                      agent,
                      snapshot?.acpInstallations,
                      modelName,
                      modelCatalog?.harness?.name,
                    )}
                  </Text>
                  <Icon name="down" size={10} color={colors.muted} />
                </Pressable>
              )}
              {showOptions && !dictation.active && quota && (
                <Text
                  accessibilityLabel={quota.label}
                  style={{
                    fontSize: 11,
                    color:
                      quota.state === 'fresh' && quota.remaining <= 10
                        ? colors.warning
                        : colors.muted,
                    fontVariant: ['tabular-nums'],
                  }}
                >
                  {quota.state === 'fresh'
                    ? `${quota.remaining}% quota`
                    : `Quota ${quota.state === 'awaiting' ? 'pending' : quota.state}`}
                </Text>
              )}
              {showOptions &&
                !dictation.active &&
                !(task.status === 'running' && hasInput) &&
                !!meter && (
                  <Text
                    accessibilityLabel={meter.label}
                    style={{
                      fontSize: 12,
                      fontVariant: ['tabular-nums'],
                      color:
                        meter.level === 'full'
                          ? colors.error
                          : meter.level === 'warn'
                            ? colors.warning
                            : colors.muted,
                    }}
                  >
                    {meter.short}
                  </Text>
                )}
              {showOptions && checkoutEditable && hasGit && !dictation.active && (
                <Pressable
                  testID="Checkout & branch"
                  accessibilityRole="button"
                  accessibilityLabel="Checkout & branch"
                  accessibilityValue={{
                    text: task.existingWorktreePath
                      ? 'Existing worktree'
                      : task.execution === 'worktree'
                        ? 'New worktree'
                        : 'Local checkout',
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
                    {task.existingWorktreePath
                      ? 'Existing'
                      : task.execution === 'worktree'
                        ? 'Worktree'
                        : 'Local'}
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
            {onAsk && task.messages.length > 0 && (
              <IconButton
                variant="plain"
                icon="chat"
                label="Ask a side question"
                disabled={!connected}
                onPress={onAsk}
              />
            )}
            {showOptions && !dictation.active && task.status === 'running' && hasInput && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <IconButton
                  variant="plain"
                  icon="queue"
                  label="Queue follow-up"
                  disabled={!canSend}
                  onPress={() => send()}
                />
                <IconButton
                  variant="plain"
                  icon="steer"
                  label="Steer agent"
                  disabled={!canSend}
                  onPress={() => send('steer')}
                />
              </View>
            )}
            <IconButton
              variant="filled"
              icon={task.status === 'running' ? 'stop' : 'send'}
              label={task.status === 'running' ? 'Stop' : 'Send'}
              disabled={
                machineMoving || (task.status === 'running' ? !connected || stopping : !canSend)
              }
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
      {checkoutEditable && (
        <TaskMachineSelector
          task={task}
          text={draft.text}
          disabled={busy || !draft.ready || attaching || dictation.active}
          onMoving={setMachineMoving}
        />
      )}
      {checkout && checkoutEditable && hasGit && (
        <Sheet title="Checkout & branch" onClose={() => setCheckout(false)}>
          <CheckoutChoice
            value={task.existingWorktreePath ? 'existing' : (task.execution ?? 'main')}
            branch={
              snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)?.branch
            }
            disabled={busy || !connected}
            onChange={(execution) => {
              if (execution === 'existing') {
                loadWorktrees()
                return
              }
              act(() =>
                patch({
                  execution: { before: task.execution ?? null, after: execution },
                  existingWorktreePath: { before: task.existingWorktreePath ?? null, after: null },
                  worktreeSetupComplete: {
                    before: task.worktreeSetupComplete ?? null,
                    after: null,
                  },
                }),
              )
            }}
          />
          {choosingWorktree && (
            <View style={{ gap: 8 }}>
              <Text style={styles.muted}>
                Choose a worktree on this computer. The task uses its current files; only one task
                can run there at a time.
              </Text>
              {!!worktreeAction.error && <Text style={styles.error}>{worktreeAction.error}</Text>}
              {worktrees?.worktrees.map((item) => (
                <Action
                  key={item.path}
                  secondary
                  label={`${item.branch || item.path.split('/').at(-1)}${item.dirty ? ' · Changed files' : ''}`}
                  disabled={!connected || busy || worktreeAction.busy}
                  onPress={() =>
                    act(() =>
                      patch({
                        execution: { before: task.execution ?? null, after: 'worktree' },
                        existingWorktreePath: {
                          before: task.existingWorktreePath ?? null,
                          after: item.path,
                        },
                        worktreeBaseBranch: {
                          before: task.worktreeBaseBranch ?? null,
                          after: null,
                        },
                        worktreeSetupComplete: {
                          before: task.worktreeSetupComplete ?? null,
                          after: true,
                        },
                      }).then(() => setChoosingWorktree(false)),
                    )
                  }
                />
              ))}
              {worktrees && !worktrees.worktrees.length && (
                <Text style={styles.muted}>No available worktrees for this project.</Text>
              )}
              {!worktrees && !worktreeAction.error && (
                <Text style={styles.muted}>Loading worktrees…</Text>
              )}
            </View>
          )}
          {task.execution === 'worktree' && !task.pullRequest && !task.existingWorktreePath && (
            <WorktreeBasePicker
              key={task.repositoryId}
              repositoryId={task.repositoryId}
              value={task.worktreeBaseBranch}
              fromOrigin={task.worktreeFromOrigin}
              onChange={(value) =>
                act(() =>
                  patch({
                    worktreeBaseBranch: { before: task.worktreeBaseBranch ?? null, after: value },
                  }),
                )
              }
            />
          )}
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
