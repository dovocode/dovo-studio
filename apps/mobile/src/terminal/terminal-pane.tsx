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
}: {
  task: Task
  selected: string
  onSelect: (id: string) => void
}) {
  const { colors, styles } = useTheme()

  const { snapshot, connected, callEffect } = useRuntime(),
    { busy, error, act } = useAction()
  const [savedGroups, setGroups] = useApplicationState<TerminalGroup[]>([])
  const closeShell = (id: string) =>
    act(() => callEffect('/api/terminals/close', { id }, responses.ok))
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
  const layout = group?.layout ?? 'columns'
  const shellReady =
    !task.example &&
    (task.execution !== 'worktree' || !!task.existingWorktreePath || !canChangeTaskCheckout(task))
  const openShell = (split?: TerminalGroup['layout']) =>
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
                    onPress={() =>
                      act(() =>
                        mobileWorkflow(function* () {
                          for (const id of tab.sessions)
                            yield* callEffect('/api/terminals/close', { id }, responses.ok)
                        }),
                      )
                    }
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
                      onPress={() => closeShell(terminal.id)}
                    />
                  </View>
                )}
                <TerminalSession key={`${terminal.id}:${generation}`} id={terminal.id} />
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
