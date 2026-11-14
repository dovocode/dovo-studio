import { InterfaceText } from '@dovo/studio-core/interface-language'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Schema } from 'effect'
import { DovoWebKitBrowserView } from '../../modules/dovo-webkit-browser'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { randomUUID } from 'expo-crypto'
import {
  branchesSchema,
  responses,
  resolveTaskDefaults,
  runtimeComputerName,
  terminalShellsResponseSchema,
  threadStartMessage,
  workspacePatchResultSchema,
  workspaceRouteSchema,
  browserProfilesResultSchema,
  modelCatalogSchema,
  modelDiscoveryInput,
  suggestWorkspace,
  workspaceBrowserInput,
  workspaceModelChoices,
  harnessAvailabilitySchema,
  type BrowserProfile,
  worktreeChoicesSchema,
  type Task,
  type TerminalShell,
  type CreateWorkspaceTerminal,
} from '@dovo/protocol'
import { useMobilePreferences } from '../runtime/preferences/app-preferences'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { useNavigation } from '../shell/navigation'
import { taskHref } from '../shell/task-route'
import { useBrowserWorkspace } from '../browser/browser-workspace'
import { addTab, browserAddress, visitTab, type BrowserTab } from '../browser/browser-state'
import { ThreadStartModes } from '../tasks/creation/thread-start-modes'
import { Sheet } from '../ui/layout/sheet'
import { contentColumn } from '../ui/layout/content-column'
import { Glass } from '../ui/layout/glass'
import { ScreenHeader } from '../ui/layout/screen-header'
import { Choice } from '../ui/controls/choice'
import { Action } from '../ui/controls/action'
import { IconButton } from '../ui/controls/icon-button'
import { Switch } from '../ui/controls/switch'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { ThreadStarterModel, type StarterModel } from './thread-starter-model'
import { terminalHref } from './workspace-items'

type Mode = 'auto' | 'browser' | 'terminal' | 'thread'
type Receipt = {
  key: string
  messageId: string
  task?: Task
  created?: boolean
  sent?: boolean
  terminalId?: string
  tab?: BrowserTab
}
/** AI proposes a destination and picker selections. A second explicit submit performs the selected action. */
export function WorkspaceStarter({
  initialMode,
  embedded = false,
  onActiveChange,
}: {
  initialMode: 'auto' | 'terminal'
  embedded?: boolean
  onActiveChange?: (active: boolean) => void
}) {
  const uiText = useInterfaceText()

  const runtime = useRuntime()
  const browser = useBrowserWorkspace()
  const preferences = useMobilePreferences()
  const { focused } = useNavigation()
  const { styles, colors } = useTheme()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [text, setText] = useState('')
  const [runtimeId, setRuntimeId] = useState(
    () =>
      runtime.overviews.find((entry) => entry.connected && entry.profile.id === runtime.activeId)
        ?.profile.id ??
      runtime.overviews.find((entry) => entry.connected)?.profile.id ??
      runtime.activeId ??
      '',
  )
  const [repositoryId, setRepositoryId] = useState('')
  const [threadId, setThreadId] = useState('')
  const [model, setModel] = useState<{ key: string; fields: StarterModel } | null>(null)
  const [draftId] = useState(randomUUID)
  const [shellId, setShellId] = useState('default')
  const [remember, setRemember] = useState(true)
  const [checkout, setCheckout] = useState<'main' | 'existing' | 'worktree'>('main')
  const [checkoutValue, setCheckoutValue] = useState('')
  const [browserSource, setBrowserSource] = useState('device')
  const [profileId, setProfileId] = useState('default')
  const [browserProfiles, setBrowserProfiles] = useState<{ key: string; items: BrowserProfile[] }>({
    key: '',
    items: [],
  })
  const [reason, setReason] = useState('')
  const [suggested, setSuggested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editorFocused, setEditorFocused] = useState(false)
  const [options, setOptions] = useState(false)
  useLayoutEffect(() => {
    onActiveChange?.(busy || !!text.length || !!error || options || editorFocused)
  }, [busy, text, error, options, editorFocused, onActiveChange])
  const [shellRetry, setShellRetry] = useState(0)
  const [checkoutRetry, setCheckoutRetry] = useState(0)
  const [shells, setShells] = useState<{ key: string; items?: TerminalShell[]; error?: string }>({
    key: '',
  })
  const [choices, setChoices] = useState<{
    key: string
    items?: { id: string; name: string }[]
    error?: string
  }>({ key: '' })
  const receipt = useRef<Receipt | null>(null)
  const pending = useRef(false)
  const revision = useRef(0)
  const mounted = useRef(false)
  const visible = useRef(focused)
  visible.current = focused
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      revision.current++
    }
  }, [])
  useEffect(() => {
    if (!focused) revision.current++
  }, [focused])
  const owner = runtime.overviews.find((entry) => entry.profile.id === runtimeId)
  const profile = owner?.profile
  const connected = !!owner?.connected
  const repositories = owner?.snapshot?.workspace.repositories ?? []
  const repository = repositories.find((entry) => entry.id === repositoryId)
  const { readRuntime, refreshRuntime } = runtime
  const ownerKey = JSON.stringify([
    runtimeId,
    profile?.connection.address,
    profile?.connection.token,
  ])
  const currentOwnerKey = useRef(ownerKey)
  currentOwnerKey.current = ownerKey
  const checkoutKey = JSON.stringify([ownerKey, repositoryId, checkout])
  const modelKey = JSON.stringify([ownerKey, repositoryId])
  const threadProject = repository ?? repositories.find((entry) => entry.kind === 'scratch')
  const draftTask: Task | undefined = threadProject
    ? {
        ...resolveTaskDefaults(owner?.snapshot?.defaults, threadProject),
        ...(model?.key === modelKey ? model.fields : {}),
        id: draftId,
        title: uiText('New thread'),
        repositoryId: threadProject.id,
        agentId: model?.key === modelKey ? model.fields.agentId : '',
        status: 'draft',
        createdAt: '',
        messages: [],
        files: [],
        draft: '',
        example: false,
      }
    : undefined
  useEffect(() => {
    let alive = true
    if (mode !== 'terminal' || !profile || !connected) return
    setShells({ key: ownerKey })
    void readRuntime(profile, '/api/terminals/shells', {}, terminalShellsResponseSchema).then(
      (result) => {
        if (!alive) return
        setShells({ key: ownerKey, items: result.shells })
        setShellId((id) => (result.shells.some((shell) => shell.id === id) ? id : 'default'))
      },
      (cause: unknown) => {
        if (alive) setShells({ key: ownerKey, error: String(cause) })
      },
    )
    return () => {
      alive = false
    }
  }, [ownerKey, connected, mode, readRuntime, shellRetry])
  useEffect(() => {
    let alive = true
    if (mode !== 'terminal' || !profile || !connected || !repositoryId || checkout === 'main')
      return
    setChoices({ key: checkoutKey })
    const load = async () => {
      if (checkout === 'existing') {
        const result = await readRuntime(
          profile,
          '/api/scm/worktrees/choices',
          { repositoryId },
          worktreeChoicesSchema,
        )
        return result.worktrees.map((tree) => ({
          id: tree.path,
          name: `${tree.branch ?? 'Detached'} · ${tree.path}`,
        }))
      }
      const result = await readRuntime(
        profile,
        '/api/scm/branches',
        { repositoryId },
        branchesSchema,
      )
      return result.branches.map((branch) => ({ id: branch.ref, name: branch.name }))
    }
    void load().then(
      (items) => {
        if (alive) {
          setChoices({ key: checkoutKey, items })
          setCheckoutValue((value) =>
            items.some((item) => item.id === value) ? value : (items[0]?.id ?? ''),
          )
        }
      },
      (cause: unknown) => {
        if (alive) setChoices({ key: checkoutKey, error: String(cause) })
      },
    )
    return () => {
      alive = false
    }
  }, [checkoutKey, connected, mode, readRuntime, checkoutRetry])
  const loadProfiles = async (id: string, explicit = false) => {
    if (!explicit && browserSource === 'device')
      return DovoWebKitBrowserView
        ? preferences.browserProfiles
        : [{ id: 'default', name: uiText('Default') }]
    const target = runtime.overviews.find((owner) => owner.profile.id === id)
    if (!target) throw new Error('This computer is no longer paired.')
    return (
      await readRuntime(
        target.profile,
        '/api/previews/browser/profiles/read',
        {},
        browserProfilesResultSchema,
      )
    ).profiles
  }
  const loadModels = async (id: string, projectId: string) => {
    const target = runtime.overviews.find((owner) => owner.profile.id === id)
    if (!target?.snapshot) throw new Error('This computer is no longer available.')
    const availability = await readRuntime(
      target.profile,
      '/api/agents/availability',
      { repositoryId: projectId || undefined },
      harnessAvailabilitySchema,
    )
    return workspaceModelChoices(
      target.snapshot,
      projectId,
      (agent) =>
        readRuntime(
          target.profile,
          '/api/agents/models/cached',
          modelDiscoveryInput(agent),
          Schema.NullOr(modelCatalogSchema),
        ),
      new Set(availability.filter((item) => item.available).map((item) => item.id)),
    )
  }
  const browserProfilesKey = JSON.stringify([ownerKey, browserSource])
  useEffect(() => {
    if (mode !== 'browser') return
    let current = true
    void loadProfiles(runtimeId, browserSource !== 'device')
      .then((items) => {
        if (current) {
          setBrowserProfiles({ key: browserProfilesKey, items })
          setProfileId((id) => (items.some((item) => item.id === id) ? id : 'default'))
        }
      })
      .catch((cause: unknown) => {
        if (current)
          setError(uiText('Could not load browser profiles: {value0}', { value0: String(cause) }))
      })
    return () => {
      current = false
    }
  }, [mode, browserProfilesKey])
  const availableShells = shells.key === ownerKey ? shells.items : undefined
  const availableCheckouts = choices.key === checkoutKey ? choices.items : undefined
  const shellReady = !!availableShells?.some((shell) => shell.id === shellId)
  const checkoutReady =
    !repositoryId ||
    checkout === 'main' ||
    !!availableCheckouts?.some((item) => item.id === checkoutValue)
  const invalidate = () => {
    revision.current++
    setError('')
    setReason('')
    setSuggested(false)
  }
  const canSubmit =
    !busy &&
    (mode === 'browser'
      ? browser.loaded && browser.writable && (browserSource === 'device' || connected)
      : connected) &&
    (mode === 'terminal' ? shellReady && checkoutReady : !!text.trim())
  const submit = async () => {
    if (pending.current || !canSubmit) return
    pending.current = true
    setBusy(true)
    setError('')
    const attempt = revision.current
    const valid = () =>
      mounted.current &&
      visible.current &&
      revision.current === attempt &&
      currentOwnerKey.current === ownerKey
    const original = text.trim()
    try {
      if (mode === 'auto') {
        if (!profile || !connected)
          throw new Error('Choose an online computer to suggest a destination.')
        const result = await suggestWorkspace({
          text: original,
          runtimeId,
          repositoryId,
          continueThread: !!threadId,
          current: valid,
          computers: runtime.overviews
            .filter((owner) => owner.connected)
            .map((owner) => ({
              id: owner.profile.id,
              name: runtimeComputerName(owner),
              snapshot: owner.snapshot,
            })),
          route: (id, input) => {
            const target = runtime.overviews.find((owner) => owner.profile.id === id)
            if (!target) throw new Error('This computer is no longer paired.')
            return readRuntime(
              target.profile,
              '/api/tasks/workspace/route',
              input,
              workspaceRouteSchema,
            )
          },
          models: loadModels,
          profiles: loadProfiles,
        })
        if (valid()) {
          const changed = result.runtimeId !== runtimeId
          const next = runtime.overviews.find((owner) => owner.profile.id === result.runtimeId)
          setRuntimeId(result.runtimeId)
          setRepositoryId(result.repositoryId)
          if (changed) {
            setThreadId('')
            setShellId('default')
            setModel(null)
          }
          if (changed || result.repositoryId !== repositoryId) {
            setCheckout('main')
            setCheckoutValue('')
          }
          if (result.model)
            setModel({
              key: JSON.stringify([
                JSON.stringify([
                  result.runtimeId,
                  next?.profile.connection.address,
                  next?.profile.connection.token,
                ]),
                result.repositoryId,
              ]),
              fields: {
                agentId: '',
                harness: result.model.harness,
                harnessCustomized: true,
                agentOverrides: undefined,
                modelSelection: undefined,
              },
            })
          if (
            result.mode === 'browser' &&
            result.selections?.runtime &&
            result.selections.runtime !== 'keep'
          )
            setBrowserSource(result.runtimeId)
          if (result.profileId) setProfileId(result.profileId)
          setMode(result.mode)
          setReason(result.reason)
          setSuggested(true)
        }
        return
      }
      const key = JSON.stringify([
        mode,
        ownerKey,
        original,
        repositoryId,
        threadId,
        shellId,
        checkout,
        checkoutValue,
        remember,
        browserSource,
        profileId,
        model?.key === modelKey ? model.fields : null,
      ])
      if (receipt.current?.key !== key) receipt.current = { key, messageId: randomUUID() }
      const submission = receipt.current
      if (mode === 'browser') {
        if (!submission.tab) {
          const common = {
            id: randomUUID(),
            profileId:
              browserSource === 'device' && !DovoWebKitBrowserView && profileId === 'default'
                ? 'device'
                : profileId,
            url: browserAddress(workspaceBrowserInput(original)),
            title: '',
            visitedAt: Date.now(),
          }
          submission.tab =
            browserSource === 'device'
              ? { ...common, kind: 'local' }
              : { ...common, kind: 'remote', runtimeId }
          const tab = submission.tab
          browser.change((state) => addTab(state, tab))
        }
        if (valid() && submission.tab) {
          const id = submission.tab.id
          browser.change((state) => visitTab(state, id))
          Keyboard.dismiss()
          router.navigate('/workspace/browser')
        }
      } else {
        if (!profile || !connected) throw new Error('This computer is offline or no longer paired.')
        if (repositoryId && !repository)
          throw new Error('This project is no longer available. Choose another project.')
        if (mode === 'terminal') {
          if (!submission.terminalId) {
            const input: CreateWorkspaceTerminal = {
              repositoryId: repositoryId || undefined,
              command: original || undefined,
              shellId,
              rememberSession: remember && owner?.snapshot?.terminalRecoverySupported === true,
              execution: repositoryId && checkout !== 'main' ? 'worktree' : 'main',
              ...(repositoryId && checkout === 'existing'
                ? { existingWorktreePath: checkoutValue }
                : {}),
              ...(repositoryId && checkout === 'worktree'
                ? { worktreeBaseBranch: checkoutValue }
                : {}),
            }
            const terminal = await readRuntime(
              profile,
              '/api/terminals/workspace',
              input,
              responses.terminal,
            )
            submission.terminalId = terminal.id
          }
          await refreshRuntime(profile)
          if (valid()) {
            Keyboard.dismiss()
            router.replace(terminalHref(runtimeId, submission.terminalId))
          }
        } else {
          const target = threadId
            ? owner?.snapshot?.workspace.tasks.find((task) => task.id === threadId)
            : undefined
          if (threadId && !target) throw new Error('This thread is no longer available.')
          if (!threadId && !submission.task) {
            if (!draftTask) throw new Error('General threads are unavailable. Choose a project.')
            submission.task = {
              ...draftTask,
              id: randomUUID(),
              title: original.slice(0, 80),
              createdAt: new Date().toISOString(),
            }
          }
          const id = target?.id ?? submission.task?.id
          if (!id) throw new Error('Choose a thread destination.')
          const start =
            submission.task && !submission.created && owner?.snapshot?.threadStartSupported
              ? threadStartMessage(
                  { id, messageId: submission.messageId, text: original, attachmentIds: [] },
                  submission.task,
                )
              : undefined
          if (start) {
            // Durable local admission returns before the network round trip. The outbox
            // creates the thread with this message and projects it until a snapshot has it.
            await readRuntime(profile, '/api/tasks/message', start, responses.ok, undefined, {
              defer: true,
            })
            submission.created = true
            submission.sent = true
          }
          if (submission.task && !submission.created) {
            const result = await readRuntime(
              profile,
              '/api/workspace',
              { collection: 'tasks', id, create: submission.task, changes: {} },
              workspacePatchResultSchema,
              'PATCH',
            )
            if (result.outcome === 'rejected')
              throw new Error(result.reason ?? 'Could not save the new thread.')
            submission.created = true
          }
          if (!submission.sent) {
            await readRuntime(
              profile,
              '/api/tasks/message',
              { id, messageId: submission.messageId, text: original, attachmentIds: [] },
              responses.ok,
            )
            submission.sent = true
          }
          if (valid()) {
            Keyboard.dismiss()
            router.navigate(taskHref(runtimeId, id))
          }
        }
      }
      if (valid()) {
        setText('')
        receipt.current = null
        setReason('')
        setSuggested(false)
      }
    } catch (cause: unknown) {
      if (valid())
        setError(
          `${receipt.current?.created && !receipt.current.sent ? 'Thread saved. Retry to send to the same thread. ' : ''}${String(cause)}`,
        )
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  const actionLabel = busy
    ? 'Working…'
    : mode === 'auto'
      ? 'Choose destination'
      : mode === 'terminal'
        ? text.trim()
          ? 'Run command'
          : 'Open terminal'
        : mode === 'browser'
          ? 'Open browser'
          : threadId
            ? 'Send to thread'
            : 'Start thread'
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {!embedded && (
        <ScreenHeader
          title={initialMode === 'terminal' ? uiText('New terminal') : uiText('Start something')}
          onBack={() => router.back()}
        />
      )}
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          ...contentColumn.form,
          padding: 20,
          gap: 20,
          flexGrow: 1,
          justifyContent: 'center',
        }}
      >
        <View style={{ gap: 16, alignItems: 'center' }}>
          <Text
            style={{
              color: colors.text,
              fontSize: 20,
              lineHeight: 28,
              fontWeight: '500',
              textAlign: 'center',
            }}
          >
            {mode === 'terminal'
              ? uiText('Start a terminal')
              : mode === 'browser'
                ? uiText('Open a page')
                : mode === 'thread'
                  ? uiText('Start a thread')
                  : uiText('What would you like to work on?')}
          </Text>
          {mode !== 'browser' && !(mode === 'thread' && threadId) && (
            <ThreadStartModes
              home={mode === 'terminal'}
              selected={!repositoryId}
              disabled={busy}
              onGeneral={() => {
                invalidate()
                setRepositoryId('')
                setCheckout('main')
                setCheckoutValue('')
              }}
              project={
                <Choice
                  label={uiText('Project')}
                  hideLabel
                  compact
                  value={repositoryId}
                  disabled={busy || !connected}
                  items={[
                    { id: '', name: uiText('Choose project'), icon: 'folder' },
                    ...repositories
                      .filter((entry) => entry.kind !== 'scratch')
                      .map((entry) => ({ id: entry.id, name: entry.name })),
                  ]}
                  onChange={(value) => {
                    invalidate()
                    setRepositoryId(value)
                    setCheckout('main')
                    setCheckoutValue('')
                  }}
                />
              }
              server={
                <Choice
                  label={uiText('Computer')}
                  compact
                  quiet
                  hideLabel
                  disabled={busy}
                  value={runtimeId}
                  items={runtime.overviews.map((entry) => ({
                    id: entry.profile.id,
                    name: `${runtimeComputerName(entry)}${entry.connected ? '' : ' · offline'}`,
                    icon: 'device',
                  }))}
                  onChange={(value) => {
                    invalidate()
                    setRuntimeId(value)
                    setRepositoryId('')
                    setThreadId('')
                    setShellId('default')
                    setCheckout('main')
                    setCheckoutValue('')
                  }}
                />
              }
            />
          )}
          {mode === 'thread' && threadId && (
            <Text style={styles.muted}>
              <InterfaceText
                values={{
                  value0:
                    owner?.snapshot?.workspace.tasks.find((task) => task.id === threadId)?.title ??
                    uiText('thread'),
                }}
              >
                {'Continuing {value0}'}
              </InterfaceText>
            </Text>
          )}
          {mode === 'browser' && (
            <Text style={styles.muted}>
              {browserSource === 'device'
                ? uiText('This device')
                : owner
                  ? runtimeComputerName(owner)
                  : uiText('Choose a computer')}
            </Text>
          )}
        </View>
      </ScrollView>
      <View style={{ ...contentColumn.form, padding: 12, gap: 10 }}>
        <Glass
          testID="Workspace input surface"
          style={{
            borderRadius: 26,
            borderWidth: 1,
            borderColor: editorFocused ? colors.accent : colors.border,
            padding: 3,
            gap: 0,
          }}
        >
          <TextInput
            testID="Workspace request"
            accessibilityLabel={
              mode === 'terminal' ? uiText('Terminal command') : uiText('Workspace request')
            }
            value={text}
            editable={!busy}
            multiline
            maxLength={20000}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            smartInsertDelete={false}
            autoComplete="off"
            scrollEnabled
            submitBehavior="newline"
            placeholderTextColor={colors.muted}
            selectionColor={colors.accent}
            placeholder={
              mode === 'terminal'
                ? uiText('Optional command, or open an empty shell…')
                : mode === 'browser'
                  ? uiText('Enter a URL or web search…')
                  : mode === 'thread'
                    ? uiText('What would you like to work on?')
                    : uiText('Enter a request, URL or command…')
            }
            onFocus={() => setEditorFocused(true)}
            onBlur={() => setEditorFocused(false)}
            onChangeText={(value) => {
              invalidate()
              if (suggested) setMode('auto')
              setText(value)
            }}
            style={{
              color: colors.text,
              fontSize: 17,
              fontFamily:
                mode === 'terminal' ? (Platform.OS === 'ios' ? 'Menlo' : 'monospace') : undefined,
              paddingHorizontal: 12,
              paddingVertical: 11,
              lineHeight: 22,
              minHeight: 64,
              maxHeight: 144,
              textAlignVertical: 'top',
            }}
          />
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 2,
              padding: 3,
            }}
          >
            <IconButton
              icon="add"
              label={uiText('Workspace options')}
              size={44}
              onPress={() => {
                Keyboard.dismiss()
                setOptions(true)
              }}
              disabled={busy}
            />
            {initialMode === 'auto' ? (
              <Choice
                label={uiText('Destination')}
                compact
                hideLabel
                value={mode}
                disabled={busy}
                items={[
                  { id: 'auto', name: uiText('Auto'), icon: 'magic' },
                  { id: 'thread', name: uiText('Thread'), icon: 'chat' },
                  { id: 'browser', name: uiText('Browser'), icon: 'web' },
                  { id: 'terminal', name: uiText('Terminal'), icon: 'terminal' },
                ]}
                onChange={(value) => {
                  if (
                    value === 'auto' ||
                    value === 'browser' ||
                    value === 'terminal' ||
                    value === 'thread'
                  ) {
                    invalidate()
                    setMode(value)
                  }
                }}
              />
            ) : (
              <Text style={[styles.muted, { paddingLeft: 10 }]}>{uiText('Terminal')}</Text>
            )}
            {mode === 'thread' && !threadId && draftTask && (
              <RuntimeScope runtimeId={runtimeId}>
                <ThreadStarterModel
                  key={modelKey}
                  task={draftTask}
                  disabled={busy || !connected}
                  onChange={(fields) => {
                    invalidate()
                    setModel({ key: modelKey, fields })
                  }}
                />
              </RuntimeScope>
            )}
            {mode === 'terminal' && (
              <Choice
                label={uiText('Shell')}
                hideLabel
                compact
                value={shellId}
                disabled={busy || !availableShells}
                items={
                  availableShells?.map((shell) => ({ id: shell.id, name: shell.label })) ?? [
                    {
                      id: 'default',
                      name: shells.error ? 'Shells unavailable' : 'Loading shells…',
                    },
                  ]
                }
                onChange={(id) => {
                  invalidate()
                  setShellId(id)
                }}
              />
            )}
            <IconButton
              icon="send"
              label={actionLabel}
              variant="filled"
              size={44}
              disabled={!canSubmit}
              onPress={() => void submit()}
            />
          </View>
        </Glass>
        <View style={{ gap: 12 }}>
          <Text accessibilityRole={reason ? 'alert' : undefined} style={styles.muted}>
            {reason
              ? uiText(
                  'Suggested {value0}: {value1}. Review the destination, then choose {value2}.',
                  { value0: mode, value1: reason, value2: actionLabel },
                )
              : mode === 'auto'
                ? uiText('Auto suggests a destination. Review it before sending.')
                : mode === 'terminal'
                  ? uiText('Terminal · {value0} · {value1}', {
                      value0: owner ? runtimeComputerName(owner) : 'No computer',
                      value1: repository?.name ?? 'Home folder',
                    })
                  : mode === 'thread'
                    ? uiText('Thread · {value0}', {
                        value0: threadId ? 'Continue existing thread' : 'New thread',
                      })
                    : uiText('Browser · New page')}
          </Text>
          {mode === 'terminal' && shells.key === ownerKey && shells.error && (
            <>
              <Text style={styles.error}>{shells.error}</Text>
              <Action
                secondary
                label={uiText('Retry shells')}
                onPress={() => setShellRetry((value) => value + 1)}
              />
            </>
          )}
          {!connected && mode !== 'browser' && (
            <Text style={styles.muted}>
              <InterfaceText>{'Choose an online paired computer to continue.'}</InterfaceText>
            </Text>
          )}
          {!runtime.overviews.length && mode !== 'browser' && (
            <Action
              secondary
              label={uiText('Pair a computer')}
              onPress={() => router.push('/settings/devices')}
            />
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </View>
      </View>
      {options && (
        <Sheet
          title={mode === 'terminal' ? uiText('Terminal options') : uiText('Workspace options')}
          onClose={() => setOptions(false)}
        >
          {mode === 'thread' && (
            <Choice
              label={uiText('Thread destination')}
              disabled={busy || !connected}
              value={threadId}
              items={[
                { id: '', name: uiText('New thread') },
                ...(owner?.snapshot?.workspace.tasks ?? [])
                  .filter((task) => !task.archivedAt && !task.example && !task.sideThread)
                  .map((task) => ({ id: task.id, name: task.title })),
              ]}
              onChange={(id) => {
                invalidate()
                setThreadId(id)
              }}
            />
          )}
          {mode === 'browser' && (
            <Choice
              label={uiText('Browser computer')}
              value={browserSource}
              disabled={busy}
              items={[
                { id: 'device', name: uiText('This device') },
                ...runtime.overviews.map((entry) => ({
                  id: entry.profile.id,
                  name: `${runtimeComputerName(entry)}${entry.connected ? '' : ' · offline'}`,
                })),
              ]}
              onChange={(id) => {
                invalidate()
                setBrowserSource(id)
                setProfileId('default')
                if (id !== 'device' && id !== runtimeId) {
                  setRuntimeId(id)
                  setRepositoryId('')
                  setThreadId('')
                  setShellId('default')
                  setCheckout('main')
                  setCheckoutValue('')
                }
              }}
            />
          )}
          {mode === 'browser' && (
            <Choice
              label={uiText('Browser profile')}
              value={profileId}
              disabled={busy || browserProfiles.key !== browserProfilesKey}
              items={(browserProfiles.key === browserProfilesKey
                ? browserProfiles.items
                : [{ id: 'default', name: uiText('Default') }]
              ).map((profile) => ({ id: profile.id, name: profile.name }))}
              onChange={(id) => {
                invalidate()
                setProfileId(id)
              }}
            />
          )}
          {mode === 'terminal' && repositoryId && (
            <>
              <Choice
                label={uiText('Checkout')}
                disabled={busy}
                value={checkout}
                items={[
                  { id: 'main', name: uiText('Local checkout') },
                  { id: 'existing', name: uiText('Existing worktree') },
                  { id: 'worktree', name: uiText('New worktree') },
                ]}
                onChange={(value) => {
                  if (value === 'main' || value === 'existing' || value === 'worktree') {
                    invalidate()
                    setCheckout(value)
                    setCheckoutValue('')
                  }
                }}
              />
              {checkout !== 'main' && (
                <Choice
                  label={checkout === 'existing' ? uiText('Worktree') : uiText('Base branch')}
                  value={checkoutValue}
                  disabled={busy || !availableCheckouts}
                  items={availableCheckouts ?? []}
                  onChange={(id) => {
                    invalidate()
                    setCheckoutValue(id)
                  }}
                />
              )}
              {checkout !== 'main' && choices.key === checkoutKey && choices.error && (
                <>
                  <Text style={styles.error}>{choices.error}</Text>
                  <Action
                    secondary
                    label={uiText('Retry checkouts')}
                    onPress={() => setCheckoutRetry((value) => value + 1)}
                  />
                </>
              )}
              {checkout !== 'main' && availableCheckouts?.length === 0 && (
                <Text style={styles.muted}>
                  <InterfaceText
                    values={{
                      value0: checkout === 'existing' ? uiText('worktrees') : uiText('branches'),
                    }}
                  >
                    {'No {value0} available. Choose another checkout.'}
                  </InterfaceText>
                </Text>
              )}
            </>
          )}
          {mode === 'terminal' && (
            <View style={{ gap: 8 }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text>
                  <InterfaceText>{'Remember session'}</InterfaceText>
                </Text>
                <Switch
                  accessibilityLabel={uiText('Remember terminal session')}
                  value={remember && owner?.snapshot?.terminalRecoverySupported === true}
                  disabled={busy || !owner?.snapshot?.terminalRecoverySupported}
                  onValueChange={(value) => {
                    invalidate()
                    setRemember(value)
                  }}
                />
              </View>
              <Text style={styles.muted}>
                {owner?.snapshot?.terminalRecoverySupported
                  ? uiText(
                      'Recover supported tools after a computer restart. Settling idle sessions lets them sleep.',
                    )
                  : uiText('Update this computer to enable persistent terminal recovery.')}
              </Text>
            </View>
          )}
          <Action label={uiText('Done')} onPress={() => setOptions(false)} />
        </Sheet>
      )}
    </KeyboardAvoidingView>
  )
}
