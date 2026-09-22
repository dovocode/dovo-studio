import { useState } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/text'
import { responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Choice } from '../ui/choice'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
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
  const { snapshot, call, connected } = useRuntime(),
    { busy, error, act } = useAction()
  const [generation, setGeneration] = useState(0)
  const terminals = snapshot?.terminals.filter((t) => t.taskId === task.id) ?? [],
    active = terminals.find((t) => t.id === selected) ?? terminals[0]
  return (
    <View style={styles.screen}>
      <View style={[styles.content, { paddingVertical: 6, gap: 6 }]}>
        <View style={styles.row}>
          <Action
            label="New terminal"
            disabled={!connected || busy || task.example}
            onPress={() =>
              act(async () => {
                const terminal = await call(
                  '/api/terminals',
                  { taskId: task.id },
                  responses.terminal,
                )
                onSelect(terminal.id)
              })
            }
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
                  act(() => call('/api/terminals/close', { id: active.id }, responses.ok))
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
          Open a shell in this task’s repository. Switching back to chat leaves the shell running on
          your desktop.
        </Text>
      )}
    </View>
  )
}
