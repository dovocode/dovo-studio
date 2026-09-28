import { mobileWorkflow, nativeEffect } from '../../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect, Schema } from 'effect'
import { useApplicationState } from '../../../runtime/state/application-state'
import { decode, mutableStruct } from '@dovo/protocol'

const describedSchema = mutableStruct({ title: Schema.String, body: Schema.String })
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { Switch } from '../../../ui/controls/switch'
import { pullCreateSchema, pullActionResultSchema, pullCreateOptionsSchema } from '@dovo/protocol'
import { useRuntime } from '../../../runtime/connection/provider'
import { readMobilePreferences } from '../../../runtime/preferences/app-preferences'
import { Sheet } from '../../../ui/layout/sheet'
import { Field } from '../../../ui/controls/field'
import { Choice } from '../../../ui/controls/choice'
import { Action } from '../../../ui/controls/action'
import { Text } from '../../../ui/content/text'
import { styles } from '../../../ui/theme'
export function CreatePull({
  repositoryId: initial,
  onClose,
  onCreated,
}: {
  repositoryId: string
  onClose: () => void
  onCreated: (repositoryId: string, number: number) => void
}) {
  const { read: call, connected, snapshot, callEffect } = useRuntime()
  const repos = snapshot?.workspace.repositories ?? []
  const [repositoryId, setRepository] = useApplicationState(initial || repos[0]?.id || '')
  const [title, setTitle] = useApplicationState(''),
    [body, setBody] = useApplicationState(''),
    [head, setHead] = useApplicationState(''),
    [base, setBase] = useApplicationState(''),
    // Settings → General → Create pull requests as drafts.
    [draft, setDraft] = useApplicationState(() => readMobilePreferences().pullDraft)
  const [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const pending = useRef(false)
  const [supportsDraft, setSupportsDraft] = useApplicationState(false)
  const [sourceTask, setSourceTask] = useApplicationState('')
  const [describing, setDescribing] = useApplicationState(false)
  const sourceTasks = (snapshot?.workspace.tasks ?? []).filter(
    (task) => task.repositoryId === repositoryId && task.workItem && task.checkoutBranch,
  )
  useEffect(() => {
    let active = true
    setSupportsDraft(false)
    setDraft(readMobilePreferences().pullDraft)
    if (repositoryId)
      void runClientEffect(
        callEffect(
          '/api/scm/pulls/options/read',
          {
            repositoryId,
          },
          pullCreateOptionsSchema,
        )
          .pipe(
            Effect.flatMap((value) =>
              nativeEffect(() => {
                if (active) setSupportsDraft(value.draft)
              }),
            ),
          )
          .pipe(
            Effect.catchAll((cause) =>
              nativeEffect(() => {
                if (active) setError(String(cause))
              }),
            ),
          ),
      )
    return () => {
      active = false
    }
  }, [call, repositoryId])
  const submit = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (pending.current) return
        pending.current = true
        setBusy(true)
        setError('')
        return yield* mobileWorkflow(function* () {
          const input = decode(pullCreateSchema, {
            title,
            body,
            head,
            base,
            draft,
          })
          const result = yield* callEffect(
            '/api/scm/pulls/create',
            {
              repositoryId,
              ...input,
            },
            pullActionResultSchema,
          )
          onCreated(repositoryId, result.number)
        }).pipe(
          Effect.catchAll((cause) =>
            nativeEffect(() => {
              setError(cause instanceof Error ? cause.message : String(cause))
            }),
          ),
          Effect.ensuring(
            nativeEffect(() => {
              pending.current = false
              setBusy(false)
            }).pipe(Effect.orDie),
          ),
        )
      }),
    )
  }
  return (
    <Sheet title="Create pull request" onClose={onClose} busy={busy}>
      <Choice
        label="Project"
        value={repositoryId}
        onChange={(id) => {
          setRepository(id)
          setSourceTask('')
        }}
        disabled={busy}
        items={repos.map((repo) => ({
          id: repo.id,
          name: repo.name,
        }))}
      />
      <Field label="Title" value={title} onChangeText={setTitle} editable={!busy} />
      <Action
        secondary
        label={describing ? 'Writing…' : 'Write title and description'}
        disabled={busy || describing || !connected || !head.trim() || !base.trim()}
        onPress={() => {
          setDescribing(true)
          setError('')
          void runClientEffect(
            callEffect(
              '/api/scm/pulls/describe',
              { repositoryId, head, base, ...(sourceTask ? { taskId: sourceTask } : {}) },
              describedSchema,
            ).pipe(
              Effect.tap((result) =>
                Effect.sync(() => {
                  setTitle(result.title)
                  setBody(result.body)
                }),
              ),
              Effect.catchAll((cause) => Effect.sync(() => setError(String(cause)))),
              Effect.ensuring(Effect.sync(() => setDescribing(false))),
            ),
          )
        }}
      />
      {!!sourceTasks.length && (
        <Choice
          row
          label="From task"
          value={sourceTask}
          disabled={busy}
          items={[
            {
              id: '',
              name: 'Choose a task…',
            },
            ...sourceTasks.map((task) => ({
              id: task.id,
              name: task.title,
            })),
          ]}
          onChange={(id) => {
            setSourceTask(id)
            const task = sourceTasks.find((task) => task.id === id)
            if (!task?.workItem || !task.checkoutBranch) return
            setTitle(task.workItem.title)
            setHead(task.checkoutBranch)
            setBody(
              `Related ${task.workItem.kind === 'issue' ? 'issue' : 'pipeline'}: ${task.workItem.url}\n\n`,
            )
          }}
        />
      )}
      <Field
        label="Source branch"
        value={head}
        onChangeText={setHead}
        editable={!busy}
        placeholder="feature/my-change"
      />
      <Field
        label="Target branch"
        value={base}
        onChangeText={setBase}
        editable={!busy}
        placeholder="main"
      />
      <Text style={styles.muted}>
        Use branches already pushed to this project. Creating a PR does not push local commits.
      </Text>
      <Field
        label="Description"
        value={body}
        onChangeText={setBody}
        editable={!busy}
        multiline
        style={{
          minHeight: 130,
          textAlignVertical: 'top',
        }}
      />
      {supportsDraft && (
        <View
          style={[
            styles.row,
            {
              justifyContent: 'space-between',
            },
          ]}
        >
          <Text style={styles.text}>Draft</Text>
          <Switch
            accessibilityLabel="Draft pull request"
            value={draft}
            onValueChange={setDraft}
            disabled={busy}
          />
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        label={busy ? 'Creating…' : 'Create pull request'}
        disabled={busy || !connected || !repositoryId}
        onPress={() => void submit()}
      />
    </Sheet>
  )
}
