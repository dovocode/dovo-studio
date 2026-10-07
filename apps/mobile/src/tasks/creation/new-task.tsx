import { FolderPicker } from './folder-picker'
import { runtimeComputerName } from '@dovo/protocol'
import { createDraftCreation } from './draft-creation'
import { nativeEffect } from '../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../../runtime/state/application-state'
import { mutableStruct } from '@dovo/protocol'
import type { ShortcutInput } from '../../shell/shortcuts'
import { resolveTaskDefaults, templateTaskFields, type Task } from '@dovo/protocol'
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { Text } from '../../ui/content/text'
import { randomUUID } from 'expo-crypto'
import { Schema, Effect } from 'effect'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Choice } from '../../ui/controls/choice'
import { useTheme } from '../../ui/theme'
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
  const { styles } = useTheme()

  const { snapshot, call, connected, profile } = useRuntime()
  const [repositoryId, setRepositoryId] = useApplicationState(
    selectedRepositoryId ?? initial?.repositoryId ?? '',
  )
  const [requested, setRequested] = useApplicationState(!!selectedRepositoryId)
  const [templateId, setTemplateId] = useApplicationState('')
  const templates =
    snapshot?.workspace.repositories.find((repository) => repository.id === repositoryId)
      ?.templates ?? []
  const [id] = useApplicationState(() => initial?.id ?? randomUUID()),
    [error, setError] = useApplicationState(''),
    [retry, setRetry] = useApplicationState(0)
  const createRequest = useRef(createDraftCreation())
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
    if (!state) return
    if (!state.repositories.some((repository) => repository.id === repositoryId)) {
      setError('Choose an available project before opening the chat.')
      setRequested(false)
      return
    }
    const existing = state?.tasks.find((task) => task.id === id)
    const taskDefaults = resolveTaskDefaults(
      defaults.current,
      state.repositories.find((repo) => repo.id === repositoryId),
    )
    const template = state.repositories
      .find((repo) => repo.id === repositoryId)
      ?.templates?.find((item) => item.id === templateId)
    const base: Task = {
      ...taskDefaults,
      id,
      title: template?.name ?? 'New task',
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
    // A template prefills the draft and settings; nothing is sent until the user sends it.
    const task: Task = template && !initial ? { ...base, ...templateTaskFields(template) } : base
    setError('')
    const requestKey = JSON.stringify([profile?.id, id, repositoryId, retry])
    const request = existing
      ? Promise.resolve()
      : createRequest.current(requestKey, () =>
          call(
            '/api/workspace',
            { collection: 'tasks', id, create: task, changes: {} },
            mutableStruct({ revision: Schema.Number.pipe(Schema.check(Schema.isFinite())) }),
            'PATCH',
          ),
        )
    void runClientEffect(
      nativeEffect(() => request)
        .pipe(
          Effect.flatMap(() =>
            nativeEffect(() => {
              if (active) callbacks.current.onCreated(id)
            }),
          ),
        )
        .pipe(
          Effect.catch((error) =>
            nativeEffect(() => {
              if (active) setError(String(error))
            }),
          ),
        ),
    )
    return () => {
      active = false
    }
  }, [
    id,
    initial,
    call,
    connected,
    profile?.id,
    retry,
    requested,
    repositoryId,
    templateId,
    snapshot?.workspace,
  ])
  return (
    <View style={styles.content}>
      <Text style={styles.title}>{requested ? 'Opening draft chat…' : 'Choose a project'}</Text>
      <Text style={styles.muted}>On {runtimeComputerName({ profile, snapshot })}</Text>
      {!requested && (
        <>
          <FolderPicker
            allowMachineChange={false}
            value={repositoryId}
            repositories={snapshot?.workspace.repositories ?? []}
            disabled={!connected}
            onChange={(value) => {
              setRepositoryId(value)
              setTemplateId('')
            }}
          />
          {!!templates.length && !initial && (
            <Choice
              label="Start from"
              value={templateId}
              items={[
                { id: '', name: 'Empty task' },
                ...templates.map((template) => ({ id: template.id, name: template.name })),
              ]}
              onChange={setTemplateId}
            />
          )}
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
