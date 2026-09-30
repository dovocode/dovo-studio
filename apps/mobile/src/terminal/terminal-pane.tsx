import { mobileWorkflow } from '../runtime/state/native-effect'
import { useApplicationState } from '../runtime/state/application-state'
import { useEffect, useRef } from 'react'
import { ScrollView, View } from 'react-native'
import { Text } from '../ui/content/text'
import { canChangeTaskCheckout, responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { Choice } from '../ui/controls/choice'
import { IconButton } from '../ui/controls/icon-button'
import { styles } from '../ui/theme'
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
  const { snapshot, connected, callEffect } = useRuntime(),
    { busy, error, act } = useAction()
  const [layout, setLayout] = useApplicationState('tabs')
  const closeShell = (id: string) =>
    act(() => callEffect('/api/terminals/close', { id }, responses.ok))
  const [generation, setGeneration] = useApplicationState(0)
  const autoTried = useRef(false)
  const terminals = snapshot?.terminals.filter((t) => t.taskId === task.id) ?? [],
    active = terminals.find((t) => t.id === selected) ?? terminals[0]
  const shellReady =
    !task.example &&
    (task.execution !== 'worktree' || !!task.existingWorktreePath || !canChangeTaskCheckout(task))
  const openShell = () =>
    act(() =>
      mobileWorkflow(function* () {
        const terminal = yield* callEffect(
          '/api/terminals',
          { taskId: task.id },
          responses.terminal,
        )
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
            onPress={openShell}
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
            {terminals.map((terminal) => (
              <View key={terminal.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Action
                  secondary
                  label={`${terminal.title}${terminal.exited ? ' · exited' : ''}`}
                  onPress={() => onSelect(terminal.id)}
                />
                <IconButton
                  icon="close"
                  label={`Close ${terminal.title}`}
                  disabled={!connected || busy}
                  onPress={() => closeShell(terminal.id)}
                />
              </View>
            ))}
          </ScrollView>
        )}
        {terminals.length > 1 && (
          <Choice
            label="Terminal layout"
            hideLabel
            value={layout}
            items={[
              { id: 'tabs', name: 'Tabs' },
              { id: 'columns', name: 'Side by side' },
              { id: 'rows', name: 'Stacked' },
            ]}
            onChange={setLayout}
          />
        )}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>
      {active ? (
        <View
          style={{ flex: 1, minHeight: 0, flexDirection: layout === 'columns' ? 'row' : 'column' }}
        >
          {(layout === 'tabs' ? [active] : terminals).map((terminal) => (
            <View
              key={terminal.id}
              style={{
                flex: 1,
                minWidth: 0,
                minHeight: 0,
                borderWidth: layout === 'tabs' ? 0 : 1,
                borderColor: '#ffffff20',
              }}
            >
              {layout !== 'tabs' && (
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
