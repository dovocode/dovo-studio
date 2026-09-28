import { mobileWorkflow } from '../../runtime/state/native-effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { mutableStruct } from '@dovo/protocol'
import { useEffect } from 'react'
import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { Schema } from 'effect'
import { responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { BranchPicker } from '../../scm/connections/branch-picker'
import { Action } from '../../ui/controls/action'
import { Field } from '../../ui/controls/field'
import { Choice } from '../../ui/controls/choice'
import { styles } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'
import { HarnessSettings } from './harness-settings'
import { LifecycleActions } from './lifecycle-actions'
import { TaskSource } from './task-source'
export function TaskSettings({
  task,
  onBack,
  onBusyChange,
  onDeleted,
}: {
  task: Task
  onBack: () => void
  onBusyChange: (busy: boolean) => void
  onDeleted?: () => void
}) {
  const { connected, callEffect, snapshot } = useRuntime(),
    { act, busy, error } = useAction()
  const [title, setTitle] = useApplicationState(task.title),
    [laterText, setLaterText] = useApplicationState(''),
    [laterMinutes, setLaterMinutes] = useApplicationState('30'),
    [budgetTokens, setBudgetTokens] = useApplicationState(task.budget?.tokens?.toString() ?? ''),
    [budgetMinutes, setBudgetMinutes] = useApplicationState(task.budget?.minutes?.toString() ?? ''),
    [harness, setHarness] = useApplicationState(false),
    [harnessBusy, setHarnessBusy] = useApplicationState(false)
  const repository = snapshot?.workspace.repositories.find((item) => item.id === task.repositoryId)
  useEffect(() => {
    onBusyChange(busy || harnessBusy)
    return () => onBusyChange(false)
  }, [busy, harnessBusy, onBusyChange])
  if (harness)
    return (
      <View
        style={{
          gap: 12,
        }}
      >
        <View style={styles.row}>
          <Action
            secondary
            label="Back"
            disabled={harnessBusy}
            onPress={() => {
              if (!harnessBusy) setHarness(false)
            }}
          />
          <Text accessibilityRole="header" style={styles.text}>
            Agent & model
          </Text>
        </View>
        <HarnessSettings
          inline
          task={task}
          onClose={() => setHarness(false)}
          onBusyChange={setHarnessBusy}
        />
      </View>
    )
  return (
    <View
      style={{
        gap: 16,
      }}
    >
      <TaskSource task={task} onNavigate={onBack} />
      <Field label="Task title" value={title} editable={!busy} onChangeText={setTitle} />
      <Action
        label="Save task settings"
        disabled={!connected || busy || !title.trim()}
        onPress={() =>
          act(() =>
            mobileWorkflow(function* () {
              yield* callEffect(
                '/api/workspace',
                {
                  collection: 'tasks',
                  id: task.id,
                  changes: {
                    title: {
                      before: task.title,
                      after: title.trim(),
                    },
                  },
                },
                mutableStruct({
                  revision: Schema.Number.pipe(Schema.finite()),
                }),
                'PATCH',
              )
              onBack()
            }),
          )
        }
      />
      <Action
        secondary
        label="Agent & model"
        disabled={task.status === 'running' || busy || !connected}
        onPress={() => setHarness(true)}
      />
      <BranchPicker repositoryId={task.repositoryId} taskId={task.id} />
      <View style={{ gap: 8 }}>
        <Text style={styles.text}>Project approval rules</Text>
        <Text style={styles.muted}>These exact commands run without asking again.</Text>
        {(repository?.approvedCommands ?? []).map((command) => (
          <View key={command} style={styles.row}>
            <Text selectable style={[styles.muted, { flex: 1 }]}>
              {command}
            </Text>
            <Action
              secondary
              label="Remove"
              disabled={!connected || busy}
              onPress={() =>
                act(() =>
                  callEffect(
                    '/api/workspace',
                    {
                      collection: 'repositories',
                      id: repository?.id,
                      changes: {
                        approvedCommands: {
                          before: repository?.approvedCommands ?? null,
                          after:
                            repository?.approvedCommands?.filter((rule) => rule !== command) ?? [],
                        },
                      },
                    },
                    mutableStruct({ revision: Schema.Number.pipe(Schema.finite()) }),
                    'PATCH',
                  ),
                )
              }
            />
          </View>
        ))}
        {!repository?.approvedCommands?.length && (
          <Text style={styles.muted}>No saved commands.</Text>
        )}
      </View>
      <View style={{ gap: 8 }}>
        <Text style={styles.text}>Task budget · warn only</Text>
        <Field
          label="Token limit"
          value={budgetTokens}
          onChangeText={setBudgetTokens}
          keyboardType="number-pad"
        />
        <Field
          label="Agent minutes limit"
          value={budgetMinutes}
          onChangeText={setBudgetMinutes}
          keyboardType="number-pad"
        />
        <Action
          secondary
          label="Save budget"
          disabled={!connected || busy}
          onPress={() =>
            act(() =>
              callEffect(
                '/api/workspace',
                {
                  collection: 'tasks',
                  id: task.id,
                  changes: {
                    budget: {
                      before: task.budget ?? null,
                      after: {
                        ...(Number(budgetTokens) > 0 ? { tokens: Number(budgetTokens) } : {}),
                        ...(Number(budgetMinutes) > 0 ? { minutes: Number(budgetMinutes) } : {}),
                      },
                    },
                  },
                },
                mutableStruct({ revision: Schema.Number.pipe(Schema.finite()) }),
                'PATCH',
              ),
            )
          }
        />
      </View>
      <View style={{ gap: 8 }}>
        <Text style={styles.text}>Send later</Text>
        <Field label="Follow-up message" value={laterText} onChangeText={setLaterText} multiline />
        <Field
          label="Minutes from now"
          value={laterMinutes}
          onChangeText={setLaterMinutes}
          keyboardType="number-pad"
        />
        <Action
          secondary
          label="Schedule follow-up"
          disabled={!connected || busy || !laterText.trim() || !(Number(laterMinutes) > 0)}
          onPress={() =>
            act(() =>
              callEffect(
                '/api/tasks/schedule',
                {
                  id: task.id,
                  text: laterText.trim(),
                  at: new Date(Date.now() + Number(laterMinutes) * 60000).toISOString(),
                },
                responses.ok,
              ),
            )
          }
        />
        {(task.scheduledMessages ?? []).map((message) => (
          <View key={message.id} style={styles.row}>
            <Text style={[styles.muted, { flex: 1 }]}>
              {new Date(message.at).toLocaleString()} · {message.text}
            </Text>
            <Action
              secondary
              label="Remove"
              disabled={!connected || busy}
              onPress={() =>
                act(() =>
                  callEffect(
                    '/api/tasks/schedule',
                    { id: task.id, removeId: message.id },
                    responses.ok,
                  ),
                )
              }
            />
          </View>
        ))}
      </View>
      {task.status === 'draft' && (
        <Choice
          label="Start after"
          value={task.startAfter?.taskId ?? ''}
          items={[
            { id: '', name: 'Start manually' },
            ...(snapshot?.workspace.tasks ?? [])
              .filter((item) => item.id !== task.id && !item.archivedAt)
              .map((item) => ({ id: item.id, name: item.title })),
          ]}
          onChange={(sourceId) =>
            act(() =>
              callEffect(
                '/api/tasks/start-after',
                { id: task.id, sourceId: sourceId || null },
                responses.ok,
              ),
            )
          }
        />
      )}
      <LifecycleActions task={task} onDeleted={onDeleted} />
      {task.sessionId && (
        <Action
          secondary
          label="New session"
          disabled={!connected || busy || task.status === 'running'}
          onPress={() =>
            act(() =>
              callEffect(
                '/api/tasks/new-session',
                {
                  id: task.id,
                },
                responses.ok,
              ),
            )
          }
        />
      )}
      {task.status === 'running' && (
        <Text style={styles.muted}>
          Stop the active turn to change models or start a new session.
        </Text>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
