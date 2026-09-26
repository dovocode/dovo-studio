import { useEffect } from 'react'
import { View } from 'react-native'
import { Switch } from '../ui/switch'
import { Effect } from 'effect'
import { clientTaskScope } from '@dovo/client-runtime'
import { normalizeBranchPrefix, runtimePreferencesSchema } from '@dovo/protocol'
import { useApplicationState } from './application-state'
import { useRuntime } from './provider'
import { useAction } from '../ui/use-action'
import { Choice } from '../ui/choice'
import { Field } from '../ui/field'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'

type Preferences = typeof runtimePreferencesSchema.Type

/** Preferences stored on the computer itself, shared by every device that manages it. */
export function RuntimePreferences() {
  const { connected, readEffect, callEffect } = useRuntime()
  const [value, setValue] = useApplicationState<Preferences | null>(null)
  const [loadError, setLoadError] = useApplicationState('')
  const { act, busy, error } = useAction()
  useEffect(() => {
    setValue(null)
    setLoadError('')
    if (!connected) return
    const scope = clientTaskScope()
    void scope.run(
      readEffect('/api/runtime/preferences/read', {}, runtimePreferencesSchema).pipe(
        Effect.tap((settings) => Effect.sync(() => setValue(settings))),
        Effect.asVoid,
        Effect.catchAll((error) => Effect.sync(() => setLoadError(error.message))),
      ),
    )
    return () => {
      void scope.stop()
    }
  }, [connected, readEffect])
  // Saves only the changed field; the runtime merges it into the rest.
  const save = (changes: Partial<Preferences>) =>
    act(() =>
      callEffect('/api/runtime/preferences/save', changes, runtimePreferencesSchema).pipe(
        Effect.tap((settings) => Effect.sync(() => setValue(settings))),
      ),
    )
  const disabled = !connected || busy || value === null
  const [prefixDraft, setPrefixDraft] = useApplicationState<string | null>(null)
  const branchPrefix = normalizeBranchPrefix(prefixDraft ?? value?.branchPrefix ?? '')
  const commitPrefix = () => {
    if (prefixDraft !== null && branchPrefix.valid && branchPrefix.prefix !== value?.branchPrefix)
      save({ branchPrefix: branchPrefix.prefix })
    if (branchPrefix.valid) setPrefixDraft(null)
  }
  return (
    <View style={[styles.card, { gap: 14 }]}>
      <View style={{ gap: 6 }}>
        <View style={[styles.row, { flexWrap: 'nowrap', gap: 12 }]}>
          <Text style={[styles.text, { flex: 1 }]}>Auto-continue tasks after runtime restart</Text>
          <Switch
            accessibilityLabel="Auto-continue tasks after runtime restart"
            value={value?.autoContinueAfterRestart ?? false}
            disabled={disabled}
            onValueChange={(autoContinueAfterRestart) => save({ autoContinueAfterRestart })}
          />
        </View>
        <Text style={styles.muted}>
          Interrupted tasks and unpaused queues resume one at a time. Paused or stopped tasks stay
          paused.
        </Text>
      </View>
      <View style={{ gap: 6 }}>
        <Choice
          label="Auto-archive inactive tasks"
          value={String(value?.autoArchiveDays ?? 0)}
          disabled={disabled}
          items={[
            { id: '0', name: 'Never' },
            { id: '7', name: 'After 7 days' },
            { id: '14', name: 'After 14 days' },
            { id: '30', name: 'After 30 days' },
          ]}
          onChange={(days) =>
            save({ autoArchiveDays: Number(days) as Preferences['autoArchiveDays'] })
          }
        />
        <Text style={styles.muted}>
          Running, waiting, pinned tasks and tasks with an open terminal are never archived.
        </Text>
      </View>
      <View style={{ gap: 6 }}>
        <View style={[styles.row, { flexWrap: 'nowrap', gap: 12 }]}>
          <Text style={[styles.text, { flex: 1 }]}>Keep this computer awake while tasks run</Text>
          <Switch
            accessibilityLabel="Keep this computer awake while tasks run"
            value={value?.preventSleepWhileRunning ?? false}
            disabled={disabled}
            onValueChange={(preventSleepWhileRunning) => save({ preventSleepWhileRunning })}
          />
        </View>
        <Text style={styles.muted}>
          macOS only. Prevents idle sleep while a task is working, so it keeps going while you
          follow it here.
        </Text>
      </View>
      <View style={{ gap: 6 }}>
        <View style={[styles.row, { flexWrap: 'nowrap', gap: 12 }]}>
          <Text style={[styles.text, { flex: 1 }]}>Remove worktrees of archived tasks</Text>
          <Switch
            accessibilityLabel="Remove worktrees of archived tasks"
            value={value?.removeArchivedWorktrees ?? false}
            disabled={disabled}
            onValueChange={(removeArchivedWorktrees) => save({ removeArchivedWorktrees })}
          />
        </View>
        <Text style={styles.muted}>
          Worktrees with uncommitted changes are kept. The branch stays, so restoring a task checks
          it out again.
        </Text>
      </View>
      <View style={{ gap: 6 }}>
        <Choice
          label="Keep activity history"
          value={String(value?.activityRetentionDays ?? 0)}
          disabled={disabled}
          items={[
            { id: '0', name: 'Forever' },
            { id: '365', name: 'For 1 year' },
            { id: '90', name: 'For 90 days' },
            { id: '30', name: 'For 30 days' },
          ]}
          onChange={(days) =>
            save({
              activityRetentionDays: Number(days) as Preferences['activityRetentionDays'],
            })
          }
        />
        <Text style={styles.muted}>
          Older requests and tool details are deleted from this computer. Task conversations are
          kept.
        </Text>
      </View>
      <Field
        label="Branch prefix"
        placeholder="none"
        autoCorrect={false}
        editable={!disabled}
        value={prefixDraft ?? value?.branchPrefix ?? ''}
        onChangeText={setPrefixDraft}
        onEndEditing={commitPrefix}
        onSubmitEditing={commitPrefix}
        returnKeyType="done"
        hint={`New task branches look like ${branchPrefix.prefix}fix-login-1a2b3c4d. Leave empty for none.`}
        error={
          branchPrefix.valid ? undefined : 'Use letters, numbers, dots, dashes or underscores.'
        }
      />
      {!!(error || loadError) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || loadError}
        </Text>
      )}
    </View>
  )
}
