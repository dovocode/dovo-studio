import { fileStats } from '../files/stats'
import { nativeEffect, mobileWorkflow } from '../../runtime/state/native-effect'
import { useApplicationState } from '../../runtime/state/application-state'
import { mutableStruct } from '@dovo/protocol'
import { Choice } from '../../ui/controls/choice'
import { useMemo } from 'react'
import { Alert, ScrollView, View } from 'react-native'
import { Text } from '../../ui/content/text'
import { createTwoFilesPatch, FILE_HEADERS_ONLY } from 'diff'
import { Effect, Schema } from 'effect'
import { responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { Action } from '../../ui/controls/action'
import { Field } from '../../ui/controls/field'
import { styles } from '../../ui/theme'
import { useAction } from '../../ui/controls/use-action'
import { DiffView } from '../preview/diff-view'
export function TaskReview({
  task,
  initialCheckpoint = '',
  initialPath = '',
}: {
  task: Task
  initialCheckpoint?: string
  initialPath?: string
}) {
  const { call, connected, callEffect } = useRuntime(),
    { busy, error, act } = useAction()
  const [checkpoint, setCheckpoint] = useApplicationState(initialCheckpoint)
  const history = task.turns?.find((turn) => turn.id === checkpoint)?.checkpoint
  const files = checkpoint ? (history?.files ?? []) : task.files
  const [path, setPath] = useApplicationState(initialPath),
    [edit, setEdit] = useApplicationState<{
      path: string
      contents: string
      expected: string
    } | null>(null)
  const file = files.find((file) => file.path === path) ?? files[0]
  const patch = useMemo(
    () =>
      file
        ? createTwoFilesPatch(file.path, file.path, file.before, file.after, undefined, undefined, {
            headerOptions: FILE_HEADERS_ONLY,
          })
        : '',
    [file],
  )
  const refresh = () =>
    call(
      '/api/scm/changes',
      {
        repositoryId: task.repositoryId,
        taskId: task.id,
      },
      responses.files,
    )
  return (
    <View style={styles.screen}>
      <View
        style={[
          styles.content,
          {
            paddingVertical: 8,
          },
        ]}
      >
        <Choice
          label="Change history"
          value={checkpoint}
          disabled={!!edit}
          items={[
            {
              id: '',
              name: 'Current changes',
            },
            ...(task.turns ?? [])
              .filter((turn) => turn.checkpoint)
              .map((turn, index) => ({
                id: turn.id,
                name: `Turn ${index + 1} · ${turn.status} · ${turn.checkpoint?.files.length ?? 0} files`,
              })),
          ]}
          onChange={(value) => {
            setCheckpoint(value)
            setPath('')
          }}
        />
        {!!history?.error && <Text style={styles.error}>{history.error}</Text>}
        {!!history?.omitted.length && (
          <Text style={styles.muted}>Not included: {history.omitted.join(', ')}</Text>
        )}
        {!!checkpoint && (
          <Text style={styles.muted}>
            Snapshot diff for this turn. Select Current changes to edit files.
          </Text>
        )}
        {!checkpoint && !!task.files.length && <CommitSection task={task} />}
        <View style={styles.row}>
          <Action
            secondary
            label="Refresh changes"
            disabled={!connected || busy || task.example || !!edit || !!checkpoint}
            onPress={() => act(refresh)}
          />
          {file && (
            <Action
              label={edit ? 'Cancel edit' : 'Edit file'}
              secondary
              disabled={busy || !!checkpoint}
              onPress={() =>
                setEdit(
                  edit
                    ? null
                    : {
                        path: file.path,
                        contents: file.after,
                        expected: file.diskContents ?? file.after,
                      },
                )
              }
            />
          )}
          {file && !edit && (!checkpoint || !history?.undone) && (
            <Action
              secondary
              label={checkpoint ? 'Revert this file' : 'Discard file changes'}
              disabled={!connected || busy || task.example || task.status === 'running'}
              onPress={() =>
                Alert.alert(
                  checkpoint ? 'Revert this file?' : 'Discard changes to this file?',
                  checkpoint
                    ? `${file.path} goes back to how it was before this turn. The current file is saved first.`
                    : `${file.path} goes back to the last commit. The current file is saved first, so this can be recovered.`,
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: checkpoint ? 'Revert' : 'Discard',
                      style: 'destructive',
                      onPress: () =>
                        act(() =>
                          callEffect(
                            '/api/tasks/file/restore',
                            {
                              id: task.id,
                              path: file.path,
                              ...(checkpoint ? { turnId: checkpoint } : {}),
                            },
                            responses.ok,
                          ),
                        ),
                    },
                  ],
                )
              }
            />
          )}
          {file && !edit && (
            <Action
              secondary
              label={file.viewed ? 'Viewed' : 'Mark viewed'}
              disabled={!connected || busy || !!checkpoint}
              onPress={() =>
                act(() =>
                  callEffect(
                    '/api/workspace',
                    {
                      collection: 'tasks',
                      id: task.id,
                      changes: {
                        files: {
                          before: task.files,
                          after: task.files.map((f) =>
                            f.path === file.path
                              ? {
                                  ...f,
                                  viewed: !f.viewed,
                                }
                              : f,
                          ),
                        },
                      },
                    },
                    mutableStruct({
                      revision: Schema.Number.pipe(Schema.finite()),
                    }),
                    'PATCH',
                  ),
                )
              }
            />
          )}
        </View>
      </View>
      {!!files.length && (
        <View
          style={{
            paddingHorizontal: 16,
            paddingBottom: 8,
          }}
        >
          <Choice
            label="Changed file"
            value={file?.path ?? ''}
            disabled={!!edit}
            items={files.map((entry) => {
              const stats = fileStats(entry)
              const parts = entry.path.split('/')
              const name = parts.pop() ?? entry.path
              return {
                id: entry.path,
                name: `${entry.viewed ? '✓ ' : ''}${name} +${stats.additions} -${stats.deletions}${parts.length ? ` · ${parts.join('/')}` : ''}`,
              }
            })}
            onChange={setPath}
          />
        </View>
      )}
      {!file && !edit ? (
        <Text style={[styles.muted, styles.content]}>No changed text files.</Text>
      ) : edit ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Field
            label={edit.path}
            value={edit.contents}
            onChangeText={(contents) =>
              setEdit({
                ...edit,
                contents,
              })
            }
            multiline
            autoCorrect={false}
            style={[
              styles.input,
              {
                minHeight: 300,
                fontFamily: 'monospace',
                textAlignVertical: 'top',
              },
            ]}
          />
          <Action
            label="Apply to disk"
            disabled={busy || !connected || task.example}
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  yield* callEffect(
                    '/api/scm/apply',
                    {
                      repositoryId: task.repositoryId,
                      taskId: task.id,
                      path: edit.path,
                      expected: edit.expected,
                      contents: edit.contents,
                    },
                    responses.ok,
                  )
                  setEdit(null)
                  yield* nativeEffect(() => refresh())
                }),
              )
            }
          />
          <Text style={styles.muted}>
            Applies on the connected computer only if the file still matches the loaded baseline.
          </Text>
        </ScrollView>
      ) : (
        <DiffView patch={patch} />
      )}
      {!!error && (
        <Text
          style={[
            styles.error,
            {
              padding: 16,
            },
          ]}
        >
          {error}
        </Text>
      )}
    </View>
  )
}

const messageSchema = mutableStruct({ message: Schema.String })
const commitSchema = mutableStruct({
  commit: Schema.String,
  pushError: Schema.optional(Schema.String),
})
/** Commit everything in the task's checkout, with a message the title model can write. */
function CommitSection({ task }: { task: Task }) {
  const { connected, callEffect } = useRuntime()
  const { act, busy, error } = useAction()
  const [message, setMessage] = useApplicationState('')
  const [status, setStatus] = useApplicationState('')
  const idle = connected && !busy && task.status !== 'running'
  const commit = (push: boolean) =>
    act(() =>
      callEffect('/api/tasks/commit', { id: task.id, message, push }, commitSchema).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            setMessage('')
            setStatus(
              result.pushError
                ? `Committed ${result.commit.slice(0, 8)}, but push failed: ${result.pushError}`
                : `Committed ${result.commit.slice(0, 8)}${push ? ' and pushed' : ''}.`,
            )
          }),
        ),
      ),
    )
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
          disabled={!idle}
          onPress={() =>
            act(() =>
              callEffect('/api/tasks/commit-message', { id: task.id }, messageSchema).pipe(
                Effect.tap((result) => Effect.sync(() => setMessage(result.message))),
              ),
            )
          }
        />
        <Action
          secondary
          label="Commit all"
          disabled={!idle || !message.trim()}
          onPress={() => commit(false)}
        />
        <Action
          label="Commit & push"
          disabled={!idle || !message.trim()}
          onPress={() => commit(true)}
        />
      </View>
      {!!status && <Text style={styles.muted}>{status}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
