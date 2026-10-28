import { useOptionalMobileAccount } from '../../runtime/connection/account-context'
import { ThreadSharing, InlineThreadSuggestions } from './thread-sharing'
import { useTaskPanes } from '../../shell/task-panes'
import { contentColumn } from '../../ui/layout/content-column'
import {
  createRuntimeClient,
  generatedTitleSchema,
  taskPullLinks,
  nativeFailureKey,
  nativeAgentKey as nativeThreadKey,
  workspacePatchResultSchema,
  checkpointFileCount,
  projectDisplayName,
  taskDisplayProject,
  runtimeComputerName,
  conversationPageSchema,
  readConversationHistory,
  cachedThread,
  cachedRuntimeThread,
  runtimeSnapshotCacheSchema,
  watchRuntimeTask,
  canChangeTaskCheckout,
  REVIEW_PROMPT,
  responses,
  taskPreparation,
  taskTranscript,
  taskBudgetUsage,
  mutableStruct,
  type Task,
  type Subagent,
} from '@dovo/protocol'
import { CodeReviewCard } from '../../scm/review/code-review-card'
import { TaskProjectSheet } from './task-project-sheet'
import { TaskLinkedPullSheet } from './task-linked-pull-sheet'
import { TaskThreadBehavior } from './task-thread-behavior'
import { chooseSnoozeDuration } from './use-task-lifecycle'
import { Effect, Schema } from 'effect'
import { useCarMode } from '../../runtime/preferences/app-preferences'
import { useAction } from '../../ui/controls/use-action'
import {
  createDetailDrafts,
  detailDraftKey,
  useDetailDraft,
} from '../../runtime/state/detail-drafts'
import { useApplicationState } from '../../runtime/state/application-state'
import { TaskAgents } from './task-agents'
import { NativeAgentThread } from './native-agent-thread'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BrowserPane, DevicesPane } from '../preview/browser-pane'
import { Conversation } from '../conversation/view'
import { ConversationProvider } from '../conversation/state/provider'
import { useNavigation } from '../../shell/navigation'
import { ComposerActivity } from '../composer/composer-activity'
import { ProjectTransferDialog } from '../../scm/connections/project-transfer'
import { TaskQuestions } from './task-questions'
import { LinkedProjects } from './linked-projects'
import { RenameThread } from './rename-thread'
import { useTaskLifecycle } from './use-task-lifecycle'
import {
  AccessibilityInfo,
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  Platform,
  View,
  useWindowDimensions,
} from 'react-native'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { Text } from '../../ui/content/text'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Sheet } from '../../ui/layout/sheet'
import { useTheme } from '../../ui/theme'
import { ScreenHeader, type HeaderAction } from '../../ui/layout/screen-header'
import { Composer } from '../composer/composer'
import { TaskFiles, type ThreadFileDraft } from '../files/task-files'
import { TaskReview, type FileEditDraft } from './task-review'
import { TerminalPane } from '../../terminal/terminal-pane'
import { useTaskViewed } from './use-task-viewed'
import { copyText } from '../../ui/content/clipboard'
import { PreparationProgress } from '../conversation/components/preparation-progress'
import { ReviewComments } from '../conversation/components/review-comments'
import { PlanApproval } from '../conversation/components/plan-approval'
import { SideQuestion } from '../conversation/components/side-question'
import { ProjectInstructions } from './project-instructions'
import { ProjectApprovalRules } from './project-approval-rules'
import { ReviewFindings } from '../conversation/components/review-findings'
import { randomUUID } from 'expo-crypto'
import { ArtifactBrowser } from '../../ui/content/artifacts'
type StartupControls = {
  temporary: boolean
  onNewThread: () => void
  onSelectRemote: NonNullable<ComponentProps<typeof Composer>['onSelectRemote']>
}
export function TaskDetail({
  task,
  onBack,
  questionId,
  nativeAgentKey,
  startup,
  parentNavigation,
}: {
  task: Task
  onBack: () => void
  questionId?: string
  nativeAgentKey?: string
  startup?: StartupControls
  parentNavigation?: ReactNode
}) {
  const { styles } = useTheme()

  const { profile, snapshot, connected, refresh, readCache } = useRuntime()
  const { focused } = useNavigation()
  const [locallyCreated] = useState(() => !!startup?.temporary)
  useEffect(() => {
    if (profile && focused && !startup?.temporary)
      return watchRuntimeTask(profile.connection, task.id)
  }, [profile?.connection, task.id, focused, startup?.temporary])
  // A locally created thread already has its complete empty transcript. Keep its mounted
  // conversation while the runtime starts publishing detailed snapshots.
  const loaded =
    locallyCreated || !snapshot?.detailTaskIds || snapshot.detailTaskIds.includes(task.id)
  const [cacheError, setCacheError] = useState<{
    cache: typeof readCache
    id: string
    error: string
  } | null>(null)
  const [cached, setCached] = useState<{ cache: typeof readCache; task: Task } | null>(null)
  const revision = task.historyRevision ?? 0
  const replica = readCache ? cachedRuntimeThread(readCache, task.id) : undefined
  const retained = replica && (replica.historyRevision ?? 0) === revision ? replica : undefined
  useEffect(() => {
    if (loaded || !readCache || retained) return
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
  }, [loaded, readCache, task.id, revision, retained])
  const available =
    !readCache?.closed &&
    cached?.cache === readCache &&
    cached?.task.id === task.id &&
    (cached.task.historyRevision ?? 0) === revision
  const history = retained ?? (available ? cached?.task : undefined)
  if (!loaded && !history)
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title={task.title} onBack={onBack} />
        {parentNavigation}
        <View style={{ flex: 1, justifyContent: 'center', gap: 12, padding: 20 }}>
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
      </View>
    )
  return (
    <TaskDetailContent
      task={!loaded && history ? cachedThread(task, history) : task}
      onBack={onBack}
      questionId={questionId}
      nativeAgentKey={nativeAgentKey}
      startup={startup}
      parentNavigation={parentNavigation}
    />
  )
}
const threadDrafts = createDetailDrafts<{
  sideChat: Record<string, string>
  file: FileEditDraft | null
  browsedFile: ThreadFileDraft | null
}>()
function TaskDetailContent({
  task,
  onBack,
  questionId,
  nativeAgentKey,
  startup,
  parentNavigation,
}: {
  task: Task
  onBack: () => void
  questionId?: string
  nativeAgentKey?: string
  startup?: StartupControls
  parentNavigation?: ReactNode
}) {
  const { colors, styles } = useTheme()

  const { focused, navigate } = useNavigation()
  const insets = useSafeAreaInsets()
  const { width } = useWindowDimensions()
  const panes = useTaskPanes()
  const { snapshot, connected, profiles, profile, callEffect, activeId, connection } = useRuntime()
  const worktreeThread = useAction()
  const [transferring, setTransferring] = useState(false)
  const account = useOptionalMobileAccount()
  const canShare = !!account?.directory && !account.deletionPending
  const [sharingTaskId, setSharingTaskId] = useState<string>()
  const worktreeActions: HeaderAction[] =
    task.execution === 'worktree' && (task.checkoutBranch || task.existingWorktreePath)
      ? (['reuse', 'fork'] as const).map((mode) => ({
          label: mode === 'reuse' ? 'New thread in this worktree' : 'Fork worktree',
          icon: mode === 'reuse' ? 'chat' : 'changes',
          overflow: true,
          group: 'Advanced',
          disabled: !connected || worktreeThread.busy || task.status === 'running',
          onPress: () =>
            worktreeThread.act(() =>
              callEffect(
                '/api/tasks/worktree-thread',
                { id: task.id, mode },
                mutableStruct({ id: Schema.String }),
              ).pipe(
                Effect.tap((result) =>
                  Effect.sync(() => navigate('tasks', result.id, activeId ?? undefined)),
                ),
              ),
            ),
        }))
      : []
  useEffect(() => {
    if (worktreeThread.error) Alert.alert('Could not create thread', worktreeThread.error)
  }, [worktreeThread.error])
  const resume = useAction()
  const preparation = taskPreparation(task)
  const budget = taskBudgetUsage(task)
  const quota = useAction()
  const retry = useAction()
  const { draft: detailDraft, setField: setDraftField } = useDetailDraft(
    threadDrafts,
    detailDraftKey(connection, 'thread', activeId, task.id),
    () => ({ sideChat: {}, file: null, browsedFile: null }),
  )
  const [asking, setAsking] = useApplicationState(false)
  const [selectedSideChat, setSelectedSideChat] = useState<string>()
  const [editingInstructions, setEditingInstructions] = useApplicationState(false)
  const [editingApprovalRules, setEditingApprovalRules] = useApplicationState(false)
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
        group: 'Project',
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
  const copyConversation = useAction()
  const copyOperation = useRef<AbortController | null>(null)
  useLayoutEffect(() => {
    if (!focused) copyOperation.current?.abort()
    return () => copyOperation.current?.abort()
  }, [
    focused,
    profile?.connection.address,
    profile?.connection.token,
    task.id,
    task.historyRevision,
  ])
  useEffect(() => {
    if (copyConversation.error) Alert.alert('Could not copy conversation', copyConversation.error)
  }, [copyConversation.error])
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
          group: 'Navigate',
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
          group: 'Tools',
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
          group: 'Thread',
          icon: 'copy',
          overflow: true,
          disabled: copyConversation.busy || (!!task.historyBefore && !connected),
          onPress: () =>
            copyConversation.act(async () => {
              if (!focused || copyOperation.current) return
              const operation = new AbortController()
              copyOperation.current = operation
              try {
                const transcript = await readConversationHistory(
                  task,
                  (before, signal) => {
                    if (!profile || !connected)
                      throw new Error('Reconnect to copy the full conversation.')
                    return createRuntimeClient(profile.connection).request(
                      '/api/tasks/history',
                      { id: task.id, before },
                      conversationPageSchema,
                      { method: 'POST', signal },
                    )
                  },
                  operation.signal,
                )
                if (operation.signal.aborted) return
                const result = await copyText(taskTranscript(transcript))
                if (result === 'copied') AccessibilityInfo.announceForAccessibility('Copied')
              } catch (cause) {
                if (!operation.signal.aborted) throw cause
              } finally {
                if (copyOperation.current === operation) copyOperation.current = null
              }
            }),
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
            group: 'Advanced',
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
  const repository = snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)
  const displayProject = taskDisplayProject(task, snapshot?.workspace.repositories ?? [])
  const hasProject = !!displayProject && displayProject.kind !== 'scratch'
  const moveActions: HeaderAction[] =
    !snapshot?.workspace.repositories.find((repo) => repo.id === task.repositoryId)?.kind &&
    !canChangeTaskCheckout(task) &&
    !task.pullRequest &&
    !task.workItem
      ? [
          {
            group: 'Advanced',
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
  const transferActions: HeaderAction[] =
    repository && repository.kind !== 'scratch'
      ? [
          {
            label: inWorktree
              ? 'Copy worktree to another machine'
              : 'Copy project checkout to another machine',
            group: 'Project',
            icon: 'copy',
            overflow: true,
            disabled: !connected,
            onPress: () => {
              Keyboard.dismiss()
              setTransferring(true)
            },
          },
        ]
      : []
  const branchActions: HeaderAction[] = branch
    ? [
        {
          label: 'Copy branch name',
          group: 'Project',
          icon: 'copy',
          overflow: true,
          onPress: () => copied(branch),
        },
      ]
    : []
  const needsInput =
    snapshot?.questions.some((q) => q.taskId === task.id) ||
    snapshot?.approvals.some((a) => a.taskId === task.id)
  const latestTurn = task.turns?.at(-1)
  const runtimeHost = runtimeComputerName({
    profile,
    snapshot: { runtimeHost: latestTurn?.runtimeHost ?? snapshot?.runtimeHost },
  })
  // Name the computer only when there is more than one to tell apart.
  const subtitle = [
    projectDisplayName(displayProject, ''),
    profiles.length > 1 ? runtimeHost : undefined,
  ]
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
  const [reviewLine, setReviewLine] = useApplicationState<number | undefined>(undefined)
  const [reviewTab, setReviewTab] = useApplicationState<'diff' | 'findings'>('diff')
  const [terminalId, setTerminalId] = useApplicationState('')
  const [nativeThread, setNativeThread] = useState<{
    parentKey: string
    taskId: string
    agent: Subagent
  }>()
  const openedNativeRoute = useRef('')
  useEffect(() => {
    const route = JSON.stringify([activeId, task.id, nativeAgentKey])
    if (!nativeAgentKey || openedNativeRoute.current === route) return
    const agent = task.subagents?.find(
      (agent) =>
        agent.source !== 'dovo' &&
        (nativeThreadKey(task.id, agent) === nativeAgentKey ||
          nativeFailureKey(task.id, agent) === nativeAgentKey),
    )
    if (!agent) return
    openedNativeRoute.current = route
    setNativeThread({ parentKey: JSON.stringify([activeId, task.id]), taskId: task.id, agent })
  }, [activeId, task.id, task.subagents, nativeAgentKey])
  const native =
    nativeThread?.parentKey === JSON.stringify([activeId, task.id]) ? nativeThread : undefined
  const nativeAgent =
    native &&
    (snapshot?.workspace.tasks
      .find((item) => item.id === native.taskId)
      ?.subagents?.find(
        (agent) =>
          agent.id === native.agent.id &&
          agent.provider === native.agent.provider &&
          agent.sessionId === native.agent.sessionId,
      ) ??
      native.agent)
  const car = useCarMode()
  const [pane, setPane] = useApplicationState<
    'chat' | 'diff' | 'files' | 'terminal' | 'browser' | 'devices' | 'agents'
  >('chat')
  // Keep Git controls reachable after committing, including push-only retries.
  const hasDiff =
    !!detailDraft.file ||
    (!!repository && !repository.kind) ||
    !!task.pullStatus ||
    !!task.linkedPullRequests?.length ||
    task.files.length > 0 ||
    !!task.linkedCheckouts?.length ||
    task.historyTotals?.hasChanges ||
    (task.turns ?? []).some((turn) => !!turn.checkpoint && checkpointFileCount(turn.checkpoint) > 0)
  useEffect(() => {
    if (pane === 'diff' && !hasDiff) setPane('chat')
  }, [pane, hasDiff])
  const [expandedPreview, setExpandedPreview] = useApplicationState(false)
  const [serverLink, setServerLink] = useState<{
    runtimeId: string | null
    taskId: string
    id: string
    url: string
  } | null>(null)
  const backToChat = () => {
    Keyboard.dismiss()
    setExpandedPreview(false)
    setPane('chat')
  }
  useEffect(() => {
    if (Platform.OS !== 'android' || !focused || native || pane !== 'diff') return
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      setPane('chat')
      return true
    })
    return () => back.remove()
  }, [focused, native, pane])
  const [linkingProjects, setLinkingProjects] = useApplicationState(false)
  const [renaming, setRenaming] = useApplicationState(false)
  const [artifactsOpen, setArtifactsOpen] = useState(false)
  const [projectInfo, setProjectInfo] = useState(false)
  // Navigation keeps screens mounted; project information belongs only to this view.
  useEffect(() => {
    setProjectInfo(false)
  }, [focused, activeId, task.id, pane, native?.parentKey])
  const [linkedPulls, setLinkedPulls] = useState(false)
  const [linkedPullUrl, setLinkedPullUrl] = useState<string | undefined>(undefined)
  const [threadBehavior, setThreadBehavior] = useState(false)
  const pulls = taskPullLinks(task)
  const lifecycle = useTaskLifecycle(task, undefined, onBack)
  const newSession = useAction()
  useEffect(() => {
    const error = lifecycle.error || newSession.error
    if (error) Alert.alert('Could not update thread', error)
  }, [lifecycle.error, newSession.error])
  const viewed = useTaskViewed(task, !native && pane === 'chat' && !linkingProjects && !renaming)
  return (
    <View
      style={[
        styles.screen,
        (pane === 'browser' || pane === 'devices') &&
          expandedPreview && {
            paddingTop: insets.top,
          },
      ]}
    >
      {native && nativeAgent && (
        <NativeAgentThread
          key={`${native.parentKey}:${native.taskId}:${nativeAgent.provider}:${nativeAgent.sessionId}:${nativeAgent.id}`}
          taskId={native.taskId}
          agent={nativeAgent}
          parentTitle={task.title}
          onClose={() => setNativeThread(undefined)}
        />
      )}
      <ScreenHeader
        title={task.title}
        titleMenu={!startup?.temporary}
        titleContent={
          startup?.temporary ? undefined : (
            <View
              accessibilityLabel={[task.title, subtitle, status].join('. ')}
              style={{
                minHeight: 44,
                justifyContent: 'center',
                width: Math.max(
                  80,
                  Math.min(
                    420,
                    (panes.expanded ? panes.detailWidth : width) - 180 - (hasProject ? 44 : 0),
                  ),
                ),
                minWidth: 0,
              }}
            >
              <Text
                numberOfLines={1}
                style={{ color: colors.text, fontSize: 16, fontWeight: '600' }}
              >
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
            </View>
          )
        }
        hidden={!!native || ((pane === 'browser' || pane === 'devices') && expandedPreview)}
        gestureEnabled={pane !== 'browser' && pane !== 'devices' && pane !== 'diff'}
        onBack={
          pane === 'diff'
            ? backToChat
            : pane === 'browser' || pane === 'devices'
              ? onBack
              : undefined
        }
        leading={<Action secondary label="Back" onPress={pane === 'diff' ? backToChat : onBack} />}
        collapsedMenuGroups={['Project', 'Advanced']}
        buttons={
          startup?.temporary
            ? [{ label: 'New thread', icon: 'add', onPress: startup.onNewThread }]
            : (
                [
                  'chat',
                  ...(hasDiff ? ['diff' as const] : []),
                  'files',
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
                        ? pane === 'diff'
                          ? 'Back to chat'
                          : `Changes (${task.files.length})`
                        : tab === 'files'
                          ? 'Files'
                          : tab === 'terminal'
                            ? 'Terminal'
                            : tab === 'agents'
                              ? 'Agents'
                              : tab === 'devices'
                                ? 'Devices'
                                : 'Browser',
                  icon:
                    tab === 'diff'
                      ? pane === 'diff'
                        ? 'chat'
                        : 'changes'
                      : tab === 'files'
                        ? 'folder'
                        : tab === 'browser'
                          ? 'web'
                          : tab === 'devices'
                            ? 'device'
                            : tab,
                  group: tab === 'agents' || tab === 'devices' ? 'Tools' : 'Navigate',
                  selected: pane === tab,
                  // Keep changes and project information beside the menu; car mode uses the menu.
                  overflow: car || tab !== 'diff',
                  onPress: () => {
                    Keyboard.dismiss()
                    setCheckpoint('')
                    setExpandedPreview(false)
                    if (tab === 'terminal') setTerminalId('')
                    setPane(tab === 'diff' && pane === 'diff' ? 'chat' : tab)
                  },
                }))
                .concat(
                  [
                    {
                      label: 'Project information',
                      group: 'Project',
                      icon: 'info',
                      overflow: car || !hasProject,
                      selected: projectInfo,
                      onPress: () => {
                        Keyboard.dismiss()
                        setProjectInfo(!projectInfo)
                      },
                    },
                    ...(pulls.length
                      ? [
                          {
                            label: 'Linked PRs',
                            group: 'Project',
                            icon: 'pulls' as const,
                            overflow: true,
                            onPress: () => {
                              Keyboard.dismiss()
                              setLinkedPulls(true)
                            },
                          },
                        ]
                      : []),
                    ...(snapshot?.artifactsEnabled
                      ? [
                          {
                            label: 'Artifacts',
                            group: 'Tools',
                            icon: 'artifact' as const,
                            overflow: true,
                            onPress: () => setArtifactsOpen(true),
                          },
                        ]
                      : []),
                    {
                      label: 'Linked projects',
                      group: 'Project',
                      icon: 'projects',
                      overflow: true,
                      onPress: () => {
                        Keyboard.dismiss()
                        setLinkingProjects(true)
                      },
                    },
                    {
                      label: 'Rename thread',
                      group: 'Thread',
                      icon: 'edit',
                      overflow: true,
                      disabled: !connected,
                      onPress: () => setRenaming(true),
                    },
                    {
                      label: task.pinned ? 'Unpin thread' : 'Pin thread',
                      group: 'Thread',
                      icon: task.pinned ? 'unpin' : 'pin',
                      overflow: true,
                      disabled: !lifecycle.enabled || lifecycle.busy,
                      onPress: lifecycle.togglePinned,
                    },
                    ...(!task.example && canShare
                      ? [
                          {
                            label: 'Share thread',
                            group: 'Thread',
                            icon: 'share' as const,
                            overflow: true,
                            onPress: () => {
                              Keyboard.dismiss()
                              setSharingTaskId(task.id)
                            },
                          },
                        ]
                      : []),
                    {
                      label: 'Regenerate title',
                      group: 'Advanced',
                      icon: 'refresh',
                      overflow: true,
                      disabled: !connected || newSession.busy || task.status === 'running',
                      onPress: () =>
                        newSession.act(() =>
                          callEffect(
                            '/api/tasks/title',
                            { taskId: task.id },
                            generatedTitleSchema,
                          ).pipe(
                            Effect.flatMap((generated) =>
                              callEffect(
                                '/api/workspace',
                                {
                                  collection: 'tasks',
                                  id: task.id,
                                  changes: {
                                    title: { before: task.title, after: generated.title },
                                  },
                                },
                                workspacePatchResultSchema,
                                'PATCH',
                              ),
                            ),
                          ),
                        ),
                    },
                    {
                      label: task.archived ? 'Reopen thread' : 'Settle thread',
                      group: 'Thread',
                      icon: 'check',
                      overflow: true,
                      disabled: !lifecycle.enabled || lifecycle.busy || task.status === 'running',
                      onPress: lifecycle.toggleSettled,
                    },
                    {
                      label: lifecycle.unread ? 'Mark as read' : 'Mark as unread',
                      group: 'Thread',
                      icon: lifecycle.unread ? 'read' : 'unread',
                      overflow: true,
                      disabled: !lifecycle.readStateEnabled || lifecycle.busy,
                      onPress: lifecycle.toggleRead,
                    },
                    {
                      label: task.snoozedUntil ? 'Unsnooze thread' : 'Snooze thread',
                      group: 'Thread',
                      icon: 'snooze',
                      overflow: true,
                      disabled: !lifecycle.enabled || lifecycle.busy || !!task.archivedAt,
                      onPress: () =>
                        task.snoozedUntil
                          ? lifecycle.snooze(null)
                          : chooseSnoozeDuration('Snooze thread', (hours) =>
                              lifecycle.snooze(
                                new Date(Date.now() + hours * 3600000).toISOString(),
                              ),
                            ),
                    },
                    {
                      label: 'Auto-settle & auto-archive',
                      group: 'Advanced',
                      icon: 'archive',
                      overflow: true,
                      disabled: !connected,
                      onPress: () => setThreadBehavior(true),
                    },
                    {
                      label: task.archivedAt ? 'Restore thread' : 'Archive thread',
                      group: 'Thread',
                      icon: 'archive',
                      overflow: true,
                      disabled: !lifecycle.enabled || lifecycle.busy || task.status === 'running',
                      onPress: lifecycle.toggleArchived,
                    },
                    {
                      label: 'Delete thread…',
                      group: 'Delete',
                      destructive: true,
                      icon: 'trash',
                      overflow: true,
                      disabled: !lifecycle.enabled || lifecycle.busy || task.status === 'running',
                      onPress: lifecycle.deleteThread,
                    },
                    ...(task.sessionId
                      ? [
                          {
                            label: 'Start fresh agent session',
                            group: 'Advanced',
                            icon: 'newChat' as const,
                            overflow: true,
                            disabled: !connected || newSession.busy || task.status === 'running',
                            onPress: () =>
                              newSession.act(() =>
                                callEffect('/api/tasks/new-session', { id: task.id }, responses.ok),
                              ),
                          },
                        ]
                      : []),
                    {
                      label: 'Edit project instructions',
                      group: 'Advanced',
                      icon: 'settings',
                      overflow: true,
                      onPress: () => setEditingInstructions(true),
                    },
                    {
                      label: 'Project approval rules',
                      group: 'Advanced',
                      icon: 'settings',
                      overflow: true,
                      disabled: !task.repositoryId,
                      onPress: () => setEditingApprovalRules(true),
                    },
                  ] satisfies HeaderAction[],
                  projectActions,
                  conversationActions,
                  compactActions,
                  branchActions,
                  worktreeActions,
                  moveActions,
                  transferActions,
                )
                .sort((a, b) => {
                  const order = ['Tools', 'Navigate', 'Thread', 'Project', 'Advanced', 'Delete']
                  return order.indexOf(a.group ?? '') - order.indexOf(b.group ?? '')
                })
        }
      />
      {!native && !expandedPreview && parentNavigation}
      {projectInfo && !native && !car && (
        <TaskProjectSheet
          key={`${activeId}:${task.id}`}
          inline
          task={task}
          scripts={projectActions}
          onBrowser={(url) => {
            setServerLink({ runtimeId: activeId, taskId: task.id, id: randomUUID(), url })
            setProjectInfo(false)
            setPane('browser')
          }}
          branchActions={[...branchActions, ...worktreeActions, ...moveActions, ...transferActions]}
          onClose={() => setProjectInfo(false)}
          onProjects={() => {
            setProjectInfo(false)
            setLinkingProjects(true)
          }}
          onAgents={() => {
            setPane('agents')
          }}
          onChanges={() => {
            setPane('diff')
          }}
          onPulls={(url) => {
            setLinkedPullUrl(url)
            setLinkedPulls(true)
          }}
        />
      )}
      {/* Offline and reconnect state lives in the floating pill above the composer. */}
      {viewed.error && !native && (
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
      <View style={{ flex: 1, display: native ? 'none' : 'flex' }}>
        <ConversationProvider
          key={task.id}
          task={task}
          temporary={startup?.temporary}
          visible={
            focused &&
            !native &&
            pane === 'chat' &&
            !linkingProjects &&
            !renaming &&
            !asking &&
            !transferring &&
            !sharingTaskId &&
            !artifactsOpen &&
            !linkedPulls &&
            !threadBehavior &&
            !editingInstructions &&
            !editingApprovalRules
          }
          openTerminal={(id) => {
            setTerminalId(id)
            setPane('terminal')
          }}
          openCheckpoint={(id, path) => {
            setReviewLine(undefined)
            setReviewTab('diff')
            setCheckpointPath(path ?? '')
            setCheckpoint(id)
            setPane('diff')
          }}
        >
          {!startup?.temporary && canShare && sharingTaskId === task.id && (
            <ThreadSharing onClose={() => setSharingTaskId(undefined)} />
          )}
          <View
            style={{
              ...contentColumn.conversation,
              flex: 1,
              display: pane === 'chat' ? 'flex' : 'none',
            }}
          >
            <Composer
              queuedMessages={<ComposerActivity task={task} />}
              renderAbove={(setup, starters, startModes) => (
                <Conversation setup={setup} starters={starters} startModes={startModes}>
                  {preparation ? (
                    <PreparationProgress
                      preparation={preparation}
                      onRetry={
                        connected
                          ? () =>
                              retry.act(() =>
                                callEffect('/api/tasks/run', { id: task.id }, responses.ok),
                              )
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
                  {task.quotaContinuation && (
                    <View style={{ padding: 12, gap: 8 }}>
                      <Text style={styles.muted}>
                        {task.quotaContinuation.resume ? 'Scheduled to resume' : 'Snoozed'} at{' '}
                        {new Date(task.quotaContinuation.at).toLocaleString()}
                      </Text>
                      <Action
                        secondary
                        label="Cancel quota continuation"
                        disabled={!connected || quota.busy}
                        onPress={() =>
                          quota.act(() =>
                            callEffect('/api/tasks/quota/cancel', { id: task.id }, responses.ok),
                          )
                        }
                      />
                      {quota.error && <Text style={{ color: colors.error }}>{quota.error}</Text>}
                    </View>
                  )}
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
                          label={
                            task.runPhase === 'finalizing' ? 'Retry saving changes' : 'Resume task'
                          }
                          disabled={!connected || resume.busy}
                          onPress={() =>
                            resume.act(() =>
                              callEffect('/api/tasks/run', { id: task.id }, responses.ok),
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
                  <CodeReviewCard
                    task={task}
                    onOpen={(finding) => {
                      setCheckpoint('')
                      setCheckpointPath(finding?.path ?? '')
                      setReviewLine(finding?.line)
                      setReviewTab(finding ? 'diff' : 'findings')
                      setPane('diff')
                    }}
                  />
                  <ReviewFindings task={task} onOpen={() => setPane('diff')} />
                  <ReviewComments task={task} />
                  {!startup?.temporary && <InlineThreadSuggestions />}
                </Conversation>
              )}
              key={task.id}
              task={task}
              onSelectRemote={startup?.temporary ? startup.onSelectRemote : undefined}
              onAsk={(chatId) => {
                if (chatId) setSelectedSideChat(chatId)
                Keyboard.dismiss()
                setAsking(true)
              }}
            />
          </View>
          {pane === 'files' && (
            <TaskFiles
              key={`${activeId}:${task.id}`}
              task={task}
              draft={detailDraft.browsedFile}
              onDraftChange={(draft) => setDraftField('browsedFile', draft)}
            />
          )}
          {pane === 'agents' && (
            <TaskAgents
              key={task.id}
              task={task}
              onOpenThread={(thread) => {
                Keyboard.dismiss()
                setNativeThread({ ...thread, parentKey: JSON.stringify([activeId, task.id]) })
              }}
            />
          )}
          {asking && (
            <SideQuestion
              task={task}
              selectedChatId={selectedSideChat}
              drafts={detailDraft.sideChat}
              setDrafts={(update) =>
                setDraftField(
                  'sideChat',
                  typeof update === 'function' ? update(detailDraft.sideChat) : update,
                )
              }
              onClose={() => setAsking(false)}
            />
          )}
          {pane === 'browser' && (
            <BrowserPane
              taskId={task.id}
              openLink={
                serverLink?.taskId === task.id && serverLink.runtimeId === activeId
                  ? serverLink
                  : undefined
              }
              onLinkOpened={() => setServerLink(null)}
              expanded={expandedPreview}
              onExpand={setExpandedPreview}
            />
          )}
          {pane === 'devices' && (
            <DevicesPane
              taskId={task.id}
              expanded={expandedPreview}
              onExpand={setExpandedPreview}
            />
          )}
          {pane === 'diff' && (
            <TaskReview
              initialCheckpoint={checkpoint}
              initialPath={checkpointPath}
              initialLine={!checkpoint ? reviewLine : undefined}
              initialTab={!checkpoint ? reviewTab : 'diff'}
              edit={detailDraft.file}
              onEditChange={(draft) => setDraftField('file', draft)}
            />
          )}
          {pane === 'terminal' && (
            <TerminalPane task={task} selected={terminalId} onSelect={setTerminalId} />
          )}
        </ConversationProvider>
      </View>
      {transferring && repository && (
        <ProjectTransferDialog
          repository={repository}
          sourceTask={task}
          onClose={() => setTransferring(false)}
        />
      )}
      {artifactsOpen && snapshot?.artifactsEnabled && (
        <ArtifactBrowser
          key={`${activeId}:${task.id}`}
          taskId={task.id}
          onClose={() => setArtifactsOpen(false)}
        />
      )}
      {linkedPulls && (
        <TaskLinkedPullSheet
          key={`${activeId}:${task.id}`}
          task={task}
          initialUrl={linkedPullUrl}
          onClose={() => {
            setLinkedPulls(false)
            setLinkedPullUrl(undefined)
          }}
        />
      )}
      {threadBehavior && (
        <TaskThreadBehavior
          key={`${activeId}:${task.id}`}
          task={task}
          onClose={() => setThreadBehavior(false)}
        />
      )}
      {linkingProjects && (
        <Sheet title="Linked projects" onClose={() => setLinkingProjects(false)}>
          <LinkedProjects key={task.id} task={task} />
        </Sheet>
      )}
      {renaming && <RenameThread task={task} onClose={() => setRenaming(false)} />}
      {editingInstructions && task.repositoryId && (
        <ProjectInstructions
          repositoryId={task.repositoryId}
          onClose={() => setEditingInstructions(false)}
        />
      )}
      {editingApprovalRules && task.repositoryId && (
        <ProjectApprovalRules
          repositoryId={task.repositoryId}
          onClose={() => setEditingApprovalRules(false)}
        />
      )}
    </View>
  )
}
