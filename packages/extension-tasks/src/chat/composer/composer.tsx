import { createPortal } from 'react-dom'
import { ThreadContextPicker } from './thread-context-picker'
import { DraftStash } from './draft-stash'
import { draftStashScope } from '@dovo/protocol'
import { QueueEditContext } from './queue-edit'
import { useThreadInfoContext } from '../../detail/thread-info-context'
import { useChatImageUploader } from './chat-image-edit-context'
import { createComposerDraft } from './composer-draft'
import { TurnModelControls } from './turn-model-controls'
import {
  sameTurnSettings,
  applyTurnSettings,
  queuedModelAgent,
  planModeIssue,
  type TurnSettings,
  type Attachment,
} from '@dovo/protocol'
import { ComposerDictation } from './composer-dictation'
import { permissionPolicyUIIssue } from '@dovo/studio-ui'
import { randomUUID, checkpointUndoTurn, taskForkResultSchema, taskSchema } from '@dovo/protocol'
import { projectPrompts } from '@dovo/protocol'
import { pendingMessageDestination, type PendingMessage } from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  generatedTitleSchema,
  readAppPreferences,
  resolveTaskAgent,
  useAppPreferences,
} from '@dovo/studio-core'
import { AttachmentPicker } from './attachment-picker'
import { MessageAttachments } from './message-attachments'
import { useAttachments } from './use-attachments'
import { useEffect, useLayoutEffect, useRef, useState, useMemo, type ReactNode } from 'react'
import { Schema } from 'effect'
import { mutableStruct } from '@dovo/protocol'
import { useCommittedCallback } from '../../detail/use-committed-callback'
import { useComposerDraft } from './use-composer-draft'
import { ComposerCommandDialog } from './composer-command-dialog'
import type { ComposerCommandId } from './file-mentions'
import { ComposerEditor } from './composer-editor'
import { SavedPromptsDialog } from '../../dialogs/saved-prompts-dialog'
import { REVIEW_PROMPT, contextMeter, taskResources } from '@dovo/protocol'
import { ContextMeter } from '../thread/context-meter'
import {
  ArrowUp,
  LoaderCircle,
  ListPlus,
  Square,
  CornerUpRight,
  Minimize2,
  GitBranchPlus,
  ChevronDown,
  Info,
  ListChecks,
} from 'lucide-react'
import { useWorkspace, useStudioHost, updateTask, responses, type Task } from '@dovo/studio-core'
import {
  Button,
  IconButton,
  ComposerSurface,
  ComposerSubmit,
  DropdownMenu,
  Popover,
  cn,
  type ComposerControlSlots,
} from '@dovo/studio-ui'
import { ComposerHarnessControls } from './composer-harness-controls'
import { ComposerWorkspace, type WorkspaceControls } from './composer-workspace'
import type { SelectRemoteProject } from './composer-project'
export function Composer({
  task,
  collapsed = false,
  onPending,
  onAside,
  composerInsert,
  onComposerInsertApplied,
  workspaceControls,
  workspaceMoving = false,
  onWorkspaceMoving,
  onSelectRemote,
  queuedMessages,
  temporary = false,
  startup = false,
  onStartBackground,
}: {
  task: Task
  temporary?: boolean
  startup?: boolean
  onStartBackground?: (task: Task) => void
  workspaceControls?: WorkspaceControls
  workspaceMoving?: boolean
  onWorkspaceMoving?: (moving: boolean) => void
  onSelectRemote?: SelectRemoteProject
  queuedMessages?: ReactNode
  collapsed?: boolean
  onPending: (pending: PendingMessage | null) => void
  /** Opens side chats, selecting a newly sent question when provided. */
  onAside?: (chatId?: string) => void
  composerInsert?: { id: string; text: string } | null
  onComposerInsertApplied?: () => void
}) {
  const {
    workspace,
    setWorkspace,
    request,
    connected,
    connection,
    flush,
    snapshot,
    activeRuntimeId,
  } = useWorkspace()
  const stashRuntimeId = activeRuntimeId ?? connection?.address
  const [draftTurnSettings, setDraftTurnSettings] = useApplicationState<TurnSettings | null>(
    task.draftTurnSettings ?? null,
  )
  useEffect(() => {
    setDraftTurnSettings(task.draftTurnSettings ?? null)
  }, [task.draftTurnSettings, setDraftTurnSettings])
  const [draftPlan, setDraftPlan] = useApplicationState(task.draftPlan === true)
  useEffect(() => {
    setDraftPlan(task.draftPlan === true)
  }, [task.draftPlan, setDraftPlan])
  const [editing, setEditing] = useState<{
    message: Task['messages'][number]
    controller: ReturnType<typeof createComposerDraft>
    settings: TurnSettings | null
    files: Attachment[]
    plan: boolean
  } | null>(null)
  const turnSettings = editing ? editing.settings : draftTurnSettings
  // One-message plan mode: kept with the draft until a plan send is accepted.
  const plan = editing ? editing.plan : draftPlan
  const planSupported = snapshot?.planModeSupported === true
  const changePlan = (value: boolean) => {
    if (editing) {
      setEditing({ ...editing, plan: value })
      return
    }
    setDraftPlan(value)
    setWorkspace((w) => updateTask(w, task.id, (current) => ({ ...current, draftPlan: value })))
  }
  const setTurnSettings = setDraftTurnSettings
  const changeTurnSettings = (value: TurnSettings | null) => {
    if (editing) {
      setEditing({ ...editing, settings: value })
      return
    }
    setTurnSettings(value)
    setWorkspace((w) =>
      updateTask(w, task.id, (current) => ({ ...current, draftTurnSettings: value })),
    )
  }
  const [error, setError] = useApplicationState(''),
    [submitBusy, setSending] = useApplicationState(false),
    [stopping, setStopping] = useApplicationState(false)
  const [localMachineMoving, setLocalMachineMoving] = useApplicationState(false)
  const setMachineMoving = (moving: boolean) => {
    setLocalMachineMoving(moving)
    onWorkspaceMoving?.(moving)
  }
  const machineMoving = workspaceMoving || localMachineMoving
  const [asideCreating, setAsideCreating] = useState(false)
  const [asideBusy, setAsideBusy] = useState(false)
  const [editorFocused, setEditorFocused] = useState(false)
  const asideRequest = useRef<'saving' | 'asking' | null>(null)
  const [dictating, setDictating] = useState(false)
  const sendingRequest = useRef(false)
  const [fileDrag, setFileDrag] = useState(false)
  const attachments = useAttachments(
    task,
    editing && snapshot?.fullTurnSettingsSupported
      ? {
          messageId: editing.message.id,
          files: editing.files,
          uploaded: (file, replaceId) =>
            setEditing((current) =>
              current?.message.id === editing.message.id
                ? {
                    ...current,
                    files: [...current.files.filter((item) => item.id !== replaceId), file],
                  }
                : current,
            ),
          remove: (id) =>
            setEditing((current) =>
              current
                ? { ...current, files: current.files.filter((item) => item.id !== id) }
                : current,
            ),
        }
      : undefined,
  )
  const editingChatImage = useChatImageUploader(
    (file) => attachments.upload([file], undefined, true),
    connected &&
      !task.archivedAt &&
      !task.example &&
      !submitBusy &&
      !attachments.busy &&
      (!editing || !!snapshot?.fullTurnSettingsSupported),
  )
  const sending = submitBusy || machineMoving || asideCreating || dictating || editingChatImage
  const composerDraft = useComposerDraft(task, temporary, editing?.controller)
  const askAside = useCommittedCallback(async () => {
    if (
      !onAside ||
      !!editing ||
      !connected ||
      sendingRequest.current ||
      asideRequest.current ||
      sending ||
      task.archived ||
      task.archivedAt
    )
      return
    const text = composerDraft.controller.text
    const draftRevision = composerDraft.controller.revision
    if (!text.trim()) {
      onAside()
      return
    }
    if (text.length > 4000) {
      setError('Side questions can contain up to 4,000 characters.')
      return
    }
    asideRequest.current = 'saving'
    setAsideBusy(true)
    setAsideCreating(true)
    setError('')
    try {
      // Persist the question before consuming the main draft. A failed ask stays retryable here.
      const chat = await request(
        '/api/tasks/side-chat/save',
        { id: task.id, draft: text },
        mutableStruct({ id: Schema.String }),
      )
      composerDraft.accept(text, draftRevision)
      asideRequest.current = 'asking'
      setAsideCreating(false)
      onAside(chat.id)
      await request(
        '/api/tasks/side-chat/ask',
        { id: task.id, chatId: chat.id, question: text },
        mutableStruct({ answer: Schema.String }),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      asideRequest.current = null
      setAsideBusy(false)
      setAsideCreating(false)
    }
  })
  useEffect(() => {
    if (!onAside) return
    const handle = (event: Event) => {
      if (!(event instanceof CustomEvent) || event.detail !== task.id) return
      event.preventDefault()
      void askAside()
    }
    window.addEventListener('dovo:ask-side-question', handle)
    return () => window.removeEventListener('dovo:ask-side-question', handle)
  }, [task.id, onAside, askAside])
  const host = useStudioHost()
  const forkAttempt = useRef<{ id: string; text: string; attachmentIds: string[] } | null>(null)
  const setDraft = composerDraft.update
  const [submittedText, setSubmittedText] = useState<string | null>(null)
  const [composingDuringSend, setComposingDuringSend] = useState<{
    text: string
    revision: number
  } | null>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const [awaitingQueuedSubmission, setAwaitingQueuedSubmission] = useState<string | null>(null)
  const [stagingGap, setStagingGap] = useState<{
    ids: string[]
    status: Task['status']
    runId: string | undefined
  } | null>(null)
  const stageObserved =
    !!stagingGap &&
    (!!task.queuePaused ||
      [...task.messages, ...(task.queue ?? [])].some((message) =>
        stagingGap.ids.includes(message.id),
      ) ||
      (task.status === 'running' &&
        (stagingGap.status !== 'running' || task.activeRunId !== stagingGap.runId)))
  const stagingGapActive = !!stagingGap && !stageObserved
  useEffect(() => {
    if (stageObserved) setStagingGap(null)
  }, [stageObserved])
  const [failedSubmissionAttachments, setFailedSubmissionAttachments] = useState<string[]>([])
  const hasFailedSubmissionAttachments = attachments.files.some((file) =>
    failedSubmissionAttachments.includes(file.id),
  )
  const editorController = useMemo(() => {
    const controller = composerDraft.controller
    return {
      ...controller,
      get text() {
        return composingDuringSend &&
          controller.revision === composingDuringSend.revision &&
          controller.text.trim() === composingDuringSend.text
          ? ''
          : controller.text
      },
      get revision() {
        return controller.revision
      },
      update(value: string) {
        const result = controller.update(value)
        if (composingDuringSend) controller.flush()
        return result
      },
    }
  }, [composerDraft.controller, composingDuringSend])
  useLayoutEffect(() => {
    if (composingDuringSend) input.current?.focus()
  }, [composingDuringSend])
  useLayoutEffect(() => {
    if (editorFocused && document.activeElement !== input.current) setEditorFocused(false)
  })
  const appliedInsert = useRef<string | null>(null)
  useEffect(() => {
    if (!composerInsert || appliedInsert.current === composerInsert.id) return
    appliedInsert.current = composerInsert.id
    setDraft((current) => [current.trimEnd(), composerInsert.text].filter(Boolean).join('\n\n'))
    input.current?.focus()
    onComposerInsertApplied?.()
  }, [composerInsert, setDraft, onComposerInsertApplied])
  const [command, setCommand] = useState<'new-session' | 'undo' | null>(null)
  const [commandBusy, setCommandBusy] = useState(false)
  const [commandError, setCommandError] = useState('')
  const [compactBusy, setCompactBusy] = useState(false)
  const meter = contextMeter(task)
  const compactDisabled =
    !connected ||
    sending ||
    compactBusy ||
    task.status === 'running' ||
    !!task.archived ||
    !!task.archivedAt ||
    !task.sessionId ||
    !!task.queue?.length
  const compact = () => {
    if (compactBusy) return
    setCompactBusy(true)
    setError('')
    void request('/api/tasks/compact', { id: task.id }, responses.ok)
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setCompactBusy(false))
  }
  const undoable = checkpointUndoTurn(task.turns ?? [])
  const undoableId =
    (undoable?.checkpoint?.restorePending ? undoable.id : task.historyTotals?.pendingUndoTurnId) ??
    undoable?.id ??
    task.historyTotals?.undoableTurnId
  const runCommand = (id: ComposerCommandId) => {
    setCommandError('')
    if (id === 'review')
      void request(
        '/api/tasks/message',
        { id: task.id, messageId: randomUUID(), text: REVIEW_PROMPT, review: true },
        responses.ok,
      ).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))
    else if (id === 'compact') compact()
    else setCommand(id)
  }
  const confirmCommand = () => {
    if (!command || commandBusy) return
    setCommandBusy(true)
    setCommandError('')
    const work =
      command === 'new-session'
        ? request('/api/tasks/new-session', { id: task.id }, responses.ok)
        : undoableId
          ? request(
              '/api/tasks/turn/restore',
              { id: task.id, turnId: undoableId, direction: 'undo' },
              responses.ok,
            )
          : Promise.reject(new Error('There is no turn with file changes to undo.'))
    void work
      .then(() => setCommand(null))
      .catch((cause: unknown) =>
        setCommandError(cause instanceof Error ? cause.message : String(cause)),
      )
      .finally(() => setCommandBusy(false))
  }
  const resources = useMemo(
    () =>
      taskResources(
        turnSettings?.harness
          ? { ...task, agentId: '', agentOverrides: undefined, harness: turnSettings.harness }
          : task,
        workspace,
        snapshot?.defaults,
      ),
    [
      task.id,
      task.agentId,
      task.agentOverrides,
      task.harness,
      turnSettings,
      task.repositoryId,
      workspace.agents,
      workspace.repositories,
      snapshot?.defaults,
    ],
  )
  const [managingPrompts, setManagingPrompts] = useState(false)
  const pendingQuestion = !!snapshot?.questions.some(
    (question) => question.taskId === task.id && question.prompt.blocking !== false,
  )
  const hasInput = composerDraft.hasText || attachments.files.length > 0
  const attempt = useRef<{
    id: string
    text: string
    attachmentIds: string[]
    mode: 'queue' | 'steer' | 'stage'
    turnSettings?: TurnSettings
    plan?: boolean
    title?: string
    accepted?: boolean
    draftRevision: number
    runId?: string
    startupConfiguration?: Task
    preserveQueuePause?: boolean
  } | null>(null)
  const pendingSubmission = useRef<string | null>(null)
  const pendingDraftProtections = useRef(new Map<string, NonNullable<typeof attempt.current>>())
  const acceptDraft = composerDraft.accept
  useEffect(() => {
    const observedIds = new Set(
      [...task.messages, ...(task.queue ?? [])].map((message) => message.id),
    )
    const activeAttempt = attempt.current
    if (activeAttempt && observedIds.has(activeAttempt.id))
      pendingDraftProtections.current.set(activeAttempt.id, activeAttempt)
    for (const [id, submitted] of pendingDraftProtections.current) {
      if (!observedIds.has(id)) continue
      pendingDraftProtections.current.delete(id)
      const unchanged = composerDraft.controller.revision === submitted.draftRevision
      if (!submitted.accepted) {
        submitted.accepted = true
        acceptDraft(submitted.text, submitted.draftRevision)
        if (unchanged) {
          setTurnSettings((current) =>
            sameTurnSettings(current, submitted.turnSettings) ? null : current,
          )
          if (submitted.plan) setDraftPlan(false)
        }
      }
      if (!unchanged && composerDraft.controller.text.trim()) {
        const preserveSettings =
          !!submitted.turnSettings && sameTurnSettings(draftTurnSettings, submitted.turnSettings)
        const preservePlan = !!submitted.plan && draftPlan
        if (preserveSettings || preservePlan) {
          if (preserveSettings) setTurnSettings(submitted.turnSettings ?? null)
          if (preservePlan) setDraftPlan(true)
          setWorkspace((workspace) =>
            updateTask(workspace, task.id, (current) => ({
              ...current,
              ...(preserveSettings ? { draftTurnSettings: submitted.turnSettings } : {}),
              ...(preservePlan ? { draftPlan: true } : {}),
            })),
          )
        }
      }
    }
    const id = pendingSubmission.current
    if (!id || !observedIds.has(id)) return
    pendingSubmission.current = null
    setAwaitingQueuedSubmission(null)
    onPending(null)
  }, [task.messages, task.queue, acceptDraft, onPending])
  const firstMessage =
    !stagingGapActive && task.messages.length === 0 && !task.queue?.length && !task.turns?.length
  const threadAgent = resolveTaskAgent(task, workspace.agents)
  const agent =
    threadAgent && snapshot?.persistentTurnModelsSupported
      ? queuedModelAgent(threadAgent, task.queue, editing?.message.id)
      : threadAgent
  const policyIssue = agent
    ? permissionPolicyUIIssue(
        applyTurnSettings(agent, turnSettings ?? undefined),
        snapshot?.permissionPolicySupported === true,
      )
    : undefined
  const planIssue = !plan
    ? undefined
    : !planSupported
      ? 'Update the task computer to use plan mode.'
      : planModeIssue(agent)
  // Settings → General → Follow-ups while a task runs: what Enter does mid-turn.
  const preferences = useAppPreferences()
  const defaultSteerFirst =
    !editing &&
    preferences.followUp === 'steer' &&
    task.status === 'running' &&
    !turnSettings &&
    !plan
  const other = defaultSteerFirst ? 'queue' : 'steer'
  const [altPressed, setAltPressed] = useState(false)
  useEffect(() => {
    if (task.status !== 'running') {
      setAltPressed(false)
      return
    }
    const update = (event: KeyboardEvent) =>
      setAltPressed(event.altKey && !event.ctrlKey && !event.metaKey)
    const reset = () => setAltPressed(false)
    const visibility = () => {
      if (document.hidden) reset()
    }
    window.addEventListener('keydown', update, true)
    window.addEventListener('keyup', update, true)
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      window.removeEventListener('keydown', update, true)
      window.removeEventListener('keyup', update, true)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [task.status])
  const alternative = !editing && altPressed && task.status === 'running' && !turnSettings && !plan
  const retryAutomaticAddition =
    attempt.current?.preserveQueuePause === true &&
    attempt.current.text === composerDraft.controller.text.trim() &&
    sameTurnSettings(attempt.current.turnSettings, turnSettings) &&
    !!attempt.current.plan === plan &&
    JSON.stringify(attempt.current.attachmentIds) ===
      JSON.stringify(attachments.files.map((file) => file.id))
  const steerFirst =
    !retryAutomaticAddition && (alternative ? !defaultSteerFirst : defaultSteerFirst)
  const stageFirst =
    !retryAutomaticAddition &&
    snapshot?.promptQueueStagingSupported === true &&
    (stagingGapActive || (!!task.queue?.length && !!(task.queuePaused || task.queue[0]?.paused)))
  const hasBackgroundAction = !editing && startup && firstMessage && !!onStartBackground
  const submitShortcut = alternative ? 'Alt+Enter' : 'Enter'
  const stop = async () => {
    const runId = task.activeRunId
    // Settings → General → Confirm before stopping a running task.
    if (
      readAppPreferences().confirmStop &&
      !window.confirm(
        `Stop “${task.title}”? Queued messages stay paused until you continue or send a follow-up.`,
      )
    )
      return
    setStopping(true)
    setError('')
    try {
      await request(
        '/api/tasks/cancel',
        {
          id: task.id,
          runId,
        },
        responses.ok,
      )
    } catch (e) {
      setError(String(e))
    } finally {
      setStopping(false)
    }
  }
  const beginEdit = (message: Task['messages'][number]) => {
    if (sending || attachments.busy || editing) return
    composerDraft.flush()
    setError('')
    setEditing({
      message,
      controller: createComposerDraft(message.text, () => {}),
      settings: message.turnSettings ?? null,
      files: message.attachments ?? [],
      plan: message.plan === true,
    })
    requestAnimationFrame(() => input.current?.focus())
  }
  const saveEdit = async () => {
    if (
      !editing ||
      sendingRequest.current ||
      !connected ||
      attachments.busy ||
      task.archivedAt ||
      pendingQuestion ||
      (!editing.controller.text.trim() && !editing.files.length)
    )
      return
    if (editing.settings?.harness && !snapshot?.fullTurnSettingsSupported) {
      setError('Update the task computer to use all settings for this turn.')
      return
    }
    if (policyIssue || planIssue) {
      setError(policyIssue || planIssue || '')
      return
    }
    sendingRequest.current = true
    setSending(true)
    setError('')
    try {
      await request(
        '/api/tasks/queue',
        {
          id: task.id,
          action: 'edit',
          messageId: editing.message.id,
          text: editing.controller.text,
          expectedText: editing.message.text,
          ...(snapshot?.fullTurnSettingsSupported
            ? {
                attachmentIds: editing.files.map((file) => file.id),
                expectedAttachmentIds: editing.message.attachments?.map((file) => file.id) ?? [],
              }
            : {}),
          ...(snapshot?.queuedTurnSettingsSupported
            ? {
                turnSettings: editing.settings,
                expectedTurnSettings: editing.message.turnSettings ?? null,
              }
            : {}),
          ...(planSupported ? { plan: editing.plan, expectedPlan: !!editing.message.plan } : {}),
        },
        responses.ok,
      )
      setEditing(null)
    } catch (cause) {
      setError(String(cause))
    } finally {
      sendingRequest.current = false
      setSending(false)
    }
  }
  const send = async (mode: 'queue' | 'steer' | 'stage' = 'queue', background = false) => {
    if (editing) return saveEdit()
    if (mode === 'stage' && (!connected || snapshot?.promptQueueStagingSupported !== true)) return
    if (turnSettings && snapshot?.queuedTurnSettingsSupported !== true) {
      setError('Update the task computer to choose a model for this turn.')
      return
    }
    if (turnSettings?.harness && !snapshot?.fullTurnSettingsSupported) {
      setError('Update the task computer to use all settings for this turn.')
      return
    }
    if (turnSettings && mode === 'steer') {
      setError('Queue this message to use its model and reasoning settings.')
      return
    }
    if (plan && mode === 'steer') {
      setError('Queue this message to plan before the agent changes anything.')
      return
    }
    if (policyIssue || planIssue) {
      setError(policyIssue || planIssue || '')
      return
    }
    const text = composerDraft.controller.text.trim()
    const attachmentIds = attachments.files.map((f) => f.id)
    if (
      (!text && !attachmentIds.length) ||
      sending ||
      !!awaitingQueuedSubmission ||
      hasFailedSubmissionAttachments ||
      sendingRequest.current ||
      asideRequest.current === 'saving' ||
      stopping ||
      attachments.busy ||
      task.archivedAt ||
      pendingQuestion
    )
      return
    if (firstMessage && (!connected || !task.repositoryId || !agent)) return
    sendingRequest.current = true
    setError('')
    setSending(true)
    setSubmittedText(text)
    if (
      attempt.current?.mode !== mode ||
      attempt.current?.text !== text ||
      !sameTurnSettings(attempt.current?.turnSettings, turnSettings) ||
      !!attempt.current.plan !== plan ||
      JSON.stringify(attempt.current.attachmentIds) !== JSON.stringify(attachmentIds)
    )
      attempt.current = {
        id: randomUUID(),
        text,
        attachmentIds,
        mode,
        draftRevision: composerDraft.controller.revision,
        turnSettings: turnSettings ?? undefined,
        ...(plan ? { plan: true } : {}),
        runId: mode === 'steer' ? task.activeRunId : undefined,
        preserveQueuePause:
          mode === 'queue' &&
          !stageFirst &&
          !task.queuePaused &&
          snapshot?.queuePausePreservationSupported === true,
        startupConfiguration:
          startup && firstMessage ? { ...task, draftTurnSettings, draftPlan } : undefined,
      }
    // Project/model selection can resolve before a failed send. A retry still starts
    // the next composer with the choices made before that resolution.
    const backgroundTask =
      background && firstMessage && onStartBackground
        ? (attempt.current.startupConfiguration ?? { ...task, draftTurnSettings, draftPlan })
        : undefined
    attempt.current.draftRevision = composerDraft.controller.revision
    const submittedRevision = attempt.current.draftRevision
    if (mode === 'stage' || (mode === 'queue' && task.status === 'running')) {
      setComposingDuringSend({ text, revision: attempt.current.draftRevision })
      setAwaitingQueuedSubmission(attempt.current.id)
      pendingDraftProtections.current.set(attempt.current.id, attempt.current)
    }
    const pending: PendingMessage = {
      taskId: task.id,
      state: 'sending',
      destination: pendingMessageDestination(task, mode),
      message: {
        id: attempt.current.id,
        role: 'user',
        text,
        createdAt: new Date().toISOString(),
        attachments: attachments.files,
        turnSettings: attempt.current.turnSettings,
        ...(attempt.current.plan ? { plan: true } : {}),
      },
    }
    pendingSubmission.current = pending.message.id
    onPending(pending)
    try {
      composerDraft.flush()
      await flush()
      if (firstMessage && task.autoProject) {
        const selected = await request(
          '/api/tasks/projects/select',
          {
            id: task.id,
            requestId: attempt.current.id,
            text: text || 'Work with the attached files',
          },
          taskSchema,
        )
        setWorkspace((w) =>
          updateTask(w, task.id, (current) => ({
            ...current,
            ...selected,
            ...(composerDraft.controller.revision !== submittedRevision
              ? {
                  draft: current.draft,
                  draftTurnSettings: current.draftTurnSettings,
                  draftPlan: current.draftPlan,
                  draftAttachments: current.draftAttachments,
                }
              : {}),
          })),
        )
      }
      if (firstMessage) {
        const summary =
          text ||
          `Work with the attached files: ${attachments.files.map((file) => file.name).join(', ')}`
        const title =
          attempt.current.title ?? (summary.split('\n')[0]?.trim().slice(0, 80) || 'New task')
        attempt.current.title = title
        setWorkspace((w) =>
          updateTask(w, task.id, (t) => ({
            ...t,
            title,
          })),
        )
        await flush()
      }
      let acknowledged = false
      if (connection) {
        const result = await request(
          mode === 'steer' ? '/api/tasks/steer' : '/api/tasks/message',
          {
            id: task.id,
            messageId: attempt.current.id,
            runId: attempt.current.runId,
            turnSettings: attempt.current.turnSettings,
            ...(attempt.current.plan ? { plan: true } : {}),
            text,
            attachmentIds,
            ...(mode === 'stage' ? { queueOnly: true } : {}),
            ...(attempt.current.preserveQueuePause ? { preserveQueuePause: true } : {}),
          },
          responses.ok,
        )
        if (result.pending) onPending({ ...pending, state: 'saved' })
        acknowledged = !result.pending
        if (mode === 'stage' && !result.pending) {
          setStagingGap((current) => ({
            ids: [...(current?.ids ?? []), pending.message.id],
            status: current?.status ?? task.status,
            runId: current?.runId ?? task.activeRunId,
          }))
          if (!attachmentIds.length) setAwaitingQueuedSubmission(null)
        } else if (mode === 'queue' && !result.pending) setStagingGap(null)
        if (firstMessage)
          void request(
            '/api/tasks/title',
            {
              taskId: task.id,
              expectedTitle: attempt.current.title,
              text: text || 'Work with the attached files',
            },
            generatedTitleSchema,
          ).catch(() => {
            // Optional enrichment: the accepted message keeps its provisional title on failure.
          })
      } else
        setWorkspace((w) =>
          updateTask(w, task.id, (t) => ({
            ...t,
            messages: [...t.messages, pending.message],
            ...(pending.message.plan ? { draftPlan: false } : {}),
            snoozedUntil: null,
            ...(t.archived ? { archived: false, autoSettled: undefined } : {}),
          })),
        )
      const unchanged = composerDraft.controller.revision === attempt.current.draftRevision
      if (!attempt.current.accepted) {
        composerDraft.accept(text, attempt.current.draftRevision)
        attempt.current.accepted = true
      }
      if (unchanged && attempt.current.plan) setDraftPlan(false)
      attempt.current = null
      if (unchanged) setTurnSettings(null)
      if (acknowledged && backgroundTask) onStartBackground?.(backgroundTask)
    } catch (e) {
      if (attempt.current?.accepted) {
        attempt.current = null
      } else {
        pendingDraftProtections.current.delete(pending.message.id)
        setAwaitingQueuedSubmission(null)
        onPending({ ...pending, state: 'failed' })
        if (composerDraft.controller.revision !== submittedRevision && attachmentIds.length) {
          setFailedSubmissionAttachments(attachmentIds)
          setError(
            `${String(e)} Remove the failed prompt's attachments before sending the new draft.`,
          )
        } else setError(String(e))
      }
    } finally {
      sendingRequest.current = false
      setSending(false)
      setComposingDuringSend(null)
    }
  }
  const startFork = async () => {
    if (plan) {
      setError('Turn off plan mode before forking. Fork uses this thread’s configuration.')
      return
    }
    if (turnSettings) {
      setError(
        'Clear the next-message settings before forking. Fork uses this thread’s configuration.',
      )
      return
    }
    if (policyIssue) {
      setError(policyIssue)
      return
    }
    const text = composerDraft.controller.text.trim()
    const draftRevision = composerDraft.controller.revision
    const attachmentIds = attachments.files.map((file) => file.id)
    if (
      !connected ||
      sendingRequest.current ||
      asideRequest.current === 'saving' ||
      sending ||
      stopping ||
      attachments.busy ||
      (!text && !attachmentIds.length)
    )
      return
    sendingRequest.current = true
    setSending(true)
    setSubmittedText(text)
    setError('')
    if (
      forkAttempt.current?.text !== text ||
      JSON.stringify(forkAttempt.current.attachmentIds) !== JSON.stringify(attachmentIds)
    )
      forkAttempt.current = { id: randomUUID(), text, attachmentIds }
    try {
      composerDraft.flush()
      await flush()
      const fork = await request(
        '/api/tasks/start-fork',
        { id: task.id, forkId: forkAttempt.current.id, text, attachmentIds },
        taskForkResultSchema,
      )
      setWorkspace((workspace) =>
        updateTask(workspace, task.id, (current) => ({
          ...current,
          draftAttachments: current.draftAttachments?.filter(
            (file) => !attachmentIds.includes(file.id),
          ),
        })),
      )
      composerDraft.accept(text, draftRevision)
      forkAttempt.current = null
      host.navigate({ viewId: 'tasks', entityId: fork.id })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      sendingRequest.current = false
      setSending(false)
    }
  }
  const [accessContainer, setAccessContainer] = useState<HTMLSpanElement | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const projectSettings = useThreadInfoContext()
  const [infoOpen, setInfoOpen] = useState(false)
  const [infoContainer, setInfoContainer] = useState<HTMLDivElement | null>(null)
  const usesTurnSettings = !!(
    snapshot?.queuedTurnSettingsSupported &&
    agent &&
    (!!editing || task.status === 'running' || !!task.queue?.length || !!turnSettings)
  )
  const renderControls = ({ model, access }: ComposerControlSlots) => (
    <>
      {model}
      {accessContainer && createPortal(access, accessContainer)}
    </>
  )
  const accessSlot =
    !pendingQuestion && (!usesTurnSettings || snapshot?.fullTurnSettingsSupported) ? (
      <span ref={setAccessContainer} className="contents" />
    ) : null
  const attachmentControl = !pendingQuestion && (
    <AttachmentPicker
      prominent
      disabled={
        (!!editing && !snapshot?.fullTurnSettingsSupported) ||
        !connected ||
        sending ||
        !!awaitingQueuedSubmission ||
        !!task.archivedAt ||
        attachments.busy
      }
      upload={attachments.upload}
    />
  )
  const planControl = planSupported && (
    <Button
      type="button"
      variant="ghost"
      aria-pressed={plan}
      title={
        !plan && planModeIssue(agent)
          ? planModeIssue(agent)
          : 'Plan the next message read-only before the agent changes anything'
      }
      className={cn(
        'composer-plan-toggle',
        preferences.showPlanButton
          ? 'h-8 gap-1.5 rounded-full px-2.5 text-[0.6875rem]'
          : 'h-9 w-full justify-start gap-2 rounded-md px-2 text-xs',
        plan && 'bg-primary/15 text-primary hover:bg-primary/20',
      )}
      disabled={sending || !!task.archivedAt || (!plan && !!planModeIssue(agent))}
      onClick={() => {
        changePlan(!plan)
        if (!preferences.showPlanButton) {
          setAddOpen(false)
          input.current?.focus()
        }
      }}
    >
      <ListChecks className="size-3.5" />
      Plan
    </Button>
  )
  const showSendOptions =
    preferences.showSendOptions &&
    !editing &&
    (hasBackgroundAction ||
      task.status === 'running' ||
      (connected && snapshot?.promptQueueStagingSupported === true))
  const extraActions = !pendingQuestion && (
    <>
      {!preferences.showPlanButton && planControl}
      <DraftStash
        key={JSON.stringify(['draft-stash', stashRuntimeId, task.id])}
        scope={stashRuntimeId ? draftStashScope(stashRuntimeId, task.id) : undefined}
        getText={() => composerDraft.controller.text}
        onChange={(value) => {
          setDraft(value)
          composerDraft.flush()
        }}
        focus={() => input.current?.focus()}
        hasAttachments={!!attachments.files.length || attachments.busy}
        disabled={!!editing || sending || !!task.archivedAt || !!task.archived || !!task.example}
        showLabel
      />
      <ThreadContextPicker
        key={JSON.stringify(['thread-context', stashRuntimeId, task.id])}
        taskId={task.id}
        attachmentBusy={attachments.busy}
        disabled={!!editing || sending || !!task.archivedAt || !!task.archived || !!task.example}
        upload={attachments.uploadContext}
        showLabel
      />
    </>
  )
  const settingsContainer = projectSettings?.container ?? infoContainer
  const workspaceSettings = workspaceControls?.(accessSlot) ?? (
    <ComposerWorkspace
      task={task}
      disabled={sending || !!task.archived}
      onMachineMoving={setMachineMoving}
      onSelectRemote={onSelectRemote}
    >
      {accessSlot}
    </ComposerWorkspace>
  )
  const settings = (
    <section
      aria-label="Environment and access"
      className="task-info-settings border-b border-border/60 p-4"
      inert={machineMoving || undefined}
    >
      <h3 className="mb-2 text-[0.625rem] font-medium uppercase tracking-wider text-muted-foreground">
        Environment and access
      </h3>
      {workspaceSettings}
    </section>
  )
  return (
    <div
      className="task-composer shrink-0"
      onFocusCapture={() => setEditorFocused(document.activeElement === input.current)}
      onBlurCapture={() => setEditorFocused(false)}
    >
      {meter && meter.level !== 'ok' && !pendingQuestion && (
        <div className="mx-auto mb-1 flex max-w-[var(--chat-max)] justify-end">
          <Button
            type="button"
            variant="ghost"
            className="h-7 gap-1.5 rounded-full border border-border/60 px-2.5 text-[0.6875rem] font-normal text-muted-foreground"
            title={meter.label}
            disabled={compactDisabled}
            onClick={compact}
          >
            {compactBusy ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Minimize2 className="size-3" />
            )}
            {compactBusy ? 'Compacting…' : 'Compact context'}
          </Button>
        </div>
      )}
      {attachments.editor}
      <QueueEditContext.Provider value={{ editingId: editing?.message.id, begin: beginEdit }}>
        {queuedMessages}
      </QueueEditContext.Provider>
      {editing && (
        <div
          className="mx-auto flex w-full max-w-[var(--chat-max)] items-center gap-2 px-3 py-2 text-xs"
          aria-label="Editing queued message"
        >
          <span className="flex-1">
            {task.queue?.some((message) => message.id === editing.message.id)
              ? 'Edit queued message'
              : 'This message already started or was removed. Your edit is kept in the composer.'}
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={sending || attachments.busy}
            onClick={() => {
              setEditing(null)
              setError('')
            }}
          >
            Cancel edit
          </Button>
        </div>
      )}
      <ComposerSurface
        aria-busy={submitBusy}
        collapsed={collapsed}
        compact={
          preferences.minimalComposer &&
          !editorFocused &&
          !composerDraft.hasText &&
          !pendingQuestion
        }
        leadingActions={
          !pendingQuestion && (
            <>
              <div className="composer-add-actions">
                {attachmentControl}
                <Popover.Root open={addOpen} onOpenChange={setAddOpen}>
                  <Popover.Trigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label="More composer actions"
                      aria-pressed={!preferences.showPlanButton && plan}
                      className={cn(
                        'composer-add-menu',
                        !preferences.showPlanButton && plan && 'text-primary bg-primary/15',
                      )}
                      disabled={sending || !!task.archivedAt}
                    >
                      <ChevronDown className="size-4" />
                    </Button>
                  </Popover.Trigger>
                  <Popover.Portal forceMount>
                    <Popover.Content
                      forceMount
                      hidden={!addOpen}
                      side="top"
                      align="start"
                      sideOffset={12}
                      onCloseAutoFocus={(event) => {
                        if (document.activeElement === input.current) event.preventDefault()
                      }}
                      className="z-50 w-72 rounded-2xl border bg-popover p-2 text-popover-foreground shadow-xl"
                    >
                      {extraActions}
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              </div>
              {preferences.showPlanButton && planControl}
              {!startup && !projectSettings && (
                <Popover.Root open={infoOpen} onOpenChange={setInfoOpen}>
                  <Popover.Trigger asChild>
                    <IconButton label="Thread info" className="size-8" type="button">
                      <Info className="size-4" />
                    </IconButton>
                  </Popover.Trigger>
                  <Popover.Portal forceMount>
                    <Popover.Content
                      forceMount
                      hidden={!infoOpen}
                      side="top"
                      align="start"
                      sideOffset={8}
                      aria-label="Thread info"
                      className="z-40 w-72 max-w-[calc(100vw-24px)] rounded-2xl border bg-popover text-popover-foreground shadow-xl"
                    >
                      <div ref={setInfoContainer} />
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              )}
            </>
          )
        }
        controls={
          pendingQuestion ? (
            <span className="text-xs text-muted-foreground">
              Answer the question above to continue.
            </span>
          ) : usesTurnSettings && agent ? (
            <TurnModelControls
              task={task}
              agent={agent}
              value={turnSettings}
              onChange={changeTurnSettings}
              disabled={sending || !!task.archived}
              renderControls={renderControls}
            />
          ) : (
            <ComposerHarnessControls
              task={task}
              disabled={!!editing || sending || !!task.archived}
              renderControls={renderControls}
            />
          )
        }
        actions={
          <>
            <ContextMeter task={task} />
            {!pendingQuestion && (
              <ComposerDictation
                controller={composerDraft.controller}
                input={input}
                disabled={submitBusy || machineMoving || asideCreating || !!task.archivedAt}
                onActive={setDictating}
              />
            )}
            {!pendingQuestion && (editing || task.status !== 'running' || hasInput) && (
              <div
                className="composer-send-group flex shrink-0 items-center"
                data-options={showSendOptions || undefined}
                role="group"
                aria-label="Send message"
              >
                <ComposerSubmit
                  busy={sending}
                  data-labeled={editing || task.status === 'running' || stageFirst ? '' : undefined}
                  className={
                    editing
                      ? 'h-8 w-auto gap-1.5 rounded-full px-3 text-[0.6875rem]'
                      : task.status === 'running' || stageFirst
                        ? 'h-8 w-auto gap-1.5 rounded-full bg-muted px-3 text-[0.6875rem] text-foreground hover:bg-accent'
                        : undefined
                  }
                  title={
                    editing
                      ? 'Save changes (Enter)'
                      : stageFirst
                        ? 'Add to queue (Enter)'
                        : steerFirst
                          ? `Steer agent (${submitShortcut})`
                          : task.status === 'running'
                            ? `Queue follow-up (${submitShortcut})`
                            : 'Send message (Enter)'
                  }
                  aria-label={
                    editing
                      ? 'Save changes'
                      : stageFirst
                        ? 'Add to queue'
                        : steerFirst
                          ? 'Steer agent'
                          : task.status === 'running'
                            ? 'Queue follow-up'
                            : connected
                              ? 'Send to agent'
                              : 'Save message to task'
                  }
                  disabled={
                    (!!editing &&
                      !task.queue?.some((message) => message.id === editing.message.id)) ||
                    !!policyIssue ||
                    !!planIssue ||
                    (!composerDraft.hasText &&
                      !(editing ? editing.files.length : attachments.files.length)) ||
                    sending ||
                    !!awaitingQueuedSubmission ||
                    hasFailedSubmissionAttachments ||
                    stopping ||
                    attachments.busy ||
                    !!task.archivedAt ||
                    (!!connection && !connected) ||
                    (firstMessage && (!connected || !task.repositoryId || !agent))
                  }
                >
                  {sending ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : steerFirst ? (
                    <CornerUpRight className="size-4" />
                  ) : task.status === 'running' || stageFirst ? (
                    <ListPlus className="size-4" />
                  ) : (
                    <ArrowUp className="size-4" />
                  )}
                  {editing
                    ? 'Save changes'
                    : stageFirst
                      ? 'Add to queue'
                      : task.status === 'running' && (steerFirst ? 'Steer' : 'Queue')}
                </ComposerSubmit>
                {showSendOptions && (
                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        aria-label="More message actions"
                        title="Other ways to send this message"
                        className="composer-send-options h-8 w-5 rounded-none p-0 text-primary-foreground/75 hover:bg-primary-foreground/10 hover:text-primary-foreground"
                        disabled={
                          !connected ||
                          sending ||
                          !!awaitingQueuedSubmission ||
                          stopping ||
                          attachments.busy ||
                          !!task.archivedAt
                        }
                      >
                        <ChevronDown className="size-3" />
                      </Button>
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content
                        side="top"
                        align="end"
                        sideOffset={6}
                        className="z-50 min-w-48 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
                      >
                        {hasBackgroundAction && (
                          <DropdownMenu.Item
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
                            disabled={
                              !!policyIssue ||
                              !!planIssue ||
                              !hasInput ||
                              !connected ||
                              !task.repositoryId ||
                              !agent ||
                              hasFailedSubmissionAttachments
                            }
                            onSelect={() => void send('queue', true)}
                          >
                            Start in background
                            <span className="ml-auto text-[0.625rem] text-muted-foreground">
                              Alt+Enter
                            </span>
                          </DropdownMenu.Item>
                        )}
                        {task.status === 'running' && (
                          <DropdownMenu.Item
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
                            disabled={
                              !!policyIssue ||
                              !!planIssue ||
                              !!task.archived ||
                              ((!!turnSettings || plan) && other === 'steer')
                            }
                            onSelect={() => void send(other)}
                          >
                            {other === 'steer' ? (
                              <CornerUpRight className="size-3.5" />
                            ) : (
                              <ListPlus className="size-3.5" />
                            )}
                            {other === 'steer' ? 'Steer agent' : 'Queue follow-up'}
                            <span className="ml-auto text-[0.625rem] text-muted-foreground">
                              Alt+Enter
                            </span>
                          </DropdownMenu.Item>
                        )}
                        {task.status !== 'running' && (
                          <DropdownMenu.Item
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
                            disabled={
                              !!policyIssue ||
                              !!planIssue ||
                              !!task.archived ||
                              !hasInput ||
                              (stageFirst && !!task.queue?.[0]?.paused)
                            }
                            onSelect={() => void send('queue')}
                          >
                            <ListPlus className="size-3.5" />
                            {stageFirst ? 'Add and run queue' : 'Add to queue'}
                          </DropdownMenu.Item>
                        )}
                        {snapshot?.promptQueueStagingSupported === true && !stageFirst && (
                          <DropdownMenu.Item
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
                            disabled={!!policyIssue || !!planIssue || !!task.archived || !hasInput}
                            onSelect={() => void send('stage')}
                          >
                            <ListPlus className="size-3.5" />
                            Add without starting
                          </DropdownMenu.Item>
                        )}
                        {task.repositoryId &&
                          !workspace.repositories.find((repo) => repo.id === task.repositoryId)
                            ?.kind && (
                            <DropdownMenu.Item
                              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-40"
                              disabled={!!task.archived || !!turnSettings || plan}
                              title={
                                turnSettings || plan
                                  ? 'Clear next-message settings to fork with this thread’s configuration'
                                  : undefined
                              }
                              onSelect={() => void startFork()}
                            >
                              <GitBranchPlus className="size-3.5" /> Fork
                            </DropdownMenu.Item>
                          )}
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                )}
              </div>
            )}
            {task.status === 'running' && (
              <Button
                type="button"
                size="icon"
                variant="destructive"
                className="size-8 shrink-0 rounded-full"
                aria-label="Stop"
                title="Stop the agent and pause queued messages"
                disabled={!connected || stopping || task.archived}
                onClick={() => void stop()}
              >
                {stopping ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <Square className="size-3.5 fill-current" />
                )}
              </Button>
            )}
          </>
        }
        error={error || policyIssue || planIssue || composerDraft.error || attachments.error}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          const allowed =
            connected &&
            !sending &&
            !awaitingQueuedSubmission &&
            !attachments.busy &&
            !task.archivedAt &&
            (!editing || !!snapshot?.fullTurnSettingsSupported)
          event.dataTransfer.dropEffect = allowed ? 'copy' : 'none'
          setFileDrag(allowed)
        }}
        onDragLeave={(event) => {
          if (
            event.relatedTarget instanceof Node &&
            event.currentTarget.contains(event.relatedTarget)
          )
            return
          setFileDrag(false)
        }}
        onDrop={(event) => {
          setFileDrag(false)
          if (!event.dataTransfer.files.length) return
          event.preventDefault()
          if (
            connected &&
            !sending &&
            !awaitingQueuedSubmission &&
            !task.archivedAt &&
            (!editing || snapshot?.fullTurnSettingsSupported)
          )
            void attachments.upload(Array.from(event.dataTransfer.files))
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files)
          if (!files.length) return
          // Rich-text sources can expose a synthetic file alongside their useful plain text.
          if (
            event.clipboardData.getData('text/plain') &&
            !files.some((file) => file.type.startsWith('image/'))
          )
            return
          if (
            connected &&
            !sending &&
            !awaitingQueuedSubmission &&
            !task.archivedAt &&
            (!editing || snapshot?.fullTurnSettingsSupported)
          ) {
            event.preventDefault()
            void attachments.upload(files)
          }
        }}
        onSubmit={(e) => {
          e.preventDefault()
          void send(stageFirst ? 'stage' : steerFirst ? 'steer' : 'queue')
        }}
      >
        {fileDrag && (
          <div
            role="status"
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-2 border-primary bg-card/95 text-sm"
          >
            Drop files to attach
          </div>
        )}
        <div className={cn('px-3', pendingQuestion && 'hidden')}>
          <MessageAttachments
            compact
            taskId={task.id}
            files={
              submitBusy
                ? []
                : editing && !snapshot?.fullTurnSettingsSupported
                  ? editing.files
                  : attachments.files
            }
            previews={attachments.previews}
            remove={attachments.remove}
            edit={attachments.edit}
            disabled={
              (!!editing && !snapshot?.fullTurnSettingsSupported) ||
              sending ||
              !!awaitingQueuedSubmission ||
              attachments.busy
            }
          />
        </div>
        {!!attachments.uploading.length && (
          <div
            className="flex flex-wrap gap-1.5 px-3 py-1"
            role="status"
            aria-label="Uploading attachments"
          >
            {attachments.uploading.map(({ attachment, url }) => (
              <div
                key={attachment.id}
                className="flex h-7 min-w-0 max-w-52 items-center gap-1.5 rounded-md border bg-secondary/40 px-1.5 text-[0.6875rem]"
              >
                {url && (
                  <img
                    src={url}
                    alt={attachment.name}
                    className="size-5 shrink-0 rounded object-cover"
                  />
                )}
                <span className="min-w-0 truncate" title={attachment.name}>
                  {attachment.name}
                </span>
                <span className="animate-pulse text-muted-foreground">Uploading…</span>
              </div>
            ))}
          </div>
        )}
        {awaitingQueuedSubmission && !sending && (
          <span role="status" className="px-3 text-xs text-muted-foreground">
            Waiting for the queued prompt to appear before sending the next draft.
          </span>
        )}
        <ComposerEditor
          onAlternativeSubmit={
            hasBackgroundAction
              ? () => void send('queue', true)
              : !editing && task.status === 'running' && !turnSettings && !plan
                ? () => void send(other)
                : undefined
          }
          controller={editorController}
          messages={task.messages}
          taskId={task.id}
          input={input}
          resources={resources}
          prompts={projectPrompts(
            workspace.repositories.find((repository) => repository.id === task.repositoryId),
            snapshot?.defaults,
          )}
          onCommand={
            !editing && (task.messages.length || task.queue?.length || task.turns?.length)
              ? runCommand
              : undefined
          }
          onSideChat={
            onAside &&
            !firstMessage &&
            !editing &&
            connected &&
            !sending &&
            !asideBusy &&
            !task.archived &&
            !task.archivedAt
              ? askAside
              : undefined
          }
          onManagePrompts={task.repositoryId ? () => setManagingPrompts(true) : undefined}
          autoFocus={firstMessage}
          hidden={pendingQuestion}
          disabled={machineMoving || !!task.archivedAt || pendingQuestion}
          submitBusy={submitBusy && !composingDuringSend}
          submittedText={submittedText}
          placeholder={
            editing
              ? 'Edit queued message…'
              : task.archivedAt
                ? 'Restore this archived thread to continue'
                : task.archived
                  ? 'Send a message to reopen this thread…'
                  : task.status === 'running'
                    ? steerFirst
                      ? 'Steer the agent while it works…'
                      : 'Queue a follow-up while the agent works…'
                    : firstMessage
                      ? startup
                        ? 'Ask anything, build or fix...'
                        : 'What would you like to build or fix?'
                      : 'Ask a follow-up or describe a change…'
          }
        />
      </ComposerSurface>
      {managingPrompts && task.repositoryId && (
        <SavedPromptsDialog
          repositoryId={task.repositoryId}
          onClose={() => setManagingPrompts(false)}
        />
      )}
      <ComposerCommandDialog
        command={command}
        commandBusy={commandBusy}
        canUndo={!!undoableId}
        connected={connected}
        running={task.status === 'running'}
        error={commandError}
        onClose={() => setCommand(null)}
        onConfirm={confirmCommand}
      />
      {startup ? (
        <div className={pendingQuestion ? 'hidden' : undefined} inert={machineMoving || undefined}>
          {workspaceSettings}
        </div>
      ) : settingsContainer ? (
        createPortal(settings, settingsContainer)
      ) : null}
    </div>
  )
}
