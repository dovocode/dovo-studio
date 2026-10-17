import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect } from 'effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { decode } from '@dovo/protocol'
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import {
  workTaskInputSchema,
  projectDisplayName,
  workTaskResponseSchema,
  type ForgeIssue,
  type ForgePipeline,
  type WorkTaskInput,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useNavigation } from '../../shell/navigation'
import { Action } from '../../ui/controls/action'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'
import { WorkMenu } from './work-menu'
import { Sheet, useSheetNavigation, type SheetHandle } from '../../ui/layout/sheet'
import { Choice } from '../../ui/controls/choice'
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
  const { styles } = useTheme()

  const { snapshot, activeId, callEffect, refreshEffect } = useRuntime()
  const { navigate, focused } = useNavigation()
  const navigateAfterSheet = useSheetNavigation()
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [created, setCreated] = useApplicationState('')
  const [choosing, setChoosing] = useApplicationState(false)
  const [destination, setDestination] = useApplicationState('')
  const projectPicker = useRef<SheetHandle>(null)
  const openTask = (id: string) => {
    if (!activeId) {
      setError('The computer that owns this task is unavailable.')
      return
    }
    navigateAfterSheet(() => navigate('tasks', id, activeId))
  }
  const projects = snapshot?.workspace.repositories ?? []
  const pending = useRef(false)
  const attempt = useRef<WorkTaskInput | undefined>(undefined)
  const pickerSource = useRef<typeof source | undefined>(undefined)
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
    if (
      activeId &&
      focused &&
      created &&
      snapshot?.workspace.tasks.some((task) => task.id === created)
    ) {
      setCreated('')
      const open = () => navigateAfterSheet(() => navigate('tasks', created, activeId))
      if (projectPicker.current) projectPicker.current.dismiss(open)
      else open()
    }
  }, [created, snapshot, navigate, activeId, focused])
  const create = (targetId = repositoryId) => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (pending.current || disabled || !focused || !activeId) return
        const actionSource = pickerSource.current ?? source
        if (!targetId && !attempt.current && !created) {
          pickerSource.current = actionSource
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
              expectedDestination: actionSource.item.destination,
              kind: actionSource.kind,
              id: actionSource.item.id,
              url: actionSource.item.url,
              ...(actionSource.kind === 'issue'
                ? {
                    revision: actionSource.item.revision,
                  }
                : {
                    sha: actionSource.item.sha,
                  }),
            })
          attempt.current = input
          const result = yield* callEffect('/api/scm/work/task', input, workTaskResponseSchema)
          attempt.current = undefined
          pickerSource.current = undefined
          if (!current.current) return
          setCreated(result.id)
          yield* refreshEffect()
        }).pipe(
          Effect.catch((cause) =>
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
            <Action label="Open linked task" onPress={() => openTask(linked[0]!.id)} />
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
                onPress: () => openTask(task.id),
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
        <Sheet
          ref={projectPicker}
          title="Start task in a project"
          busy={busy}
          onClose={() => {
            setChoosing(false)
            if (!attempt.current) pickerSource.current = undefined
          }}
        >
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
                name: projectDisplayName(project),
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
