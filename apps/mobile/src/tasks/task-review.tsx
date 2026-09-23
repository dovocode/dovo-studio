import { nativeEffect, mobileWorkflow } from '../runtime/native-effect'
import { useApplicationState } from '../runtime/application-state'
import { mutableStruct } from '@dovo/protocol'
import { Choice } from '../ui/choice'
import { useMemo } from 'react'
import { ScrollView, View } from 'react-native'
import { Text } from '../ui/text'
import { createTwoFilesPatch, FILE_HEADERS_ONLY } from 'diff'
import { Schema } from 'effect'
import { responses, type Task } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { Field } from '../ui/field'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import { DiffView } from './diff-view'
export function TaskReview({
  task,
  initialCheckpoint = '',
}: {
  task: Task
  initialCheckpoint?: string
}) {
  const { call, connected, callEffect } = useRuntime(),
    { busy, error, act } = useAction()
  const [checkpoint, setCheckpoint] = useApplicationState(initialCheckpoint)
  const history = task.turns?.find((turn) => turn.id === checkpoint)?.checkpoint
  const files = checkpoint ? (history?.files ?? []) : task.files
  const [path, setPath] = useApplicationState(''),
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
              const parts = entry.path.split('/')
              const name = parts.pop() ?? entry.path
              return {
                id: entry.path,
                name: `${entry.viewed ? '✓ ' : ''}${name}${parts.length ? ` · ${parts.join('/')}` : ''}`,
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
