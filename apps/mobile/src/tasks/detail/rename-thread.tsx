import { Effect, Schema } from 'effect'
import { mutableStruct, type Task } from '@dovo/protocol'
import { useApplicationState } from '../../runtime/state/application-state'
import { useRuntime } from '../../runtime/connection/provider'
import { Sheet } from '../../ui/layout/sheet'
import { Field } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { useAction } from '../../ui/controls/use-action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function RenameThread({ task, onClose }: { task: Task; onClose: () => void }) {
  const { styles } = useTheme()

  const { connected, callEffect } = useRuntime()
  const [title, setTitle] = useApplicationState(task.title)
  const { act, busy, error } = useAction()
  return (
    <Sheet title="Rename thread" busy={busy} onClose={onClose}>
      <Field label="Thread title" value={title} editable={!busy} onChangeText={setTitle} />
      <Action
        label="Save title"
        disabled={!connected || busy || !title.trim()}
        onPress={() =>
          act(() =>
            callEffect(
              '/api/workspace',
              {
                collection: 'tasks',
                id: task.id,
                changes: { title: { before: task.title, after: title.trim() } },
              },
              mutableStruct({ revision: Schema.Number.pipe(Schema.finite()) }),
              'PATCH',
            ).pipe(Effect.tap(() => Effect.sync(onClose))),
          )
        }
      />
      {!!error && <Text style={styles.error}>{error}</Text>}
    </Sheet>
  )
}
