import { useEffect, useRef, useState } from 'react'
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native'
import { router } from 'expo-router'
import { randomUUID } from 'expo-crypto'
import {
  branchesSchema,
  responses,
  resolveTaskDefaults,
  runtimeComputerName,
  terminalShellsResponseSchema,
  workspacePatchResultSchema,
  workspaceRouteSchema,
  worktreeChoicesSchema,
  type Task,
  type TerminalShell,
  type CreateWorkspaceTerminal,
} from '@dovo/protocol'
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
/** AI only proposes a destination. A second explicit submit performs the selected action. */
export function WorkspaceStarter({
  initialMode,
  embedded = false,
}: {
  initialMode: 'auto' | 'terminal'
  embedded?: boolean
}) {
  const runtime = useRuntime()
  const browser = useBrowserWorkspace()
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
  const [reason, setReason] = useState('')
  const [suggested, setSuggested] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editorFocused, setEditorFocused] = useState(false)
  const [options, setOptions] = useState(false)
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
  const ownerKey = JSON.stringify([runtimeId, profile?.connection])
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
        title: 'New thread',
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
        const result = await readRuntime(
          profile,
          '/api/tasks/workspace/route',
          { text: original },
          workspaceRouteSchema,
        )
        if (valid()) {
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
        model?.key === modelKey ? model.fields : null,
      ])
      if (receipt.current?.key !== key) receipt.current = { key, messageId: randomUUID() }
      const submission = receipt.current
      if (mode === 'browser') {
        if (!submission.tab) {
          const common = {
            id: randomUUID(),
            profileId: browserSource === 'device' ? 'device' : 'default',
            url: browserAddress(original),
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
          title={initialMode === 'terminal' ? 'New terminal' : 'Start something'}
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
              ? 'Start a terminal'
              : mode === 'browser'
                ? 'Open a page'
                : mode === 'thread'
                  ? 'Start a thread'
                  : 'What would you like to work on?'}
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
                  label="Project"
                  hideLabel
                  compact
                  value={repositoryId}
                  disabled={busy || !connected}
                  items={[
                    { id: '', name: 'Choose project', icon: 'folder' },
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
                  label="Computer"
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
              Continuing{' '}
              {owner?.snapshot?.workspace.tasks.find((task) => task.id === threadId)?.title ??
                'thread'}
            </Text>
          )}
          {mode === 'browser' && (
            <Text style={styles.muted}>
              {browserSource === 'device'
                ? 'This device'
                : owner
                  ? runtimeComputerName(owner)
                  : 'Choose a computer'}
            </Text>
          )}
        </View>
      </ScrollView>
      <View style={{ ...contentColumn.form, padding: 12, gap: 10 }}>
        <Glass
          style={{
            borderRadius: 26,
            borderWidth: 1,
            borderColor: editorFocused ? colors.accent : colors.border,
            backgroundColor: colors.surface,
            padding: 3,
            gap: 0,
          }}
        >
          <TextInput
            testID="Workspace request"
            accessibilityLabel={mode === 'terminal' ? 'Terminal command' : 'Workspace request'}
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
                ? 'Optional command, or open an empty shell…'
                : mode === 'browser'
                  ? 'Enter a URL or web search…'
                  : mode === 'thread'
                    ? 'What would you like to work on?'
                    : 'Enter a request, URL or command…'
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
              label="Workspace options"
              size={44}
              onPress={() => {
                Keyboard.dismiss()
                setOptions(true)
              }}
              disabled={busy}
            />
            {initialMode === 'auto' ? (
              <Choice
                label="Destination"
                compact
                hideLabel
                value={mode}
                disabled={busy}
                items={[
                  { id: 'auto', name: 'Auto', icon: 'magic' },
                  { id: 'thread', name: 'Thread', icon: 'chat' },
                  { id: 'browser', name: 'Browser', icon: 'web' },
                  { id: 'terminal', name: 'Terminal', icon: 'terminal' },
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
              <Text style={[styles.muted, { paddingLeft: 10 }]}>Terminal</Text>
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
                label="Shell"
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
              ? `Suggested ${mode}: ${reason}. Review the destination, then choose ${actionLabel}.`
              : mode === 'auto'
                ? 'Auto suggests a destination. Review it before sending.'
                : mode === 'terminal'
                  ? `Terminal · ${owner ? runtimeComputerName(owner) : 'No computer'} · ${repository?.name ?? 'Home folder'}`
                  : mode === 'thread'
                    ? `Thread · ${threadId ? 'Continue existing thread' : 'New thread'}`
                    : 'Browser · New page'}
          </Text>
          {mode === 'terminal' && shells.key === ownerKey && shells.error && (
            <>
              <Text style={styles.error}>{shells.error}</Text>
              <Action
                secondary
                label="Retry shells"
                onPress={() => setShellRetry((value) => value + 1)}
              />
            </>
          )}
          {!connected && mode !== 'browser' && (
            <Text style={styles.muted}>Choose an online paired computer to continue.</Text>
          )}
          {!runtime.overviews.length && mode !== 'browser' && (
            <Action
              secondary
              label="Pair a computer"
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
          title={mode === 'terminal' ? 'Terminal options' : 'Workspace options'}
          onClose={() => setOptions(false)}
        >
          {mode === 'thread' && (
            <Choice
              label="Thread destination"
              disabled={busy || !connected}
              value={threadId}
              items={[
                { id: '', name: 'New thread' },
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
              label="Browser computer"
              value={browserSource}
              disabled={busy}
              items={[
                { id: 'device', name: 'This device' },
                ...runtime.overviews.map((entry) => ({
                  id: entry.profile.id,
                  name: `${runtimeComputerName(entry)}${entry.connected ? '' : ' · offline'}`,
                })),
              ]}
              onChange={(id) => {
                invalidate()
                setBrowserSource(id)
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
          {mode === 'terminal' && repositoryId && (
            <>
              <Choice
                label="Checkout"
                disabled={busy}
                value={checkout}
                items={[
                  { id: 'main', name: 'Local checkout' },
                  { id: 'existing', name: 'Existing worktree' },
                  { id: 'worktree', name: 'New worktree' },
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
                  label={checkout === 'existing' ? 'Worktree' : 'Base branch'}
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
                    label="Retry checkouts"
                    onPress={() => setCheckoutRetry((value) => value + 1)}
                  />
                </>
              )}
              {checkout !== 'main' && availableCheckouts?.length === 0 && (
                <Text style={styles.muted}>
                  No {checkout === 'existing' ? 'worktrees' : 'branches'} available. Choose another
                  checkout.
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
                <Text>Remember session</Text>
                <Switch
                  accessibilityLabel="Remember terminal session"
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
                  ? 'Recover supported tools after a computer restart. Settling idle sessions lets them sleep.'
                  : 'Update this computer to enable persistent terminal recovery.'}
              </Text>
            </View>
          )}
          <Action label="Done" onPress={() => setOptions(false)} />
        </Sheet>
      )}
    </KeyboardAvoidingView>
  )
}
