import { Schema } from 'effect'
import { View } from 'react-native'
import { canChangeTaskCheckout, taskMachineDraft, taskSchema, type Task } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { useNavigation } from '../shell/navigation'
import { useAction } from '../ui/use-action'
import { Choice } from '../ui/choice'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'
import { saveRuntimeDraft } from './use-draft'
export function TaskMachineSelector({
  task,
  text,
  disabled,
  onMoving,
}: {
  task: Task
  text: string
  disabled: boolean
  onMoving: (value: boolean) => void
}) {
  const runtime = useRuntime()
  const { navigate } = useNavigation()
  const { busy, error, act } = useAction()
  const repository = runtime.snapshot?.workspace.repositories.find(
    (repo) => repo.id === task.repositoryId,
  )
  const identity = repository?.gitIdentity
  const targets = runtime.overviews.flatMap((entry) =>
    (entry.snapshot?.workspace.repositories ?? [])
      .filter(
        (repo) =>
          identity &&
          repo.gitIdentity === identity &&
          (entry.profile.id !== runtime.activeId || repo.id === task.repositoryId),
      )
      .map((repository) => ({
        entry,
        repository,
        key: JSON.stringify([entry.profile.id, repository.id]),
      })),
  )
  const value = JSON.stringify([runtime.activeId, task.repositoryId])
  const editable = canChangeTaskCheckout(task) && !task.archivedAt
  return (
    <View style={{ gap: 4 }}>
      <Choice
        compact
        row
        label={`Run on${targets.length > 1 ? ` · ${targets.length} checkouts` : ''}`}
        value={value}
        disabled={disabled || busy || !editable}
        items={
          targets.length
            ? targets.map(({ entry, repository, key }) => ({
                id: key,
                name: `${entry.profile.name}${entry.connected ? '' : ' · Offline'} · ${repository.branch} · ${repository.path}`,
              }))
            : [
                {
                  id: value,
                  name: runtime.profile?.name ?? runtime.snapshot?.runtimeHost ?? 'This machine',
                },
              ]
        }
        onChange={(key) => {
          if (key === value) return
          const target = targets.find((item) => item.key === key)
          if (!target || !identity) return
          act(async () => {
            if (!target.entry.connected)
              throw new Error('This machine is offline. Reconnect it before selecting it.')
            onMoving(true)
            try {
              const next = taskMachineDraft(
                { ...task, draft: text },
                target.repository,
                target.entry.snapshot?.defaults,
              )
              await runtime.readRuntime(
                target.entry.profile,
                '/api/tasks/draft-receive',
                { task: next, gitIdentity: identity },
                taskSchema,
              )
              await saveRuntimeDraft(target.entry.profile.id, task.id, text)
              const origin = runtime.profile
              if (!origin)
                throw new Error(
                  'The source machine is no longer saved. The destination draft is preserved.',
                )
              await runtime.readRuntime(
                origin,
                '/api/tasks/draft-moved',
                {
                  id: task.id,
                  repositoryId: task.repositoryId,
                  draft: task.draft,
                  gitIdentity: identity,
                },
                Schema.Struct({ ok: Schema.Boolean }),
              )
              await runtime.refreshRuntime(origin)
              await runtime.refreshRuntime(target.entry.profile)
              navigate('tasks', task.id, target.entry.profile.id)
            } finally {
              onMoving(false)
            }
          })
        }}
      />
      {editable && <Text style={styles.muted}>Starts only after your first prompt.</Text>}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </View>
  )
}
