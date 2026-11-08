import { Sheet } from '../ui/layout/sheet'
import { Choice } from '../ui/controls/choice'
import { terminalGroups, splitTerminal, type TerminalGroup } from '@dovo/protocol'
import { mobileWorkflow } from '../runtime/state/native-effect'
import { useApplicationState } from '../runtime/state/application-state'
import { useEffect, useRef } from 'react'
import { ScrollView, View } from 'react-native'
import { Text } from '../ui/content/text'
import { canChangeTaskCheckout, responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { IconButton } from '../ui/controls/icon-button'
import { useTheme } from '../ui/theme'
import { useAction } from '../ui/controls/use-action'
import { TerminalSession } from './terminal-session'
export function TerminalPane({
  task,
  selected,
  onSelect,
  visible,
}: {
  task: Task
  selected: string
  onSelect: (id: string) => void
  visible: boolean
}) {
  const { colors, styles } = useTheme()

  const { snapshot, connected, callEffect, connection } = useRuntime(),
    { busy, error, act } = useAction()
  const [savedGroups, setGroups] = useApplicationState<TerminalGroup[]>([])
  const scope = JSON.stringify([
    connection?.runtimeId,
    connection?.address,
    connection?.token,
    task.id,
  ])
  const owner = useRef({ scope, callEffect, generation: 0 })
  if (owner.current.scope !== scope || owner.current.callEffect !== callEffect)
    owner.current = { scope, callEffect, generation: owner.current.generation + 1 }
  useEffect(
    () => () => {
      owner.current.generation++
    },
    [scope, callEffect],
  )
  type CloseTarget = {
    ids: string[]
    labels: string[]
    generation: number
    callEffect: typeof callEffect
    next?: string
  }
  const pendingClose = useRef<CloseTarget | null>(null)
  const [closing, setClosing] = useApplicationState<CloseTarget | null>(null)
  const cancelClose = () => {
    pendingClose.current = null
    setClosing(null)
  }
  useEffect(() => {
    cancelClose()
  }, [scope, callEffect, visible, connected])
  const [generation, setGeneration] = useApplicationState(0)
  const [checkoutId, setCheckoutId] = useApplicationState('')
  const autoTried = useRef(false)
  const terminals = snapshot?.terminals.filter((t) => t.taskId === task.id) ?? [],
    active =
      terminals.find((t) => t.id === selected) ??
      terminals.find((terminal) =>
        savedGroups
          .find((group) => group.sessions.includes(selected))
          ?.sessions.includes(terminal.id),
      ) ??
      terminals[0]
  const groups = terminalGroups(
    savedGroups,
    terminals.map((terminal) => terminal.id),
  )
  const group = groups.find((group) => group.sessions.includes(active?.id ?? ''))
  const askClose = (ids: string[]) => {
    if (!connected || !visible || busy || pendingClose.current) return
    const target: CloseTarget = {
      ids: [...ids],
      labels: ids.map((id) => terminals.find((terminal) => terminal.id === id)?.title ?? id),
      generation: owner.current.generation,
      callEffect,
      next: ids.includes(active?.id ?? '')
        ? (group?.sessions.find((id) => !ids.includes(id)) ??
          groups.flatMap((item) => item.sessions).find((id) => !ids.includes(id)))
        : active?.id,
    }
    pendingClose.current = target
    setClosing(target)
  }
  const confirmClose = () => {
    const target = pendingClose.current
    cancelClose()
    if (!target || target.generation !== owner.current.generation || !visible || !connected) return
    act(() =>
      mobileWorkflow(function* () {
        for (const id of target.ids) {
          if (target.generation !== owner.current.generation) return
          yield* target.callEffect('/api/terminals/close', { id }, responses.ok)
        }
        if (target.next && target.generation === owner.current.generation) onSelect(target.next)
      }),
    )
  }
  const layout = group?.layout ?? 'columns'
  const shellReady =
    !task.example &&
    (task.execution !== 'worktree' || !!task.existingWorktreePath || !canChangeTaskCheckout(task))
  const openShell = (split?: TerminalGroup['layout']) => {
    if (pendingClose.current) return
    act(() =>
      mobileWorkflow(function* () {
        const terminal = yield* callEffect(
          '/api/terminals',
          { taskId: task.id, checkoutId: checkoutId || undefined },
          responses.terminal,
        )
        if (split && active) setGroups(splitTerminal(groups, active.id, terminal.id, split))
        onSelect(terminal.id)
      }),
    )
  }
  useEffect(() => {
    if (autoTried.current || !connected || !shellReady || !!selected) return
    autoTried.current = true
    act(() =>
      mobileWorkflow(function* () {
        const terminal = yield* callEffect(
          '/api/terminals/ensure',
          { taskId: task.id },
          responses.terminal,
        )
        onSelect(terminal.id)
      }),
    )
  }, [connected, shellReady, task.id, terminals, selected])
  return (
    <View style={styles.screen}>
      {closing && closing.generation === owner.current.generation && visible && connected && (
        <Sheet
          title={
            closing.ids.length === 1
              ? 'Close terminal?'
              : `Close ${closing.ids.length} terminal panes?`
          }
          presentation="dialog"
          onClose={cancelClose}
        >
          <Text>
            This terminates the shell and any running processes in {closing.labels.join(', ')} and
            clears their terminal history. Hide the terminal instead to keep them running.
          </Text>
          <Action secondary label="Cancel" onPress={cancelClose} />
          <Action label="Close terminal" onPress={confirmClose} />
        </Sheet>
      )}
      {!!task.linkedCheckouts?.length && (
        <Choice
          label="New terminal checkout"
          value={checkoutId}
          items={[
            { id: '', name: 'Primary checkout' },
            ...task.linkedCheckouts.map((link) => ({
              id: link.id,
              name: `${snapshot?.workspace.repositories.find((repo) => repo.id === link.repositoryId)?.name ?? link.repositoryId} · ${link.branch ?? link.execution}`,
            })),
          ]}
          onChange={setCheckoutId}
        />
      )}
      <View
        style={[
          styles.content,
          {
            paddingVertical: 6,
            gap: 6,
          },
        ]}
      >
        <View style={styles.row}>
          <Action
            label="New terminal"
            disabled={!connected || busy || !shellReady}
            onPress={() => openShell()}
          />
          {active && (
            <>
              <Action
                secondary
                label="Reconnect terminal"
                disabled={!connected}
                onPress={() => setGeneration((value) => value + 1)}
              />
            </>
          )}
        </View>
        {!!terminals.length && (
          <ScrollView
            horizontal
            style={{ flexGrow: 0 }}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ alignItems: 'center', gap: 4 }}
          >
            {groups.map((tab, index) => {
              const terminal = terminals.find((terminal) => terminal.id === tab.sessions[0])!
              return (
                <View key={tab.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Action
                    secondary
                    label={
                      tab.sessions.length > 1
                        ? `Terminal ${index + 1} · ${tab.sessions.length} panes`
                        : `${terminal.title}${terminal.exited ? ' · exited' : ''}`
                    }
                    onPress={() => onSelect(terminal.id)}
                  />
                  <IconButton
                    icon="close"
                    label={`Close terminal tab ${index + 1}`}
                    disabled={!connected || busy}
                    onPress={() => askClose(tab.sessions)}
                  />
                </View>
              )
            })}
          </ScrollView>
        )}
        {active && (
          <View style={styles.row}>
            <Action
              secondary
              label="Split left/right"
              disabled={!connected || busy || !shellReady}
              onPress={() => openShell('columns')}
            />
            <Action
              secondary
              label="Split top/bottom"
              disabled={!connected || busy || !shellReady}
              onPress={() => openShell('rows')}
            />
          </View>
        )}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>
      {active ? (
        <View
          style={{ flex: 1, minHeight: 0, flexDirection: layout === 'columns' ? 'row' : 'column' }}
        >
          {terminals
            .filter((terminal) => group?.sessions.includes(terminal.id))
            .map((terminal) => (
              <View
                key={terminal.id}
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 0,
                  borderWidth: (group?.sessions.length ?? 0) > 1 ? 1 : 0,
                  borderColor: colors.border,
                }}
              >
                {group && group.sessions.length > 1 && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingLeft: 8,
                    }}
                  >
                    <Text numberOfLines={1} style={[styles.muted, { flex: 1, fontSize: 12 }]}>
                      {terminal.title}
                    </Text>
                    <IconButton
                      icon="close"
                      label={`Close ${terminal.title}`}
                      disabled={!connected || busy}
                      onPress={() => askClose([terminal.id])}
                    />
                  </View>
                )}
                <TerminalSession
                  key={`${terminal.id}:${generation}`}
                  id={terminal.id}
                  visible={visible}
                />
              </View>
            ))}
        </View>
      ) : (
        <Text style={[styles.muted, styles.content]}>
          {shellReady
            ? 'No terminal open. Tap New terminal to open a shell in this checkout.'
            : 'Send the first message to create this worktree before opening a shell.'}
        </Text>
      )}
    </View>
  )
}
