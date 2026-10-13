import { useCallback, useEffect, useRef } from 'react'
import { View } from 'react-native'
import { Effect, Schema } from 'effect'
import { startPolling } from '@dovo/client-runtime'
import {
  canChangeTaskCheckout,
  gitPrimaryAction,
  mutableStruct,
  responses,
  type Task,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useApplicationState } from '../../runtime/state/application-state'
import { useAppActive } from '../../runtime/state/app-active'
import { nativeEffect } from '../../runtime/state/native-effect'
import { Text } from '../../ui/content/text'
import { openAppLink } from '../../ui/content/open-link'
import { Action } from '../../ui/controls/action'
import { Field } from '../../ui/controls/field'
import { useAction } from '../../ui/controls/use-action'
import { useTheme } from '../../ui/theme'

const messageSchema = mutableStruct({ message: Schema.String })
const commitSchema = mutableStruct({
  commit: Schema.String,
  pushError: Schema.optional(Schema.String),
})
type GitState = Schema.Schema.Type<typeof responses.gitActionState>

export function CommitSection({ task }: { task: Task }) {
  const { styles } = useTheme()
  const { connected, profile, snapshot, readEffect, callEffect } = useRuntime()
  const foreground = useAppActive()
  const { act, busy, error } = useAction()
  const [message, setMessage] = useApplicationState('')
  const [status, setStatus] = useApplicationState('')
  const repo = snapshot?.workspace.repositories.find((item) => item.id === task.repositoryId)
  const ready =
    connected &&
    !!repo &&
    !repo.kind &&
    !task.example &&
    !(task.execution === 'worktree' && !task.existingWorktreePath && canChangeTaskCheckout(task))
  const key = JSON.stringify([
    profile?.id,
    profile?.connection.address,
    task.id,
    task.repositoryId,
    repo?.path,
    task.execution,
    task.existingWorktreePath,
    task.checkoutBranch,
  ])
  const [result, setResult] = useApplicationState<{
    key: string
    state: GitState | null
    error: string
  } | null>(null)
  const target = useRef({ key, readEffect })
  target.current = { key, readEffect }
  const reads = useRef(0)
  const current = result?.key === key ? result : null
  const git = current?.state ?? null
  const refresh = useCallback(
    () =>
      Effect.suspend(() => {
        const read = ++reads.current
        const matches = () =>
          target.current.key === key &&
          target.current.readEffect === readEffect &&
          read === reads.current
        return readEffect(
          '/api/scm/action-state',
          { repositoryId: task.repositoryId, taskId: task.id },
          responses.gitActionState,
        ).pipe(
          Effect.tap((state) =>
            Effect.sync(() => {
              if (matches()) setResult({ key, state, error: '' })
            }),
          ),
          Effect.tapError((cause) =>
            Effect.sync(() => {
              if (matches())
                setResult((previous) => ({
                  key,
                  state: previous?.key === key ? previous.state : null,
                  error: cause.message,
                }))
            }),
          ),
        )
      }),
    [key, readEffect, task.repositoryId, task.id],
  )
  useEffect(() => {
    if (!ready || !foreground) return
    const polling = startPolling(refresh(), {
      interval: 15_000,
      // refresh exposes failures beside the controls for both polling and explicit reads.
      onError: () => {},
    })
    return () => {
      void polling.stop()
    }
  }, [ready, foreground, refresh])
  const idle = ready && !!git && !current?.error && !busy && task.status !== 'running'
  const pullUrl = task.pullRequest?.url ?? task.linkedPullRequests?.[0]?.url
  const primary = gitPrimaryAction(git, !!pullUrl)
  const commit = (push: boolean) =>
    act(() =>
      (message.trim()
        ? Effect.succeed({ message: message.trim() })
        : callEffect('/api/tasks/commit-message', { id: task.id }, messageSchema)
      ).pipe(
        Effect.flatMap(({ message }) =>
          callEffect('/api/tasks/commit', { id: task.id, message, push }, commitSchema),
        ),
        Effect.tap((value) =>
          Effect.sync(() => {
            setMessage('')
            setStatus(
              value.pushError
                ? `Committed ${value.commit.slice(0, 8)}, but push failed: ${value.pushError}`
                : `Committed ${value.commit.slice(0, 8)}${push ? ' and pushed' : ''}.`,
            )
          }),
        ),
        Effect.ensuring(refresh().pipe(Effect.catch(() => Effect.void))),
      ),
    )
  const push = () =>
    act(() =>
      callEffect(
        '/api/scm/push',
        { repositoryId: task.repositoryId, taskId: task.id },
        responses.ok,
      ).pipe(
        Effect.tap(() => Effect.sync(() => setStatus('Branch pushed'))),
        Effect.ensuring(refresh().pipe(Effect.catch(() => Effect.void))),
      ),
    )
  const primaryAction = () => {
    setStatus('')
    if (primary === 'Open PR' && pullUrl) act(() => nativeEffect(() => openAppLink(pullUrl)))
    else if (primary === 'Push branch') push()
    else commit(primary === 'Commit & push')
  }
  if (!repo || repo.kind || task.example) return null
  return (
    <View style={[styles.card, { gap: 8 }]}>
      <Field
        label="Commit message"
        value={message}
        onChangeText={setMessage}
        multiline
        maxLength={4000}
        editable={!busy}
      />
      <View style={styles.row}>
        <Action
          secondary
          label="Write message"
          disabled={!idle || !git?.dirty}
          onPress={() =>
            act(() =>
              callEffect('/api/tasks/commit-message', { id: task.id }, messageSchema).pipe(
                Effect.tap((value) => Effect.sync(() => setMessage(value.message))),
              ),
            )
          }
        />
        <Action
          secondary
          label="Commit all"
          disabled={!idle || !git?.dirty || !message.trim()}
          onPress={() => {
            setStatus('')
            commit(false)
          }}
        />
        <Action
          label={busy ? 'Working…' : primary}
          icon={primary === 'Open PR' ? 'pulls' : 'changes'}
          disabled={
            primary === 'Open PR' ? busy : !idle || (!git?.dirty && primary !== 'Push branch')
          }
          onPress={primaryAction}
        />
        <Action
          secondary
          label="Refresh Git status"
          icon="refresh"
          disabled={!ready || busy}
          onPress={() => act(refresh)}
        />
      </View>
      {!git && (
        <Text style={styles.muted}>
          {ready ? 'Checking Git status…' : 'Git checkout is unavailable.'}
        </Text>
      )}
      {git && !git.dirty && primary !== 'Push branch' && primary !== 'Open PR' && (
        <Text style={styles.muted}>
          {git.behind
            ? 'Branch is behind its upstream. Update it before pushing.'
            : 'No changes to commit or push.'}
        </Text>
      )}
      {!!status && <Text style={styles.muted}>{status}</Text>}
      {!!(error || current?.error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error || current?.error}
        </Text>
      )}
    </View>
  )
}
