import { nativeEffect, mobileWorkflow } from '../runtime/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { useApplicationState } from '../runtime/application-state'
import { BranchPicker } from './branch-picker'
import { Linking, View } from 'react-native'
import { Text } from '../ui/text'
import { Schema } from 'effect'
import { responses, type Repository, type ChangedFile } from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { Action } from '../ui/action'
import { styles } from '../ui/theme'
import { useAction } from '../ui/use-action'
import { Field } from '../ui/field'
import { useNavigation } from '../shell/navigation'
export function RepositoryCard({
  repository,
  taskId,
}: {
  repository: Repository
  taskId?: string
}) {
  const { openWork } = useNavigation()
  const { connected, callEffect } = useRuntime(),
    { busy, error, act } = useAction(),
    [checkout, setCheckout] = useApplicationState(''),
    [files, setFiles] = useApplicationState<ChangedFile[] | null>(null),
    [message, setMessage] = useApplicationState(''),
    [result, setResult] = useApplicationState(''),
    [pulls, setPulls] = useApplicationState<Schema.Schema.Type<typeof responses.pulls>['pulls']>([])
  const input = {
    repositoryId: repository.id,
    ...(taskId
      ? {
          taskId,
        }
      : {}),
  }
  const refresh = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        const inspected = yield* callEffect('/api/scm/inspect', input, responses.inspected)
        setCheckout(`${inspected.path} · ${inspected.branch}`)
        setFiles((yield* callEffect('/api/scm/changes', input, responses.files)).files)
      }),
    )
  }
  return (
    <View style={styles.card}>
      <Text style={styles.text}>{repository.name}</Text>
      <Text selectable style={styles.muted}>
        {checkout ||
          (taskId
            ? 'Task worktree · refresh to inspect'
            : `${repository.path} · ${repository.branch}`)}
      </Text>
      <BranchPicker
        repositoryId={repository.id}
        taskId={taskId}
        onChanged={() => {
          setFiles(null)
          setCheckout('')
        }}
      />
      <View style={styles.row}>
        <Action
          secondary
          label="Issues"
          onPress={() =>
            openWork({
              repositoryId: repository.id,
              kind: 'issue',
            })
          }
        />
        <Action
          secondary
          label="Refresh Git"
          disabled={!connected || busy}
          onPress={() => act(refresh)}
        />
        <Action
          secondary
          label="Pull requests"
          disabled={!connected || busy}
          onPress={() =>
            act(() =>
              mobileWorkflow(function* () {
                return setPulls((yield* callEffect('/api/scm/pulls', input, responses.pulls)).pulls)
              }),
            )
          }
        />
      </View>
      {files?.map((file) => (
        <Text key={file.path} style={styles.muted}>
          {file.path}
        </Text>
      ))}
      {files !== null && (
        <>
          <Action
            secondary
            label={`Stage ${files.length} files`}
            disabled={!connected || busy || !files.length}
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  yield* callEffect(
                    '/api/scm/stage',
                    {
                      ...input,
                      paths: files.map((f) => f.path),
                    },
                    responses.ok,
                  )
                  setResult('Files staged')
                }),
              )
            }
          />
          <Field label="Commit message" value={message} onChangeText={setMessage} />
          <Action
            label="Commit staged changes"
            disabled={!connected || busy || !message.trim()}
            onPress={() =>
              act(() =>
                mobileWorkflow(function* () {
                  const result = yield* callEffect(
                    '/api/scm/commit',
                    {
                      ...input,
                      message,
                    },
                    responses.commit,
                  )
                  setResult(`Committed ${result.commit.slice(0, 8)}`)
                  setMessage('')
                  yield* nativeEffect(() => refresh())
                }),
              )
            }
          />
        </>
      )}
      {pulls.map((pr) => (
        <Action
          key={pr.number}
          secondary
          label={`#${pr.number} ${pr.title}`}
          onPress={() => act(() => Linking.openURL(pr.url))}
        />
      ))}
      {!!result && <Text style={styles.muted}>{result}</Text>}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  )
}
