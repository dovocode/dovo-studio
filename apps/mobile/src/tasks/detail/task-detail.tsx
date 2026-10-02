import { cachedThread, runtimeSnapshotCacheSchema, watchRuntimeTask } from '@dovo/protocol'
import {
  canChangeTaskCheckout,
  REVIEW_PROMPT,
  responses,
  taskPreparation,
  taskTranscript,
  taskBudgetUsage,
} from '@dovo/protocol'
import { Effect, Schema } from 'effect'
import { mutableStruct } from '@dovo/protocol'
import { useCarMode } from '../../runtime/preferences/app-preferences'
import { useAction } from '../../ui/controls/use-action'
import { useApplicationState } from '../../runtime/state/application-state'
import { TaskAgents } from './task-agents'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BrowserPane, DevicesPane } from '../preview/browser-pane'
import { Conversation } from '../conversation/view'
import { ConversationProvider } from '../conversation/state/provider'
import { useNavigation } from '../../shell/navigation'
import { MessageQueue } from '../composer/message-queue'
import { TaskQuestions } from './task-questions'
import { TaskSettings } from './task-settings'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  View,
  useWindowDimensions,
} from 'react-native'
import { useEffect, useState } from 'react'
import { Text } from '../../ui/content/text'
import { type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Sheet } from '../../ui/layout/sheet'
import { colors, styles } from '../../ui/theme'
import { ScreenHeader, type HeaderAction } from '../../ui/layout/screen-header'
import { Composer } from '../composer/composer'
import { TaskReview } from './task-review'
import { TerminalPane } from '../../terminal/terminal-pane'
import { TaskSource } from './task-source'
import { useTaskViewed } from './use-task-viewed'
import { copyText } from '../../ui/content/clipboard'
import { PreparationProgress } from '../conversation/components/preparation-progress'
import { ReviewComments } from '../conversation/components/review-comments'
import { PullStatus } from './pull-status'
import { PlanApproval } from '../conversation/components/plan-approval'
import { SideQuestion } from '../conversation/components/side-question'
import { ProjectInstructions } from './project-instructions'
import { ReviewFindings } from '../conversation/components/review-findings'
import { randomUUID } from 'expo-crypto'
export function TaskDetail({
  task,
  onBack,
  questionId,
}: {
  task: Task
  onBack: () => void
  questionId?: string
}) {
  const { profile, snapshot, connected, refresh, readCache } = useRuntime()
  const { focused } = useNavigation()
  useEffect(() => {
    if (profile && focused) return watchRuntimeTask(profile.connection, task.id)
  }, [profile?.connection, task.id, focused])
  const loaded = !snapshot?.detailTaskIds || snapshot.detailTaskIds.includes(task.id)
  const [cacheError, setCacheError] = useState<{
    cache: typeof readCache
    id: string
    error: string
  } | null>(null)
  const [cached, setCached] = useState<{ cache: typeof readCache; task: Task } | null>(null)
  useEffect(() => {
    if (loaded || !readCache) return
    let stopped = false
    void readCache
      .read('snapshot', runtimeSnapshotCacheSchema)
      .then((entry) => {
        const value = entry?.value.snapshot
        const saved = value?.workspace.tasks.find((item) => item.id === task.id)
        if (!stopped && saved && (!value?.detailTaskIds || value.detailTaskIds.includes(task.id)))
          setCached({ cache: readCache, task: saved })
      })
      .catch((error: unknown) => {
        if (!stopped)
          setCacheError({
            cache: readCache,
            id: task.id,
            error: error instanceof Error ? error.message : String(error),
          })
      })
    return () => {
      stopped = true
    }
  }, [loaded, readCache, task.id])
  const available = cached?.cache === readCache && cached?.task.id === task.id
  if (!loaded && !available)
    return (
      <View style={{ flex: 1, justifyContent: 'center', gap: 12, padding: 20 }}>
        <ScreenHeader title={task.title} onBack={onBack} />
        <ActivityIndicator />
        <Text style={styles.muted}>
          {cacheError?.cache === readCache && cacheError.id === task.id
            ? cacheError.error
            : connected
              ? 'Loading conversation…'
              : 'This conversation is not cached. Connect its computer to load it.'}
        </Text>
        <Action label="Retry" onPress={refresh} />
      </View>
    )
  return (
    <TaskDetailContent
      task={!loaded && available ? cachedThread(task, cached.task) : task}
      onBack={onBack}
      questionId={questionId}
    />
  )
}
function TaskDetailContent({
  task,
  onBack,
  questionId,
}: {
  task: Task
  onBack: () => void
  questionId?: string
}) {
  const { focused, navigate } = useNavigation()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const { snapshot, connected, profiles, callEffect } = useRuntime()
  const worktreeThread = useAction()
  const worktreeActions: HeaderAction[] =
    task.execution === 'worktree' && (task.checkoutBranch || task.existingWorktreePath)
      ? (['reuse', 'fork'] as const).map((mode) => ({
          label: mode === 'reuse' ? 'New thread in this worktree' : 'Fork worktree',
          icon: mode === 'reuse' ? 'chat' : 'changes',
          overflow: true,
          disabled: !connected || worktreeThread.busy || task.status === 'running',
          onPress: () =>
            worktreeThread.act(() =>
              callEffect(
                '/api/tasks/worktree-thread',
                { id: task.id, mode },
                mutableStruct({ id: Schema.String }),
              ).pipe(Effect.tap((result) => Effect.sync(() => navigate('tasks', result.id)))),
            ),
        }))
      : []
  useEffect(() => {
    if (worktreeThread.error) Alert.alert('Could not create thread', worktreeThread.error)
  }, [worktreeThread.error])
  const resume = useAction()
  const preparation = taskPreparation(task)
  const budget = taskBudgetUsage(task)
  const retry = useAction()
  const [asking, setAsking] = useApplicationState(false)
  const [editingInstructions, setEditingInstructions] = useApplicationState(false)
  const review = useAction()
  const compaction = useAction()
  const branch = task.checkoutBranch
  const projectAction = useAction()
  useEffect(() => {
    if (projectAction.error) Alert.alert('Could not run the action', projectAction.error)
  }, [projectAction.error])
  // Project actions run in the task's terminal on the computer; a worktree needs a first message.
  const actionsReady = !(task.execution === 'worktree' && canChangeTaskCheckout(task))
  const projectActions: HeaderAction[] = actionsReady
    ? (
        snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)?.actions ??
        []
      ).map((action): HeaderAction => ({
        label: `Run ${action.name}`,
        icon: 'terminal',
        overflow: true,
        disabled: !connected || projectAction.busy,
        onPress: () =>
          Alert.alert(`Run ${action.name}?`, action.command, [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Run',
              onPress: () =>
                projectAction.act(() =>
                  callEffect(
                    '/api/terminals/run',
                    { taskId: task.id, command: action.command },
                    responses.terminal,
                  ).pipe(
                    Effect.tap((terminal) =>
                      Effect.sync(() => {
                        setTerminalId(terminal.id)
                        setPane('terminal')
                      }),
                    ),
                  ),
                ),
            },
          ]),
      }))
    : []
  const copied = (value: string) =>
    void copyText(value).then(
      (result) => {
        if (result === 'copied') AccessibilityInfo.announceForAccessibility('Copied')
      },
      (error: unknown) =>
        Alert.alert('Could not copy', error instanceof Error ? error.message : String(error)),
    )
  const conversationActions: HeaderAction[] = task.messages.length
    ? [
        {
          label: 'Review changes',
          icon: 'changes',
          overflow: true,
          disabled: !connected || task.status === 'running' || !task.files.length || review.busy,
          onPress: () =>
            review.act(() =>
              callEffect(
                '/api/tasks/message',
                { id: task.id, messageId: randomUUID(), text: REVIEW_PROMPT, review: true },
                responses.ok,
              ),
            ),
        },
        {
          label: 'Ask a side question',
          icon: 'chat',
          overflow: true,
          disabled: !connected,
          onPress: () => {
            Keyboard.dismiss()
            setAsking(true)
          },
        },
        {
          label: 'Copy conversation',
          icon: 'copy',
          overflow: true,
          onPress: () => copied(taskTranscript(task)),
        },
      ]
    : []
  useEffect(() => {
    if (compaction.error) Alert.alert('Could not compact context', compaction.error)
  }, [compaction.error])
  const compactActions: HeaderAction[] =
    task.sessionId && !task.archived
      ? [
          {
            label: 'Compact agent context',
            icon: 'collapse',
            overflow: true,
            disabled:
              !connected || task.status === 'running' || !!task.queue?.length || compaction.busy,
            onPress: () =>
              compaction.act(() => callEffect('/api/tasks/compact', { id: task.id }, responses.ok)),
          },
        ]
      : []
  const handoff = useAction()
  useEffect(() => {
    if (handoff.error) Alert.alert('Could not move the task', handoff.error)
  }, [handoff.error])
  const inWorktree = task.execution === 'worktree'
  const moveActions: HeaderAction[] =
    !snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)?.kind &&
    !canChangeTaskCheckout(task) &&
    !task.pullRequest &&
    !task.workItem
      ? [
          {
            label: inWorktree ? 'Move to the project folder' : 'Move to its own worktree',
            icon: 'changes',
            overflow: true,
            disabled: !connected || handoff.busy || task.status === 'running',
            onPress: () =>
              Alert.alert(
                inWorktree ? 'Move to the project folder?' : 'Move to its own worktree?',
                inWorktree
                  ? 'The project folder switches to this task’s branch and its worktree is removed. The task’s uncommitted changes come along. The project folder must have no uncommitted changes.'
                  : 'A new worktree and branch are created from the project folder’s current branch. All uncommitted changes in the project folder move with this task.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Move task',
                    onPress: () =>
                      handoff.act(() =>
                        callEffect(
                          '/api/tasks/handoff',
                          { id: task.id, target: inWorktree ? 'main' : 'worktree' },
                          responses.ok,
                        ),
                      ),
                  },
                ],
              ),
          },
        ]
      : []
  const branchActions: HeaderAction[] = branch
    ? [
        {
          label: 'Copy branch name',
          icon: 'copy',
          overflow: true,
          onPress: () => copied(branch),
        },
      ]
    : []
  const needsInput =
    snapshot?.questions.some((q) => q.taskId === task.id) ||
    snapshot?.approvals.some((a) => a.taskId === task.id)
  const repository = snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const latestTurn = task.turns?.at(-1)
  const runtimeHost =
    (latestTurn ? latestTurn.runtimeHost : snapshot?.runtimeHost) ?? 'Unknown device'
  // Name the computer only when there is more than one to tell apart.
  const subtitle = [repository?.name, profiles.length > 1 ? runtimeHost : undefined]
    .filter(Boolean)
    .join(' · ')
  const status = task.archivedAt
    ? 'Archived'
    : task.archived
      ? 'Settled'
      : needsInput
        ? 'Needs input'
        : task.status === 'running'
          ? 'Working'
          : task.status === 'failed'
            ? 'Failed'
            : task.status === 'review'
              ? 'Ready for review'
              : task.status === 'done'
                ? 'Finished'
                : task.status === 'cancelled'
                  ? 'Stopped'
                  : 'Draft'
  const [checkpoint, setCheckpoint] = useApplicationState('')
  const [checkpointPath, setCheckpointPath] = useApplicationState('')
  const [terminalId, setTerminalId] = useApplicationState('')
  const car = useCarMode()
  const [pane, setPane] = useApplicationState<
    'chat' | 'diff' | 'terminal' | 'browser' | 'devices' | 'agents'
  >('chat')
  const hasDiff =
    task.files.length > 0 ||
    (task.turns ?? []).some(
      (turn) =>
        !!turn.checkpoint && turn.checkpoint.files.length + turn.checkpoint.omitted.length > 0,
    )
  useEffect(() => {
    if (pane === 'diff' && !hasDiff) setPane('chat')
  }, [pane, hasDiff])
  const [expandedPreview, setExpandedPreview] = useApplicationState(false)
  const [settings, setSettings] = useApplicationState(false)
  const [settingsBusy, setSettingsBusy] = useApplicationState(false)
  const viewed = useTaskViewed(task, pane === 'chat' && !settings)
  return (
    <View
      style={[
        styles.screen,
        (pane === 'browser' || pane === 'devices') &&
          expandedPreview && {
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
      ]}
    >
      <ScreenHeader
        title={task.title}
        titleContent={
          <Pressable
            testID="Task settings"
            accessibilityRole="button"
            accessibilityLabel={[task.title, subtitle, status].join('. ')}
            accessibilityHint="Open task settings."
            onPress={() => setSettings(true)}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: 'center',
              width: Math.max(80, width - 244),
              minWidth: 0,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text numberOfLines={1} style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}>
              {task.title}
            </Text>
            <Text
              testID="Task device subtitle"
              accessibilityLabel={subtitle}
              numberOfLines={1}
              style={{ color: colors.muted, fontSize: 11, lineHeight: 15 }}
            >
              {subtitle} · {status}
            </Text>
          </Pressable>
        }
        hidden={(pane === 'browser' || pane === 'devices') && expandedPreview}
        gestureEnabled={pane !== 'browser' && pane !== 'devices'}
        onBack={pane === 'browser' || pane === 'devices' ? onBack : undefined}
        leading={<Action secondary label="Back" onPress={onBack} />}
        buttons={(
          [
            'chat',
            ...(hasDiff ? ['diff' as const] : []),
            'terminal',
            'browser',
            'devices',
            'agents',
          ] as const
        )
          .map((tab): HeaderAction => ({
            label:
              tab === 'chat'
                ? 'Chat'
                : tab === 'diff'
                  ? `Changes (${task.files.length})`
                  : tab === 'terminal'
                    ? 'Terminal'
                    : tab === 'agents'
                      ? 'Agents'
                      : tab === 'devices'
                        ? 'Devices'
                        : 'Browser',
            icon:
              tab === 'diff'
                ? 'changes'
                : tab === 'browser'
                  ? 'web'
                  : tab === 'devices'
                    ? 'device'
                    : tab,
            selected: pane === tab,
            // Car mode keeps changes and terminals in the menu, out of sight.
            overflow:
              car || tab === 'chat' || tab === 'browser' || tab === 'devices' || tab === 'agents',
            onPress: () => {
              Keyboard.dismiss()
              setCheckpoint('')
              setExpandedPreview(false)
              if (tab === 'terminal') setTerminalId('')
              setPane(tab)
            },
          }))
          .concat(
            projectActions,
            conversationActions,
            compactActions,
            branchActions,
            worktreeActions,
            moveActions,
            [
              {
                label: 'Edit project instructions',
                icon: 'settings',
                overflow: true,
                onPress: () => setEditingInstructions(true),
              },
            ],
          )}
      />
      <PullStatus task={task} />
      {task.workItem && (
        <View
          style={{
            paddingHorizontal: 16,
          }}
        >
          <TaskSource task={task} />
        </View>
      )}
      {/* Offline and reconnect state lives in the floating pill above the composer. */}
      {viewed.error && (
        <View
          style={[
            styles.row,
            {
              paddingHorizontal: 16,
              gap: 8,
              flexWrap: 'nowrap',
            },
          ]}
        >
          <Text
            style={[
              styles.muted,
              {
                flex: 1,
                fontSize: 12,
              },
            ]}
          >
            Couldn’t save read status.
          </Text>
          <Action secondary label="Retry" disabled={viewed.busy} onPress={viewed.retry} />
        </View>
      )}
      <ConversationProvider
        key={task.id}
        task={task}
        visible={focused && pane === 'chat' && !settings}
        openTerminal={(id) => {
          setTerminalId(id)
          setPane('terminal')
        }}
        openCheckpoint={(id, path) => {
          setCheckpointPath(path ?? '')
          setCheckpoint(id)
          setPane('diff')
        }}
      >
        <View
          style={{
            flex: 1,
            display: pane === 'chat' ? 'flex' : 'none',
          }}
        >
          <Conversation />
          {preparation ? (
            <PreparationProgress
              preparation={preparation}
              onRetry={
                connected
                  ? () =>
                      retry.act(() => callEffect('/api/tasks/run', { id: task.id }, responses.ok))
                  : undefined
              }
              retrying={retry.busy}
              retryError={retry.error}
            />
          ) : task.status === 'running' && task.runPhase === 'preparing' ? (
            <View
              accessibilityRole="text"
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                paddingHorizontal: 16,
                paddingVertical: 8,
              }}
            >
              <ActivityIndicator size="small" color={colors.muted} />
              <Text style={[styles.muted, { flex: 1 }]}>Starting agent…</Text>
            </View>
          ) : null}
          <TaskQuestions taskId={task.id} questionId={questionId} />
          {(budget.tokenExceeded || budget.timeExceeded) && (
            <Text
              accessibilityRole="alert"
              style={[styles.muted, { color: colors.warning, paddingHorizontal: 16 }]}
            >
              Task budget reached · {budget.tokens ?? 'unknown'} tokens ·{' '}
              {Math.round(budget.minutes)} agent minutes. The agent can continue.
            </Text>
          )}
          {task.restartRecovery &&
            task.status !== 'running' &&
            !task.archived &&
            !snapshot?.runs.some((run) => run.taskIds.includes(task.id)) && (
              <View style={{ paddingHorizontal: 16, gap: 8 }}>
                <Action
                  label={task.runPhase === 'finalizing' ? 'Retry saving changes' : 'Resume task'}
                  disabled={!connected || resume.busy}
                  onPress={() =>
                    resume.act(() => callEffect('/api/tasks/run', { id: task.id }, responses.ok))
                  }
                />
                {!!resume.error && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {resume.error}
                  </Text>
                )}
              </View>
            )}
          {task.status === 'cancelled' && !task.archived && !task.restartRecovery && (
            <View style={{ paddingHorizontal: 16, gap: 8 }}>
              <Text style={styles.muted}>
                Stopped ·{' '}
                {task.queue?.length
                  ? `${task.queue.length} queued messages ready`
                  : 'continue with a follow-up'}
              </Text>
              <Action
                label="Continue"
                disabled={!connected || resume.busy}
                onPress={() =>
                  resume.act(() =>
                    Effect.gen(function* () {
                      if (!task.queue?.length)
                        yield* callEffect(
                          '/api/tasks/message',
                          {
                            id: task.id,
                            messageId: randomUUID(),
                            text: 'Continue from where you stopped.',
                            attachmentIds: [],
                          },
                          responses.ok,
                        )
                      yield* callEffect(
                        '/api/tasks/queue',
                        { id: task.id, action: 'resume' },
                        responses.ok,
                      )
                    }),
                  )
                }
              />
              {!!resume.error && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {resume.error}
                </Text>
              )}
            </View>
          )}
          <PlanApproval task={task} />
          <ReviewFindings task={task} onOpen={() => setPane('diff')} />
          <ReviewComments task={task} />
          <MessageQueue task={task} />
          <Composer
            key={task.id}
            task={task}
            onAsk={() => {
              Keyboard.dismiss()
              setAsking(true)
            }}
          />
        </View>
        {pane === 'agents' && <TaskAgents task={task} />}
        {asking && <SideQuestion task={task} onClose={() => setAsking(false)} />}
        {pane === 'browser' && (
          <BrowserPane taskId={task.id} expanded={expandedPreview} onExpand={setExpandedPreview} />
        )}
        {pane === 'devices' && (
          <DevicesPane taskId={task.id} expanded={expandedPreview} onExpand={setExpandedPreview} />
        )}
        {pane === 'diff' && (
          <TaskReview task={task} initialCheckpoint={checkpoint} initialPath={checkpointPath} />
        )}
        {pane === 'terminal' && (
          <TerminalPane task={task} selected={terminalId} onSelect={setTerminalId} />
        )}
      </ConversationProvider>
      {settings && (
        <Sheet title="Task settings" busy={settingsBusy} onClose={() => setSettings(false)}>
          <TaskSettings
            key={task.id}
            task={task}
            onBack={() => setSettings(false)}
            onDeleted={onBack}
            onBusyChange={setSettingsBusy}
          />
        </Sheet>
      )}
      {editingInstructions && task.repositoryId && (
        <ProjectInstructions
          repositoryId={task.repositoryId}
          onClose={() => setEditingInstructions(false)}
        />
      )}
    </View>
  )
}
