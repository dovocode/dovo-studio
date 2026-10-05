import { FolderPicker } from './folder-picker'
import { TaskLauncherControls } from './task-launcher-controls'
import { useEffect, useRef } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
} from 'react-native'
import { randomUUID } from 'expo-crypto'
import {
  createLauncherTask,
  dispatchLauncherTask,
  launcherDefaultAgent,
  type LauncherAgent,
  snapshotSchema,
  type LauncherAttempt,
  type RuntimeSnapshot,
} from '@dovo/protocol'
import { useRuntime, RuntimeScope } from '../../runtime/connection/provider'
import { useApplicationState } from '../../runtime/state/application-state'
import { Action } from '../../ui/controls/action'
import { Field } from '../../ui/controls/field'
import { Text } from '../../ui/content/text'
import { ScreenHeader } from '../../ui/layout/screen-header'
import { colors, styles } from '../../ui/theme'
import { taskHref } from '../../shell/task-route'

export function TaskLauncherScreen() {
  const { ready, profiles, activeId, readRuntime, refreshRuntime } = useRuntime()
  const params = useLocalSearchParams<{ text?: string }>()
  const [runtimeId, setRuntimeId] = useApplicationState(activeId ?? '')
  const [snapshot, setSnapshot] = useApplicationState<RuntimeSnapshot | null>(null)
  const [repositoryId, setRepositoryId] = useApplicationState('')
  const [selection, setSelection] = useApplicationState<LauncherAgent | null>(null)
  const [loadedRuntimeId, setLoadedRuntimeId] = useApplicationState('')
  const [text, setText] = useApplicationState(() =>
    typeof params.text === 'string' ? params.text.slice(0, 120000) : '',
  )
  const [loading, setLoading] = useApplicationState(false)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [retry, setRetry] = useApplicationState(0)
  const attempt = useRef<LauncherAttempt | null>(null)
  const submitting = useRef(false)
  useEffect(() => {
    if (ready && !runtimeId) setRuntimeId(activeId ?? profiles[0]?.id ?? '')
  }, [ready, runtimeId, activeId, profiles])
  useEffect(() => {
    if (!ready || attempt.current) return
    const profile = profiles.find((profile) => profile.id === runtimeId)
    let current = true
    setSnapshot(null)
    setError('')
    if (!profile) return
    setLoading(true)
    void readRuntime(profile, '/api/snapshot', undefined, snapshotSchema, 'GET')
      .then(
        (next) => {
          if (!current) return
          setSnapshot(next)
          setRepositoryId((id) =>
            next.workspace.repositories.some((repository) => repository.id === id)
              ? id
              : (next.workspace.repositories.find((repository) => repository.kind === 'scratch')
                  ?.id ??
                next.workspace.repositories[0]?.id ??
                ''),
          )
          setLoadedRuntimeId(runtimeId)
          void refreshRuntime(profile).catch((cause: unknown) => setError(String(cause)))
        },
        (cause: unknown) => {
          if (current) setError(cause instanceof Error ? cause.message : String(cause))
        },
      )
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [ready, runtimeId, profiles, readRuntime, refreshRuntime, retry])
  useEffect(() => {
    if (attempt.current) return
    const repository = snapshot?.workspace.repositories.find((entry) => entry.id === repositoryId)
    setSelection(snapshot && repository ? launcherDefaultAgent(snapshot, repository) : null)
  }, [snapshot, repositoryId])
  const selectedRepository = snapshot?.workspace.repositories.find(
    (entry) => entry.id === repositoryId,
  )
  const dispatch = async () => {
    if (submitting.current) return
    const profile = profiles.find((profile) => profile.id === runtimeId)
    const repository = snapshot?.workspace.repositories.find(
      (repository) => repository.id === repositoryId,
    )
    const agent = loadedRuntimeId === runtimeId ? selection : null
    if (!attempt.current && (!snapshot || !profile || !repository || !agent || !text.trim())) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      if (!attempt.current && snapshot && profile && repository && agent)
        attempt.current = {
          task: createLauncherTask(snapshot, repository, agent, text, randomUUID()),
          profile,
          messageId: randomUUID(),
          text: text.trim(),
          created: false,
        }
      const current = attempt.current
      if (!current) return
      await dispatchLauncherTask(current, readRuntime)
      Keyboard.dismiss()
      // Navigation carries the owning computer, so the thread can reconnect without guessing.
      router.replace(taskHref(current.profile.id, current.task.id))
      void refreshRuntime(current.profile).catch((cause: unknown) =>
        console.error('Could not refresh the dispatched task:', cause),
      )
      attempt.current = null
      setText('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const back = () => {
    if (submitting.current) return
    Keyboard.dismiss()
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }
  const locked = busy || !!attempt.current
  return (
    <View style={styles.screen}>
      <ScreenHeader title="Start a task" onBack={back} gestureEnabled={!busy} />
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.content}
        >
          <Text style={styles.muted}>
            Choose a computer, project, agent and model, then send your idea.
          </Text>
          {!ready ? (
            <ActivityIndicator color={colors.accent} />
          ) : !profiles.length ? (
            <>
              <Text style={styles.title}>Connect a computer</Text>
              <Action
                label="Open computer settings"
                onPress={() => router.push('/settings/devices')}
              />
            </>
          ) : (
            <>
              <RuntimeScope runtimeId={runtimeId}>
                <FolderPicker
                  key={runtimeId}
                  value={repositoryId}
                  repositories={snapshot?.workspace.repositories ?? []}
                  disabled={locked}
                  onChange={(id, _repository, machineId) => {
                    setRuntimeId(machineId)
                    setRepositoryId(id)
                  }}
                  onAdded={(repository, machineId) =>
                    machineId === loadedRuntimeId &&
                    setSnapshot((current) =>
                      current
                        ? {
                            ...current,
                            workspace: {
                              ...current.workspace,
                              repositories: [
                                ...current.workspace.repositories.filter(
                                  (item) => item.id !== repository.id,
                                ),
                                repository,
                              ],
                            },
                          }
                        : current,
                    )
                  }
                />
              </RuntimeScope>
              {loading && <ActivityIndicator color={colors.accent} />}
              {selection && snapshot && selectedRepository && loadedRuntimeId === runtimeId && (
                <RuntimeScope runtimeId={runtimeId}>
                  <TaskLauncherControls
                    selection={selection}
                    onChange={setSelection}
                    snapshot={snapshot}
                    repository={selectedRepository}
                    disabled={locked || loading}
                  />
                </RuntimeScope>
              )}
              {snapshot && !snapshot.workspace.repositories.length && (
                <Text style={styles.muted}>
                  Add a project on this computer before starting a task.
                </Text>
              )}
              <Field
                label="Task prompt"
                placeholder="What would you like to work on?"
                multiline
                value={text}
                onChangeText={setText}
                editable={!locked}
                maxLength={120000}
                autoCapitalize="sentences"
                style={{ minHeight: 150, textAlignVertical: 'top' }}
              />
              {!!error && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {error}
                </Text>
              )}
              {error && !attempt.current && !loading && (
                <Action
                  label="Retry server connection"
                  secondary
                  onPress={() => setRetry((value) => value + 1)}
                />
              )}
              {!!attempt.current && (
                <Text style={styles.muted}>Retry keeps the same task and message.</Text>
              )}
              <Action
                wide
                label={busy ? 'Dispatching…' : attempt.current ? 'Retry dispatch' : 'Start task'}
                disabled={
                  busy ||
                  (!attempt.current &&
                    (!snapshot ||
                      loading ||
                      !repositoryId ||
                      !selection ||
                      loadedRuntimeId !== runtimeId ||
                      !text.trim()))
                }
                onPress={() => void dispatch()}
              />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  )
}
