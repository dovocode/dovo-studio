import { nativeEffect, mobileWorkflow } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../runtime/application-state'
import { decode } from '@dovo/protocol'
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import {
  workTaskInputSchema,
  workTaskResponseSchema,
  type ForgeIssue,
  type ForgePipeline,
  type WorkTaskInput,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { useNavigation } from '../shell/navigation'
import { Action } from '../ui/action'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'
import { WorkMenu } from './work-menu'
import { Sheet } from '../ui/sheet'
import { Choice } from '../ui/choice'
export function WorkTaskAction({
  repositoryId,
  jiraSourceId,
  source,
  disabled,
}: {
  repositoryId?: string
  jiraSourceId?: string
  source:
    | {
        kind: 'issue'
        item: ForgeIssue
      }
    | {
        kind: 'pipeline'
        item: ForgePipeline
      }
  disabled: boolean
}) {
  const { snapshot, activeId, callEffect, refreshEffect } = useRuntime()
  const { navigate, focused } = useNavigation()
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [created, setCreated] = useApplicationState('')
  const [choosing, setChoosing] = useApplicationState(false)
  const [destination, setDestination] = useApplicationState('')
  const projects = snapshot?.workspace.repositories ?? []
  const pending = useRef(false)
  const attempt = useRef<WorkTaskInput | undefined>(undefined)
  const current = useRef(true)
  useEffect(() => {
    current.current = true
    return () => {
      current.current = false
    }
  }, [])
  const linked =
    snapshot?.workspace.tasks.filter(
      (task) =>
        (jiraSourceId
          ? task.workItem?.kind === 'issue' && task.workItem.jiraSourceId === jiraSourceId
          : task.repositoryId === repositoryId) &&
        task.workItem?.kind === source.kind &&
        task.workItem.url === source.item.url,
    ) ?? []
  useEffect(() => {
    if (focused && created && snapshot?.workspace.tasks.some((task) => task.id === created)) {
      setCreated('')
      navigate('tasks', created, activeId ?? undefined)
    }
  }, [created, snapshot, navigate, activeId, focused])
  const create = (targetId = repositoryId) => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (pending.current || disabled || !focused) return
        if (!targetId && !attempt.current && !created) {
          setDestination(projects.length === 1 ? projects[0]!.id : '')
          setChoosing(true)
          return
        }
        pending.current = true
        setBusy(true)
        setError('')
        return yield* mobileWorkflow(function* () {
          if (created) {
            yield* refreshEffect()
            return
          }
          const input =
            attempt.current ??
            decode(workTaskInputSchema, {
              repositoryId: targetId,
              ...(jiraSourceId
                ? {
                    jiraSourceId,
                  }
                : {}),
              requestId: randomUUID(),
              kind: source.kind,
              id: source.item.id,
              url: source.item.url,
              ...(source.kind === 'issue'
                ? {
                    revision: source.item.revision,
                  }
                : {
                    sha: source.item.sha,
                  }),
            })
          attempt.current = input
          const result = yield* callEffect('/api/scm/work/task', input, workTaskResponseSchema)
          attempt.current = undefined
          if (!current.current) return
          setChoosing(false)
          setCreated(result.id)
          yield* refreshEffect()
        }).pipe(
          Effect.catchAll((cause) =>
            nativeEffect(() => {
              if (current.current) setError(cause instanceof Error ? cause.message : String(cause))
            }),
          ),
          Effect.ensuring(
            nativeEffect(() => {
              pending.current = false
              if (current.current) setBusy(false)
            }).pipe(Effect.orDie),
          ),
        )
      }),
    )
  }
  return (
    <View
      style={{
        gap: 4,
      }}
    >
      <View
        style={[
          styles.row,
          {
            flexWrap: 'nowrap',
          },
        ]}
      >
        <View
          style={{
            flex: 1,
            minWidth: 0,
          }}
        >
          {linked[0] ? (
            <Action label="Open linked task" onPress={() => navigate('tasks', linked[0]!.id)} />
          ) : (
            <Action
              label={
                busy ? 'Opening task…' : source.kind === 'issue' ? 'Start task' : 'Investigate run'
              }
              disabled={disabled || busy}
              onPress={() => void create()}
            />
          )}
        </View>
        {!!linked.length && (
          <WorkMenu
            label="Linked tasks"
            actions={[
              ...linked.map((task) => ({
                label: task.title,
                onPress: () => navigate('tasks', task.id),
              })),
              {
                label: busy ? 'Opening task…' : 'Start another task',
                disabled: disabled || busy,
                onPress: () => void create(),
              },
            ]}
          />
        )}
      </View>
      {!!linked[0] && (
        <Text numberOfLines={1} style={styles.muted}>
          {linked[0].title}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {choosing && (
        <Sheet title="Start task in a project" busy={busy} onClose={() => setChoosing(false)}>
          <Text style={styles.muted}>
            Choose the codebase for this task. The issue stays in Jira.
          </Text>
          <Choice
            label="Dovo project"
            value={destination}
            onChange={setDestination}
            disabled={busy || !!attempt.current}
            items={[
              {
                id: '',
                name: 'Choose a project…',
              },
              ...projects.map((project) => ({
                id: project.id,
                name: project.name,
              })),
            ]}
          />
          {!projects.length && (
            <Text style={styles.muted}>
              Add a project to this computer first. You can keep working with Jira issues without
              one.
            </Text>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
          <Action
            label={busy ? 'Opening task…' : 'Start task'}
            disabled={disabled || busy || !destination}
            onPress={() => void create(destination)}
          />
        </Sheet>
      )}
    </View>
  )
}
