import { blockAccessibleNotificationInputs } from '../../notifications/visibility'
import { randomUUID } from 'expo-crypto'
import { useForkDraft } from './use-fork-draft'
import { ThreadContextPicker } from './thread-context-picker'
import { DraftStash } from './draft-stash'
import { draftStashScope } from '@dovo/protocol'
import { contentColumn } from '../../ui/layout/content-column'
import { ThreadStartModes } from '../creation/thread-start-modes'
import { ThreadStarters } from '../creation/thread-starters'
import { TurnModelControls } from './turn-model-controls'
import { applyTurnSettings } from '@dovo/protocol'
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
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  REVIEW_PROMPT,
  contextMeter,
  responses,
  taskResources,
  worktreeChoicesSchema,
  type WorktreeChoices,
  type Task,
  type Repository,
} from '@dovo/protocol'
import { Effect, Schema } from 'effect'
import { mutableStruct } from '@dovo/protocol'
import { useTaskConversation } from '../conversation/state/provider'
import { Action } from '../../ui/controls/action'
import { ComposerField } from './composer-field'
import { Sheet, type SheetHandle } from '../../ui/layout/sheet'
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
import { useCarMode } from '../../runtime/preferences/app-preferences'
export function Composer({
  task,
  onAsk,
  onSelectRemote,
  renderAbove,
  queuedMessages,
}: {
  task: Task
  queuedMessages?: ReactNode
  renderAbove?: (setup: ReactNode, starters?: ReactNode, startModes?: ReactNode) => ReactNode
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
    editing,
    cancelEdit,
    turnSettings,
    setTurnSettings,
  } = actions
  const nextTurnControls =
    !!snapshot?.queuedTurnSettingsSupported &&
    !!agent &&
    (!!editing || task.status === 'running' || !!task.queue?.length || !!turnSettings)
  const composerAgent =
    agent && nextTurnControls ? applyTurnSettings(agent, turnSettings ?? undefined) : agent
  const { modelName, catalog: modelCatalog } = useModelCatalog(composerAgent)
  const modelLabel = taskHarnessLabel(
    nextTurnControls && turnSettings ? { ...task, modelSelection: undefined } : task,
    composerAgent,
    snapshot?.acpInstallations,
    modelName,
    modelCatalog?.harness?.name,
  )
  const { activeId: stashRuntimeId } = useRuntime()
  const checkoutAction = useAction()
  const [turnModelOpen, setTurnModelOpen] = useApplicationState(false)
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
  const fork = useForkDraft({
    task,
    draft,
    turnSettings,
    disabled:
      actionBusy ||
      machineMoving ||
      checkoutAction.busy ||
      asideCreating ||
      linkedProjectsAction.busy ||
      attaching ||
      dictation.active ||
      !!editing ||
      !!(agent && permissionPolicyUIIssue(agent, snapshot?.permissionPolicySupported === true)),
  })
  const busy =
    actionBusy ||
    machineMoving ||
    fork.busy ||
    checkoutAction.busy ||
    asideCreating ||
    linkedProjectsAction.busy
  const [focused, setFocused] = useApplicationState(false),
    [settings, setSettings] = useApplicationState(false),
    [checkout, setCheckout] = useApplicationState(false)
  const [draftTools, setDraftTools] = useState<'menu' | 'stash' | 'context'>()
  const toolsSheet = useRef<SheetHandle>(null)
  const [messageActions, setMessageActions] = useState(false)
  const messageActionsSheet = useRef<SheetHandle>(null)
  useEffect(
    () => setMessageActions(false),
    [task.id, task.status, editing?.message.id, stashRuntimeId],
  )
  useEffect(() => setDraftTools(undefined), [task.id, stashRuntimeId])
  const [starterFocus, setStarterFocus] = useState<string>()
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
  const { call, callEffect: commandCall } = useRuntime()
  const askAside = async () => {
    if (
      !!editing ||
      !!draft.pendingFork ||
      !!draft.pendingRestore ||
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
  const notificationBlocked = !!(
    turnModelOpen ||
    checkout ||
    settings ||
    linkingProjects ||
    messageActions ||
    draftTools === 'menu' ||
    attachmentPicker.editor
  )
  useLayoutEffect(() => {
    if (notificationBlocked) return blockAccessibleNotificationInputs()
  }, [notificationBlocked])
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
  const hasSideQuestion = !editing && !!onAsk && task.messages.length > 0
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
    if (latestDraft.current.pendingFork)
      throw new Error('Resolve the pending fork before changing its project or computer')
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
  const showStartModes =
    !!renderAbove && firstMessage && task.status === 'draft' && checkoutEditable
  const startModeDisabled =
    !connected ||
    busy ||
    !draft.ready ||
    attaching ||
    dictation.active ||
    !!draft.pendingFork ||
    !!task.archivedAt ||
    !!task.archived ||
    !!task.example ||
    !!task.pullRequest ||
    !!task.workItem ||
    !!actions.draftAttachments?.length
  const machineSelector = (
    <TaskMachineSelector
      prominent={showStartModes}
      renderControls={
        showStartModes
          ? (project, server) => (
              <ThreadStartModes
                selected={!task.autoProject && repository?.kind === 'scratch'}
                disabled={
                  startModeDisabled ||
                  !snapshot?.workspace.repositories.some((repo) => repo.kind === 'scratch')
                }
                project={project}
                server={server}
                onGeneral={() => {
                  const target = snapshot?.workspace.repositories.find(
                    (repo) => repo.kind === 'scratch',
                  )
                  if (!target || (task.repositoryId === target.id && !task.autoProject)) return
                  act(() => selectProject(target))
                }}
              />
            )
          : undefined
      }
      task={task}
      text={draft.text}
      disabled={startModeDisabled}
      onMoving={setMachineMoving}
      onSelectRemote={
        onSelectRemote
          ? async (...args) => {
              if (latestDraft.current.pendingFork)
                throw new Error('Resolve the pending fork before changing its computer')
              return onSelectRemote(...args)
            }
          : undefined
      }
      onAuto={async () => {
        const repository = snapshot?.workspace.repositories.find((repo) => repo.kind === 'scratch')
        if (!repository) throw new Error('The private thread folder is unavailable.')
        await selectProject(repository, true)
      }}
      onProjectChange={async (repository, preserveAuto) => {
        if (repository.id === task.repositoryId && (preserveAuto || !task.autoProject)) return
        await selectProject(repository, preserveAuto ? task.autoProject : undefined)
      }}
    />
  )
  const setup =
    checkoutEditable ||
    (task.execution === 'worktree' && task.pullRequest && !task.checkoutBranch) ? (
      <>
        {checkoutEditable && (
          <View testID="Task setup" style={{ gap: 8, width: '100%' }}>
            {!showStartModes && machineSelector}
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
        connected &&
        draft.ready &&
        !busy &&
        !attaching &&
        !dictation.active &&
        !task.archivedAt &&
        (!editing || !!snapshot?.fullTurnSettingsSupported)
      }
      upload={attachmentPicker.upload}
      testID="Composer"
      style={[
        styles.content,
        contentColumn.conversation,
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
      {editing && (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 8 }}>
          <Text style={[styles.muted, { flex: 1 }]}>
            {task.queue?.some((message) => message.id === editing.message.id)
              ? 'Edit queued message'
              : 'This message already started or was removed. Your edit is kept in the composer.'}
          </Text>
          <Action
            secondary
            label="Cancel edit"
            disabled={busy || attaching || dictation.active}
            onPress={cancelEdit}
          />
        </View>
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
          remove={editing ? actions.removeEditAttachment : undefined}
          removable
          edit={attachmentPicker.edit}
          disabled={
            (!!editing && !snapshot?.fullTurnSettingsSupported) ||
            busy ||
            attaching ||
            (!!draft.pendingFork && !draft.pendingFork.accepted)
          }
          onBusy={setAttaching}
        />
        {focused && (
          <FileMentions
            taskId={task.id}
            text={draft.text}
            caret={caret}
            resources={taskResources(
              turnSettings?.harness
                ? { ...task, agentId: '', agentOverrides: undefined, harness: turnSettings.harness }
                : task,
              {
                agents: snapshot?.workspace.agents ?? [],
                repositories: snapshot?.workspace.repositories ?? [],
              },
              snapshot?.defaults,
            )}
            onChange={draft.update}
            onCommand={
              !editing && (task.messages.length || task.queue?.length || task.turns?.length)
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
                focusKey={editing?.message.id ?? starterFocus}
                key={draft.key}
                onFocus={focus}
                onBlur={blur}
                onSelectionChange={select}
                placeholder={
                  editing
                    ? 'Edit queued message…'
                    : dictation.isRecording
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
            {showOptions && (
              // Keep a draft's line width unchanged when the keyboard is dismissed.
              <View style={{ width: 44, minHeight: 44, flexShrink: 0 }}>
                {focused && (
                  <IconButton
                    label="Dismiss keyboard"
                    variant="plain"
                    icon="keyboard"
                    onPress={() => Keyboard.dismiss()}
                  />
                )}
              </View>
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
              label="Add to draft"
              disabled={
                busy || dictation.active || !!task.archivedAt || !!task.archived || !!task.example
              }
              onPress={() => {
                Keyboard.dismiss()
                setDraftTools('menu')
              }}
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
              {turnModelOpen && agent && (
                <Sheet title="Agent & model" onClose={() => setTurnModelOpen(false)}>
                  {snapshot?.fullTurnSettingsSupported ? (
                    <HarnessSettings
                      inline
                      task={task}
                      onClose={() => setTurnModelOpen(false)}
                      turn={{
                        value: turnSettings,
                        onChange: setTurnSettings,
                        beforeMessageId: editing?.message.id,
                      }}
                    />
                  ) : (
                    <TurnModelControls
                      task={task}
                      agent={agent}
                      value={turnSettings}
                      onChange={setTurnSettings}
                      disabled={busy || !!task.archived}
                    />
                  )}
                </Sheet>
              )}
              {showOptions && !dictation.active && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Agent & model"
                  accessibilityValue={{
                    text: `${nextTurnControls ? 'Next turn: ' : ''}${modelLabel}`,
                  }}
                  accessibilityState={{
                    disabled:
                      busy ||
                      ((!!editing || task.status === 'running') && !nextTurnControls) ||
                      !!task.archived,
                  }}
                  disabled={
                    busy ||
                    ((!!editing || task.status === 'running') && !nextTurnControls) ||
                    task.archived
                  }
                  onPress={() => {
                    if (dictation.active) dictation.stop()
                    Keyboard.dismiss()
                    if (nextTurnControls) setTurnModelOpen(true)
                    else setSettings(true)
                  }}
                  style={({ pressed }) => ({
                    flex: 1,
                    minWidth: 44,
                    minHeight: 44,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    opacity:
                      pressed ||
                      busy ||
                      ((!!editing || task.status === 'running') && !nextTurnControls) ||
                      task.archived
                        ? 0.5
                        : 1,
                  })}
                >
                  {!nextTurnControls &&
                    (task.modelSelection === 'auto' || task.modelSelection === 'smart') && (
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
                    {modelLabel}
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
            <IconButton
              variant="filled"
              icon={
                editing
                  ? 'send'
                  : task.status === 'running'
                    ? hasInput
                      ? 'queue'
                      : 'stop'
                    : 'send'
              }
              label={
                editing
                  ? 'Save changes'
                  : task.status === 'running'
                    ? hasInput
                      ? 'Queue follow-up'
                      : 'Stop'
                    : 'Send'
              }
              disabled={
                machineMoving ||
                (!editing && task.status === 'running' && !hasInput
                  ? !connected || stopping
                  : !canSend || fork.busy)
              }
              onPress={!editing && task.status === 'running' && !hasInput ? stop : () => send()}
              onLongPress={
                !editing && task.status === 'running' ? () => setMessageActions(true) : undefined
              }
            />
          </View>
          {messageActions && !editing && task.status === 'running' && (
            <Sheet
              ref={messageActionsSheet}
              title="Message actions"
              onClose={() => setMessageActions(false)}
            >
              {showFork && (
                <Action
                  secondary
                  label="Fork"
                  disabled={!canSend || busy || !!turnSettings}
                  onPress={() => messageActionsSheet.current?.dismiss(fork.start)}
                />
              )}
              <Action
                secondary
                label="Queue follow-up"
                disabled={!canSend || busy}
                onPress={() => messageActionsSheet.current?.dismiss(() => send())}
              />
              <Action
                secondary
                label="Steer agent"
                disabled={!canSend || busy || !!turnSettings}
                onPress={() => messageActionsSheet.current?.dismiss(() => send('steer'))}
              />
              <Action
                secondary
                label="Stop"
                disabled={!connected || stopping || machineMoving}
                onPress={() => messageActionsSheet.current?.dismiss(stop)}
              />
            </Sheet>
          )}
          {draftTools === 'menu' && (
            <Sheet ref={toolsSheet} title="Add to draft" onClose={() => setDraftTools(undefined)}>
              <Action
                label="Attach photos or files"
                secondary
                disabled={
                  (!!editing && !snapshot?.fullTurnSettingsSupported) ||
                  !connected ||
                  busy ||
                  attaching ||
                  dictation.active ||
                  !!task.archivedAt
                }
                onPress={() => toolsSheet.current?.dismiss(attachmentPicker.pick)}
              />
              <Action
                label="Stashed drafts"
                secondary
                disabled={
                  !stashRuntimeId ||
                  !!editing ||
                  busy ||
                  !draft.ready ||
                  dictation.active ||
                  !!task.archivedAt ||
                  !!task.archived ||
                  !!task.example
                }
                onPress={() => toolsSheet.current?.dismiss(() => setDraftTools('stash'))}
              />
              <Action
                label="Attach thread context"
                secondary
                disabled={
                  !connected ||
                  !!editing ||
                  busy ||
                  !draft.ready ||
                  attaching ||
                  !!task.archivedAt ||
                  !!task.archived ||
                  !!task.example
                }
                onPress={() => toolsSheet.current?.dismiss(() => setDraftTools('context'))}
              />
            </Sheet>
          )}
          <DraftStash
            open={draftTools === 'stash'}
            onOpenChange={(open) => setDraftTools(open ? 'stash' : undefined)}
            key={JSON.stringify(['stash', stashRuntimeId, task.id])}
            scope={stashRuntimeId ? draftStashScope(stashRuntimeId, task.id) : undefined}
            getText={() => latestDraft.current.text}
            onChange={(value) => draft.update(value)}
            focus={() => setStarterFocus(randomUUID())}
            hasAttachments={!!actions.draftAttachments?.length || attaching}
            disabled={
              !!editing ||
              busy ||
              !draft.ready ||
              dictation.active ||
              !!task.archivedAt ||
              !!task.archived ||
              !!task.example
            }
          />
          <ThreadContextPicker
            open={draftTools === 'context'}
            onOpenChange={(open) => setDraftTools(open ? 'context' : undefined)}
            key={JSON.stringify(['context', stashRuntimeId, task.id])}
            taskId={task.id}
            attachmentBusy={attaching}
            disabled={
              !!editing ||
              busy ||
              !draft.ready ||
              !!task.archivedAt ||
              !!task.archived ||
              !!task.example
            }
            upload={attachmentPicker.uploadContext}
          />
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
      {showFork && !!turnSettings && (
        <Text style={styles.muted}>
          Fork uses the thread’s settings. Select Use thread defaults to fork.
        </Text>
      )}
      {!!fork.pending && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert">A fork request is waiting for this computer.</Text>
          <Text numberOfLines={3}>{fork.pending.text}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Action label="Retry fork" disabled={!connected || busy} onPress={fork.retry} />
            <Action label="Discard fork request" disabled={busy} onPress={fork.discard} secondary />
          </View>
        </View>
      )}
      {!!actions.pendingRestore && (
        <View style={{ gap: 8 }}>
          <Text accessibilityRole="alert">
            A queued message is waiting to return to this draft.
          </Text>
          <Text numberOfLines={3}>{actions.pendingRestore.text}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Action
              label="Retry restore"
              disabled={!connected || busy}
              onPress={actions.retryRestore}
            />
            <Action
              label="Discard restore"
              disabled={busy}
              onPress={actions.discardRestore}
              secondary
            />
          </View>
        </View>
      )}
      {!!(error || fork.error || checkoutAction.error || draft.error || attachmentPicker.error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || fork.error || checkoutAction.error || draft.error || attachmentPicker.error}
        </Text>
      )}
      {attachmentPicker.editor}
      {settings && <HarnessSettings task={task} onClose={() => setSettings(false)} />}
    </FileDropTarget>
  )
  return renderAbove ? (
    <>
      {renderAbove(
        setup,
        firstMessage && task.status === 'draft' && !hasInput ? (
          <ThreadStarters
            disabled={
              !draft.ready ||
              busy ||
              attaching ||
              dictation.active ||
              !!task.archivedAt ||
              !!task.example
            }
            onChoose={(prompt) => {
              if (latestDraft.current.text.trim()) return
              draft.update(prompt)
              setStarterFocus(randomUUID())
            }}
          />
        ) : null,
        showStartModes ? machineSelector : null,
      )}
      {input}
    </>
  ) : (
    input
  )
}
