import { useState } from 'react'
import { View } from 'react-native'
import { Effect } from 'effect'
import { workspacePatchResultSchema, type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useAction } from '../../ui/controls/use-action'
import { Sheet } from '../../ui/layout/sheet'
import { Choice } from '../../ui/controls/choice'
import { Field } from '../../ui/controls/field'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function TaskThreadBehavior({ task, onClose }: { task: Task; onClose: () => void }) {
  const { connected, callEffect } = useRuntime()
  const { styles } = useTheme()
  const { act, busy, error } = useAction()
  const [settle, setSettle] = useState(task.settleBehavior)
  const [archive, setArchive] = useState(
    task.archiveAfterSettledDays === undefined
      ? 'inherit'
      : task.archiveAfterSettledDays === 0
        ? 'off'
        : 'on',
  )
  const [days, setDays] = useState(String(task.archiveAfterSettledDays || 7))
  const overrides = ['settleMerged', 'settleClosed', 'settleInactive'] as const
  const period = Number(days)
  const valid =
    archive !== 'on' ||
    (/^\d+$/.test(days) && Number.isInteger(period) && period >= 1 && period <= 365)
  return (
    <Sheet title="Thread lifecycle" busy={busy} onClose={onClose}>
      <Text style={styles.muted}>
        Override this thread’s project defaults. Inherit follows Task lifecycle settings.
      </Text>
      {overrides.map((key, i) => (
        <Choice
          key={key}
          label={
            ['Auto-settle merged PRs', 'Auto-settle closed PRs', 'Auto-settle inactive threads'][
              i
            ] ?? key
          }
          value={settle?.[key] === undefined ? 'inherit' : settle[key] ? 'on' : 'off'}
          items={[
            { id: 'inherit', name: 'Inherit project' },
            { id: 'on', name: 'On' },
            { id: 'off', name: 'Off' },
          ]}
          disabled={busy || !connected}
          onChange={(value) =>
            setSettle((current) => ({
              ...current,
              [key]: value === 'inherit' ? undefined : value === 'on',
            }))
          }
        />
      ))}
      <Choice
        label="Auto-archive after settled"
        value={archive}
        onChange={setArchive}
        disabled={busy || !connected}
        items={[
          { id: 'inherit', name: 'Inherit project' },
          { id: 'off', name: 'Off' },
          { id: 'on', name: 'On' },
        ]}
      />
      {archive === 'on' && (
        <Field
          label="Days in Settled"
          value={days}
          onChangeText={setDays}
          keyboardType="number-pad"
          editable={!busy}
        />
      )}
      {!valid && (
        <Text accessibilityRole="alert" style={styles.error}>
          Choose between 1 and 365 days.
        </Text>
      )}
      <View style={styles.row}>
        <Action
          label="Save"
          disabled={!connected || busy || !valid}
          onPress={() =>
            act(() =>
              callEffect(
                '/api/workspace',
                {
                  collection: 'tasks',
                  id: task.id,
                  changes: {
                    settleBehavior: { before: task.settleBehavior ?? null, after: settle ?? null },
                    archiveAfterSettledDays: {
                      before: task.archiveAfterSettledDays ?? null,
                      after: archive === 'inherit' ? null : archive === 'off' ? 0 : period,
                    },
                  },
                },
                workspacePatchResultSchema,
                'PATCH',
              ).pipe(Effect.tap(() => Effect.sync(onClose))),
            )
          }
        />
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </Sheet>
  )
}
