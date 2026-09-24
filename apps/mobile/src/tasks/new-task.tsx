import { nativeEffect } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/application-state'
import { mutableStruct } from '@dovo/protocol'
import type { ShortcutInput } from '../shell/shortcuts'
import { resolveTaskDefaults, type Task } from '@dovo/protocol'
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/text'
import { randomUUID } from 'expo-crypto'
import { Schema, Effect } from 'effect'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Choice } from '../ui/choice'
import { styles } from '../ui/theme'
export function NewTask({
  initial,
  repositoryId: selectedRepositoryId,
  onCreated,
  onCancel,
}: {
  repositoryId?: string
  initial?: ShortcutInput
  onCreated: (id: string) => void
  onCancel: () => void
}) {
  const { snapshot, call, connected } = useRuntime()
  const [repositoryId, setRepositoryId] = useApplicationState(
    selectedRepositoryId ?? initial?.repositoryId ?? '',
  )
  const [requested, setRequested] = useApplicationState(false)
  const [id] = useApplicationState(() => initial?.id ?? randomUUID()),
    [error, setError] = useApplicationState(''),
    [retry, setRetry] = useApplicationState(0)
  const callbacks = useRef({
    onCreated,
    onCancel,
  })
  callbacks.current = {
    onCreated,
    onCancel,
  }
  const defaults = useRef(snapshot?.defaults)
  defaults.current = snapshot?.defaults
  const workspace = useRef(snapshot?.workspace)
  workspace.current = snapshot?.workspace
  useEffect(() => {
    if (!connected || !requested) return
    let active = true
    const state = workspace.current
    if (!state?.repositories.some((repository) => repository.id === repositoryId)) {
      setError('Choose an available project before opening the chat.')
      setRequested(false)
      return
    }
    const existing = state?.tasks.find((task) => task.id === id)
    const taskDefaults = resolveTaskDefaults(
      defaults.current,
      state.repositories.find((repo) => repo.id === repositoryId),
    )
    const task: Task = {
      ...taskDefaults,
      id,
      title: 'New task',
      repositoryId,
      agentId: initial?.agentId || '',
      harness: initial?.agentId ? undefined : taskDefaults.harness,
      status: 'draft',
      createdAt: new Date().toISOString(),
      messages: [],
      files: [],
      draft: initial?.text ?? '',
      example: false,
    }
    setError('')
    void runClientEffect(
      nativeEffect(() =>
        existing
          ? Promise.resolve()
          : call(
              '/api/workspace',
              {
                collection: 'tasks',
                id,
                create: task,
                changes: {},
              },
              mutableStruct({
                revision: Schema.Number.pipe(Schema.finite()),
              }),
              'PATCH',
            ),
      )
        .pipe(
          Effect.flatMap(() =>
            nativeEffect(() => {
              if (active) callbacks.current.onCreated(id)
            }),
          ),
        )
        .pipe(
          Effect.catchAll((error) =>
            nativeEffect(() => {
              if (active) setError(String(error))
            }),
          ),
        ),
    )
    return () => {
      active = false
    }
  }, [id, initial, call, connected, retry, requested, repositoryId])
  return (
    <View style={styles.content}>
      <Text style={styles.title}>{requested ? 'Opening draft chat…' : 'Choose a project'}</Text>
      <Text style={styles.muted}>On {snapshot?.runtimeHost ?? 'this computer'}</Text>
      {!requested && (
        <>
          <Choice
            label="Project"
            value={repositoryId}
            items={(snapshot?.workspace.repositories ?? []).map((repository) => ({
              id: repository.id,
              name: repository.name,
            }))}
            onChange={setRepositoryId}
          />
          {!snapshot?.workspace.repositories.length && (
            <Text style={styles.muted}>Add a project on this computer before starting a task.</Text>
          )}
          <Action
            label="Open chat"
            disabled={
              !connected || !snapshot?.workspace.repositories.some((r) => r.id === repositoryId)
            }
            onPress={() => setRequested(true)}
          />
        </>
      )}
      {!!error && (
        <>
          <Text style={styles.error}>{error}</Text>
          {requested && (
            <Action
              label="Try again"
              disabled={!connected}
              onPress={() => setRetry((value) => value + 1)}
            />
          )}
        </>
      )}
      <Action label="Cancel" secondary onPress={onCancel} />
    </View>
  )
}
