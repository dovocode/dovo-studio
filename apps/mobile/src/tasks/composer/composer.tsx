import { permissionPolicyUIIssue } from '../../agents/permission-policy'
import { FileDropTarget } from './file-drop-target'
import { changeTaskProject, changeTaskAutoProject } from '@dovo/protocol'
import { checkpointCanUndo } from '@dovo/protocol'
import { projectPrompts } from '@dovo/protocol'
import { useModelCatalog } from '../../agents/use-model-catalog'
import { CheckoutChoice } from '../creation/checkout-choice'
import { LinkedCheckoutEditor } from '../detail/linked-projects'
import { TaskMachineSelector } from '../creation/task-machine-selector'
import { WorktreeBasePicker } from '../creation/worktree-base-picker'
import { useApplicationState } from '../../runtime/state/application-state'
import { Glass } from '../../ui/layout/glass'
import { MessageAttachments } from '../conversation/components/message-attachments'
import { ActivityIndicator, Alert, Keyboard, Linking, Pressable, View } from 'react-native'
import { Text } from '../../ui/content/text'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  REVIEW_PROMPT,
  contextMeter,
  responses,
  taskResources,
  worktreeChoicesSchema,
  taskForkResultSchema,
  type WorktreeChoices,
  type Task,
  type Repository,
} from '@dovo/protocol'
import { Effect, Schema } from 'effect'
import { mutableStruct } from '@dovo/protocol'
import { useTaskConversation } from '../conversation/state/provider'
import { Action } from '../../ui/controls/action'
import { ComposerField } from './composer-field'
import { Sheet } from '../../ui/layout/sheet'
import { useTheme } from '../../ui/theme'
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
import { useNavigation } from '../../shell/navigation'
export function Composer({
  task,
  onAsk,
  onSelectRemote,
  renderAbove,
  queuedMessages,
}: {
  task: Task
  queuedMessages?: ReactNode
  renderAbove?: (setup: ReactNode) => ReactNode
  onAsk?: (chatId?: string) => void
  onSelectRemote?: (
    runtimeId: string,
    repository: Repository,
    text: string,
    autoProject?: boolean,
    autoProjectExecution?: Task['autoProjectExecution'],
  ) => Promise<void>
}) {
  const { colors, styles } = useTheme()

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
  const { navigate } = useNavigation()
  const forkAction = useAction()
  const checkoutAction = useAction()
  const forkAttempt = useRef<{
    scope: string
    id: string
    text: string
    attachmentIds: string[]
  } | null>(null)
  const [advanced, setAdvanced] = useApplicationState(false)
  useEffect(() => setAdvanced(false), [task.id, task.repositoryId, setAdvanced])
  const [machineMoving, setMachineMoving] = useApplicationState(false)
  const [linkingProjects, setLinkingProjects] = useApplicationState(false)
  const linkedProjectsAction = useAction()
  const [asideCreating, setAsideCreating] = useState(false)
  const [asideBusy, setAsideBusy] = useState(false)
  const asideRequest = useRef(false)
  const latestDraft = useRef(draft)
  latestDraft.current = draft
  const busy =
    actionBusy ||
    machineMoving ||
    forkAction.busy ||
    checkoutAction.busy ||
    asideCreating ||
    linkedProjectsAction.busy
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
  const type = useCallback((text: string) => draft.update(text, 'keyboard'), [draft.update])
  const meter = contextMeter(task)
  const { call, callEffect: commandCall, activeId } = useRuntime()
  const askAside = async () => {
    if (
      !onAsk ||
      !connected ||
      !draft.ready ||
      busy ||
      asideRequest.current ||
      dictation.active ||
      task.archived ||
      task.archivedAt
    )
      return
    const text = latestDraft.current.text
    if (!text.trim()) {
      onAsk()
      return
    }
    if (text.length > 4000) {
      Alert.alert('Side question too long', 'Side questions can contain up to 4,000 characters.')
      return
    }
    asideRequest.current = true
    setAsideBusy(true)
    setAsideCreating(true)
    try {
      const chat = await call(
        '/api/tasks/side-chat/save',
        { id: task.id, draft: text },
        mutableStruct({ id: Schema.String }),
      )
      if (latestDraft.current.key === draft.key && latestDraft.current.text === text)
        draft.update('')
      setAsideCreating(false)
      onAsk(chat.id)
      await call(
        '/api/tasks/side-chat/ask',
        { id: task.id, chatId: chat.id, question: text },
        mutableStruct({ answer: Schema.String }),
      )
    } catch (cause) {
      Alert.alert(
        'Could not ask side question',
        cause instanceof Error ? cause.message : String(cause),
      )
    } finally {
      asideRequest.current = false
      setAsideBusy(false)
      setAsideCreating(false)
    }
  }
  const startFork = () => {
    const text = draft.text.trim()
    const attachmentIds = (actions.draftAttachments ?? []).map((file) => file.id)
    if (
      !connected ||
      busy ||
      attaching ||
      (!text && !attachmentIds.length) ||
      (agent && permissionPolicyUIIssue(agent, snapshot?.permissionPolicySupported === true))
    )
      return
    const scope = actions.threadScope
    if (
      forkAttempt.current?.scope !== scope ||
      forkAttempt.current.text !== text ||
      JSON.stringify(forkAttempt.current.attachmentIds) !== JSON.stringify(attachmentIds)
    )
      forkAttempt.current = { scope, id: randomUUID(), text, attachmentIds }
    forkAction.act(() =>
      commandCall(
        '/api/tasks/start-fork',
        { id: task.id, forkId: forkAttempt.current?.id, text, attachmentIds },
        taskForkResultSchema,
      ).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            draft.update('')
            if (attachmentIds.length)
              void patch({
                draftAttachments: {
                  before: task.draftAttachments,
                  after: task.draftAttachments?.filter((file) => !attachmentIds.includes(file.id)),
                },
              }).catch((cause: unknown) =>
                Alert.alert(
                  'Could not clear the original attachments',
                  cause instanceof Error ? cause.message : String(cause),
                ),
              )
            forkAttempt.current = null
            navigate('tasks', result.id, activeId ?? undefined)
          }),
        ),
      ),
    )
  }
  useEffect(() => {
    if (forkAction.error) Alert.alert('Could not start in fork', forkAction.error)
  }, [forkAction.error])
  const commandAction = useAction()
  const compactDisabled =
    !connected ||
    busy ||
    commandAction.busy ||
    task.status === 'running' ||
    !!task.archived ||
    !!task.archivedAt ||
    !task.sessionId ||
    !!task.queue?.length
  const repository = snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const hasGit = !!repository && !repository.kind
  const checkoutLabel = task.existingWorktreePath
    ? `Existing worktree · ${task.existingWorktreePath.split(/[\\/]/).at(-1)}`
    : task.execution === 'worktree'
      ? `New worktree${task.worktreeBaseBranch ? ` · ${task.worktreeBaseBranch}` : ''}`
      : `Local checkout${repository?.branch ? ` · ${repository.branch}` : ''}`
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
      .find((item) => item.status !== 'running' && checkpointCanUndo(item.checkpoint))
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
  const hasSideQuestion = !!onAsk && task.messages.length > 0
  const showFollowupActions =
    showOptions && !dictation.active && task.status === 'running' && hasInput
  const showFork = hasGit && !!task.repositoryId
  const sideQuestionAction = hasSideQuestion && (
    <IconButton
      variant="plain"
      icon="chat"
      label="Ask a side question"
      disabled={
        !connected ||
        busy ||
        asideBusy ||
        !draft.ready ||
        dictation.active ||
        !!task.archived ||
        !!task.archivedAt
      }
      onPress={() => void askAside()}
    />
  )
  const canDictate = draft.ready && !busy && !task.archivedAt && !attaching
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
  const selectProject = async (repository: Repository, autoProject?: boolean) => {
    const next = {
      ...(autoProject
        ? changeTaskAutoProject(
            task,
            snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId),
            repository,
            snapshot?.defaults,
            snapshot?.workspace.agents,
            snapshot?.autoProjectModelSelection ?? 'inherit',
          )
        : changeTaskProject(
            task,
            snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId),
            repository,
            snapshot?.defaults,
            snapshot?.workspace.agents,
          )),
      autoProject,
      autoProjectExecution: autoProject ? task.autoProjectExecution : undefined,
    }
    const fields = [
      'repositoryId',
      'autoProject',
      'autoProjectExecution',
      'agentId',
      'agentOverrides',
      'harness',
      'harnessCustomized',
      'modelSelection',
      'execution',
      'setupCommand',
      'worktreeFromOrigin',
      'worktreeIncludeChanges',
      'existingWorktreePath',
      'worktreeBaseBranch',
    ] as const
    await patch(
      Object.fromEntries(
        fields.map((field) => [field, { before: task[field] ?? null, after: next[field] ?? null }]),
      ),
    )
  }
  const setup =
    checkoutEditable ||
    (task.execution === 'worktree' && task.pullRequest && !task.checkoutBranch) ? (
      <>
        {checkoutEditable && (
          <View testID="Task setup" style={{ gap: 8, width: '100%' }}>
            <TaskMachineSelector
              task={task}
              text={draft.text}
              disabled={busy || !draft.ready || attaching || dictation.active}
              onMoving={setMachineMoving}
              onSelectRemote={onSelectRemote}
              onAuto={async () => {
                const repository = snapshot?.workspace.repositories.find(
                  (repo) => repo.kind === 'scratch',
                )
                if (!repository) throw new Error('The private thread folder is unavailable.')
                await selectProject(repository, true)
              }}
              onProjectChange={async (repository, preserveAuto) => {
                if (repository.id === task.repositoryId && (preserveAuto || !task.autoProject))
                  return
                await selectProject(repository, preserveAuto ? task.autoProject : undefined)
              }}
            />
            {repository?.kind === 'scratch' && !task.autoProject && (
              <Action
                secondary
                label={
                  task.linkedCheckouts?.length
                    ? `Link projects (${task.linkedCheckouts.length})`
                    : 'Link projects'
                }
                disabled={busy || !connected || !draft.ready || attaching || dictation.active}
                onPress={() => {
                  Keyboard.dismiss()
                  setLinkingProjects(true)
                }}
              />
            )}
            {(task.autoProject || hasGit) && !dictation.active && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Advanced"
                accessibilityState={{ expanded: advanced }}
                onPress={() => setAdvanced(!advanced)}
                style={[styles.row, { minHeight: 44, paddingHorizontal: 12 }]}
              >
                <Text style={[styles.muted, { flex: 1 }]}>Advanced</Text>
                <Icon name={advanced ? 'down' : 'next'} size={14} color={colors.muted} />
              </Pressable>
            )}
            {advanced && (
              <View style={{ gap: 8 }}>
                {task.autoProject && snapshot?.autoProjectSelectionEnabled === true && (
                  <View
                    accessibilityLabel="Scope checkout"
                    style={[styles.row, { flexWrap: 'wrap', gap: 8 }]}
                  >
                    {(
                      [
                        { label: 'Project defaults', value: undefined },
                        { label: 'New worktrees', value: 'worktree' },
                        { label: 'Local checkouts', value: 'main' },
                      ] as const
                    ).map(({ label, value }) => (
                      <Pressable
                        key={label}
                        accessibilityRole="button"
                        accessibilityLabel={label}
                        accessibilityState={{
                          selected: task.autoProjectExecution === value,
                          disabled: busy,
                        }}
                        disabled={busy}
                        onPress={() =>
                          void checkoutAction.run(() =>
                            patch({
                              autoProjectExecution: {
                                before: task.autoProjectExecution ?? null,
                                after: value ?? null,
                              },
                            }),
                          )
                        }
                        style={[
                          styles.row,
                          { padding: 10, borderRadius: 10, backgroundColor: colors.surface },
                        ]}
                      >
                        <Icon
                          name={task.autoProjectExecution === value ? 'check' : 'folder'}
                          size={16}
                        />
                        <Text style={styles.text}>{label}</Text>
                      </Pressable>
                    ))}
                  </View>
                )}
                {hasGit && !task.autoProject && !dictation.active && (
                  <Pressable
                    testID="Checkout & branch"
                    accessibilityRole="button"
                    accessibilityLabel="Checkout & branch"
                    accessibilityValue={{ text: checkoutLabel }}
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
                      borderRadius: 12,
                      backgroundColor: colors.surface,
                      flexWrap: 'nowrap',
                      paddingHorizontal: 12,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
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
                          flex: 1,
                        },
                      ]}
                    >
                      {checkoutLabel}
                    </Text>
                    <Icon name="down" size={10} color={colors.muted} />
                  </Pressable>
                )}
              </View>
            )}
          </View>
        )}
        {task.execution === 'worktree' && task.pullRequest && !task.checkoutBranch && (
          <Text style={styles.muted}>
            {task.pullRequest.checkoutMode === 'pr-branch'
              ? 'PR branch in new worktree:'
              : 'New worktree from'}{' '}
            {task.pullRequest.headBranch || `PR #${task.pullRequest.number}`}
          </Text>
        )}
      </>
    ) : null
  if (
    snapshot?.questions.some(
      (question) => question.taskId === task.id && question.prompt.blocking !== false,
    )
  )
    return (
      <>
        {renderAbove?.(null)}
        {queuedMessages}
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
      </>
    )
  if (car && !typing)
    return (
      <>
        {renderAbove?.(null)}
        {queuedMessages}
        <CarComposer task={task} onType={() => setTyping(true)} />
      </>
    )
  const input = (
    <FileDropTarget
      key={actions.threadScope}
      enabled={
        connected && draft.ready && !busy && !attaching && !dictation.active && !task.archivedAt
      }
      upload={attachmentPicker.upload}
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={commandAction.busy ? 'Compacting context' : 'Compact context'}
          accessibilityHint={meter.label}
          accessibilityState={{ disabled: compactDisabled }}
          disabled={compactDisabled}
          style={({ pressed }) => ({
            alignSelf: 'flex-end',
            minHeight: 44,
            justifyContent: 'center',
            opacity: compactDisabled ? 0.4 : pressed ? 0.6 : 1,
          })}
          onPress={() => runCommand('compact')}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            {commandAction.busy ? (
              <ActivityIndicator size="small" color={colors.muted} />
            ) : (
              <Icon name="collapse" size={12} color={colors.muted} />
            )}
            <Text style={{ color: colors.muted, fontSize: 12 }}>
              {commandAction.busy ? 'Compacting…' : 'Compact context'}
            </Text>
          </View>
        </Pressable>
      )}
      {!renderAbove && setup}
      {queuedMessages}
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
          edit={attachmentPicker.edit}
          disabled={busy || attaching}
          onBusy={setAttaching}
        />
        {focused && (
          <FileMentions
            taskId={task.id}
            text={draft.text}
            caret={caret}
            resources={taskResources(
              task,
              {
                agents: snapshot?.workspace.agents ?? [],
                repositories: snapshot?.workspace.repositories ?? [],
              },
              snapshot?.defaults,
            )}
            onChange={draft.update}
            onCommand={
              task.messages.length || task.queue?.length || task.turns?.length
                ? runCommand
                : undefined
            }
            prompts={projectPrompts(
              snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId),
              snapshot?.defaults,
            )}
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
                key={draft.key}
                onFocus={focus}
                onBlur={blur}
                onSelectionChange={select}
                placeholder={
                  dictation.isRecording
                    ? 'Listening…'
                    : task.archivedAt
                      ? 'Restore this archived thread to continue'
                      : task.archived
                        ? 'Send a message to reopen this thread…'
                        : firstMessage
                          ? 'What would you like to work on?'
                          : task.status === 'running'
                            ? 'Add a follow-up…'
                            : 'Ask a follow-up…'
                }
                value={draft.text}
                revision={draft.revision}
                onChangeText={type}
                editable={draft.ready && !busy && !dictation.active && !task.archivedAt}
                showOptions={showOptions}
                trailingControlCount={2 + Number(hasSideQuestion)}
              />
            </View>
            {focused && (
              <IconButton
                label="Dismiss keyboard"
                variant="plain"
                icon="keyboard"
                onPress={() => Keyboard.dismiss()}
              />
            )}
            {/* Stay at the row's trailing edge when the keyboard button disappears on blur. */}
            {showFollowupActions && sideQuestionAction}
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
              disabled={!connected || busy || attaching || dictation.active || !!task.archivedAt}
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
                  {(task.modelSelection === 'auto' || task.modelSelection === 'smart') && (
                    <Icon
                      name={task.modelSelection === 'auto' ? 'tune' : 'maestro'}
                      size={15}
                      color={colors.muted}
                    />
                  )}
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
            {!showFollowupActions && sideQuestionAction}
            {showFollowupActions && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                }}
              >
                <IconButton
                  variant="plain"
                  icon="queue"
                  label="Queue follow-up"
                  disabled={!canSend || busy}
                  onPress={() => send()}
                />
                <IconButton
                  variant="plain"
                  icon="steer"
                  label="Steer agent"
                  disabled={!canSend || busy}
                  onPress={() => send('steer')}
                />
                {showFork && (
                  <IconButton
                    variant="plain"
                    icon="changes"
                    label="Fork"
                    disabled={!canSend || busy}
                    onPress={startFork}
                  />
                )}
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
      {linkingProjects &&
        checkoutEditable &&
        repository?.kind === 'scratch' &&
        !task.autoProject && (
          <Sheet
            title="Linked projects"
            onClose={() => setLinkingProjects(false)}
            busy={linkedProjectsAction.busy}
          >
            <LinkedCheckoutEditor
              value={task.linkedCheckouts ?? []}
              disabled={busy || !connected}
              onChange={(links) =>
                void linkedProjectsAction.run(() =>
                  patch({
                    linkedCheckouts: { before: task.linkedCheckouts ?? null, after: links },
                  }),
                )
              }
            />
            {!!linkedProjectsAction.error && (
              <Text accessibilityRole="alert" style={styles.error}>
                {linkedProjectsAction.error}
              </Text>
            )}
            <Action
              label="Done"
              disabled={linkedProjectsAction.busy}
              onPress={() => setLinkingProjects(false)}
            />
          </Sheet>
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
                  existingWorktreePath: {
                    before: task.existingWorktreePath ?? null,
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
            <>
              <Action
                secondary
                label={`${task.worktreeIncludeChanges ? '✓ ' : ''}Include uncommitted changes`}
                disabled={busy || !connected}
                onPress={() =>
                  act(() =>
                    patch({
                      worktreeIncludeChanges: {
                        before: task.worktreeIncludeChanges ?? null,
                        after: !task.worktreeIncludeChanges,
                      },
                      worktreeBaseBranch: { before: task.worktreeBaseBranch ?? null, after: null },
                    }),
                  )
                }
              />
              {task.worktreeIncludeChanges ? (
                <Text style={styles.muted}>
                  Starts from current files, including changes. Source stays unchanged.
                </Text>
              ) : (
                <WorktreeBasePicker
                  key={task.repositoryId}
                  repositoryId={task.repositoryId}
                  value={task.worktreeBaseBranch}
                  fromOrigin={task.worktreeFromOrigin}
                  onChange={(value) =>
                    act(() =>
                      patch({
                        worktreeBaseBranch: {
                          before: task.worktreeBaseBranch ?? null,
                          after: value,
                        },
                      }),
                    )
                  }
                />
              )}
            </>
          )}
          <Action label="Done" onPress={() => setCheckout(false)} />
        </Sheet>
      )}
      {!!(error || checkoutAction.error || draft.error || attachmentPicker.error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || checkoutAction.error || draft.error || attachmentPicker.error}
        </Text>
      )}
      {attachmentPicker.editor}
      {settings && <HarnessSettings task={task} onClose={() => setSettings(false)} />}
    </FileDropTarget>
  )
  return renderAbove ? (
    <>
      {renderAbove(setup)}
      {input}
    </>
  ) : (
    input
  )
}
