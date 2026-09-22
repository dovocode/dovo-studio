import type { ShortcutInput } from '../shell/shortcuts'
import { defaultTaskHarness, type Task } from '@dovo/protocol'
import { useEffect, useRef, useState } from 'react'
import { View } from 'react-native'
import { Text } from '../ui/text'
import { randomUUID } from 'expo-crypto'
import { z } from 'zod'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Choice } from '../ui/choice'
import { styles } from '../ui/theme'
export function NewTask({
  initial,
  onCreated,
  onCancel,
}: {
  initial?: ShortcutInput
  onCreated: (id: string) => void
  onCancel: () => void
}) {
  const { snapshot, call, connected } = useRuntime()
  const [repositoryId, setRepositoryId] = useState(initial?.repositoryId ?? '')
  const [requested, setRequested] = useState(false)
  const [id] = useState(() => initial?.id ?? randomUUID()),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0)
  const callbacks = useRef({ onCreated, onCancel })
  callbacks.current = { onCreated, onCancel }
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
    const task: Task = {
      id,
      title: 'New task',
      repositoryId,
      agentId: initial?.agentId || '',
      harness: initial?.agentId ? undefined : defaultTaskHarness('codex'),
      execution: 'main',
      status: 'draft',
      createdAt: new Date().toISOString(),
      messages: [],
      files: [],
      draft: initial?.text ?? '',
      example: false,
    }
    setError('')
    void (
      existing
        ? Promise.resolve()
        : call(
            '/api/workspace',
            { collection: 'tasks', id, create: task, changes: {} },
            z.object({ revision: z.number() }),
            'PATCH',
          )
    )
      .then(() => {
        if (active) callbacks.current.onCreated(id)
      })
      .catch((error) => {
        if (active) setError(String(error))
      })
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
