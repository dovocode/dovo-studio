import { mobileWorkflow } from '../runtime/state/native-effect'
import { useApplicationState } from '../runtime/state/application-state'
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/content/text'
import { canChangeTaskCheckout, responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { Action } from '../ui/controls/action'
import { Choice } from '../ui/controls/choice'
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
              <Action
                secondary
                label="Close shell"
                disabled={!connected || busy}
                onPress={() =>
                  act(() =>
                    callEffect(
                      '/api/terminals/close',
                      {
                        id: active.id,
                      },
                      responses.ok,
                    ),
                  )
                }
              />
            </>
          )}
        </View>
        {terminals.length > 1 && active && (
          <Choice
            label="Session"
            hideLabel
            value={active.id}
            items={terminals.map((t) => ({
              id: t.id,
              name: `${t.title}${t.exited ? ' · exited' : ''}`,
            }))}
            onChange={onSelect}
          />
        )}
        {!!error && <Text style={styles.error}>{error}</Text>}
      </View>
      {active ? (
        <TerminalSession key={`${active.id}:${generation}`} id={active.id} />
      ) : (
        <Text style={[styles.muted, styles.content]}>
          {shellReady
            ? 'Opening a shell in this task’s checkout…'
            : 'Send the first message to create this worktree before opening a shell.'}
        </Text>
      )}
    </View>
  )
}
