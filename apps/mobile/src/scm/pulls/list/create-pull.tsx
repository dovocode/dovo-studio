import {
  pullPageSchema,
  pullDetailSchema,
  pullHeadBranch,
  type PullDetail,
  type PullSummary,
} from '@dovo/protocol'
import { mobileWorkflow, nativeEffect } from '../../../runtime/state/native-effect'
import { runClientEffect } from '@dovo/client-runtime'
import { Effect, Schema } from 'effect'
import { useApplicationState } from '../../../runtime/state/application-state'
import { decode, mutableStruct } from '@dovo/protocol'

const describedSchema = mutableStruct({ title: Schema.String, body: Schema.String })
import {
  createDetailDrafts,
  integrationDraftKey,
  useDetailDraft,
} from '../../../runtime/state/detail-drafts'
import { useEffect, useRef } from 'react'
import { View } from 'react-native'
import { Switch } from '../../../ui/controls/switch'
import { pullCreateSchema, pullActionResultSchema, pullCreateOptionsSchema } from '@dovo/protocol'
import { useSourceReader } from '../../source-reader'
import { useRuntime } from '../../../runtime/connection/provider'
import { readMobilePreferences } from '../../../runtime/preferences/app-preferences'
import { Sheet, type SheetHandle } from '../../../ui/layout/sheet'
import { Field } from '../../../ui/controls/field'
import { Choice } from '../../../ui/controls/choice'
import { Action } from '../../../ui/controls/action'
import { Text } from '../../../ui/content/text'
import { useTheme } from '../../../ui/theme'
type ParentDraft = Pick<PullDetail['pull'], 'number' | 'title' | 'head' | 'url' | 'headSha'>
const createDrafts = createDetailDrafts<{
  repositoryId: string
  expectedDestination: string | undefined
  title: string
  body: string
  head: string
  base: string
  draft: boolean
  parent: ParentDraft | undefined
  sourceTask: string
}>()
const parentDraft = (pull: ParentDraft): ParentDraft => ({
  number: pull.number,
  title: pull.title,
  head: pull.head,
  url: pull.url,
  headSha: pull.headSha,
})
export function CreatePull({
  repositoryId: initial,
  initialParent,
  onClose,
  onCreated,
}: {
  initialParent?: PullDetail['pull']
  repositoryId: string
  onClose: () => void
  onCreated: (repositoryId: string, number: number) => void
}) {
  const { styles } = useTheme()

  const { connected, snapshot, callEffect, connection } = useRuntime()
  const repos = snapshot?.workspace.repositories ?? []
  const {
    draft: fields,
    setField,
    clear,
  } = useDetailDraft(
    createDrafts,
    useRef(
      integrationDraftKey(
        connection,
        snapshot,
        initial || repos[0]?.id,
        undefined,
        'create-pull',
        initialParent?.destination,
        initialParent?.number,
        repos.map((repo) => [repo.id, repo.forge] as const).sort(([a], [b]) => a.localeCompare(b)),
      ),
    ).current,
    () => ({
      repositoryId: initial || repos[0]?.id || '',
      expectedDestination: initialParent?.destination,
      title: '',
      body: '',
      head: '',
      base: initialParent ? (pullHeadBranch(initialParent) ?? '') : '',
      draft: readMobilePreferences().pullDraft,
      parent: initialParent ? parentDraft(initialParent) : undefined,
      sourceTask: '',
    }),
  )
  const { repositoryId, expectedDestination, title, body, head, base, draft, parent, sourceTask } =
    fields
  const source = useSourceReader(repositoryId)
  const read = source.read
  useEffect(() => {
    if (expectedDestination === undefined && source.identity)
      setField('expectedDestination', source.identity.destination)
  }, [expectedDestination, source.identity?.destination])
  const setRepository = (value: string) => setField('repositoryId', value)
  const setTitle = (value: string) => setField('title', value)
  const setBody = (value: string) => setField('body', value)
  const setHead = (value: string) => setField('head', value)
  const setBase = (value: string) => setField('base', value)
  const setDraft = (value: boolean) => setField('draft', value)
  const setParent = (value: ParentDraft | undefined) =>
    setField('parent', value ? parentDraft(value) : undefined)
  const setSourceTask = (value: string) => setField('sourceTask', value)
  const sheet = useRef<SheetHandle>(null)
  const [parents, setParents] = useApplicationState<PullSummary[]>([])
  const [parentBusy, setParentBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const pending = useRef(false)
  const [supportsDraft, setSupportsDraft] = useApplicationState(false)
  const [describing, setDescribing] = useApplicationState(false)
  const sourceTasks = (snapshot?.workspace.tasks ?? []).filter(
    (task) => task.repositoryId === repositoryId && task.workItem && task.checkoutBranch,
  )
  useEffect(() => {
    let active = true
    setSupportsDraft(false)
    if (repositoryId && connected)
      void runClientEffect(
        source
          .readEffect(
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
            Effect.catch((cause) =>
              nativeEffect(() => {
                if (active) setError(String(cause))
              }),
            ),
          ),
      )
    return () => {
      active = false
    }
  }, [source.readEffect, repositoryId, connected])
  useEffect(() => {
    if (!connected || !repositoryId) return
    let stopped = false
    setParents([])
    void (async () => {
      const loaded: PullSummary[] = []
      for (let page = 1; page <= 10 && !stopped; page++) {
        const result = await read(
          '/api/scm/pulls/overview',
          { repositoryId, state: 'open', page },
          pullPageSchema,
        )
        if (stopped) return
        loaded.push(...result.pulls.filter((pull) => !!pullHeadBranch(pull)))
        setParents([...loaded])
        if (!result.hasMore || !result.pulls.length) return
      }
      if (!stopped)
        setError(
          'Showing the first 10 pages. Open another parent PR and choose Stack a PR to use it.',
        )
    })().catch((error: unknown) => {
      if (!stopped) setError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      stopped = true
    }
  }, [repositoryId, connected, read])
  const chooseParent = async (value: string) => {
    setError('')
    if (!value) {
      setParent(undefined)
      setBase('')
      return
    }
    setParentBusy(true)
    try {
      const detail = await read(
        '/api/scm/pulls/detail',
        { repositoryId, number: Number(value), refresh: true },
        pullDetailSchema,
      )
      const branch = pullHeadBranch(detail.pull)
      if (!branch || detail.pull.state !== 'open')
        throw new Error('Choose an open PR from this project.')
      setParent(detail.pull)
      setBase(branch)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setParentBusy(false)
    }
  }
  const submit = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (pending.current || parentBusy || !connected || !source.ready) return
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
            ...(parent ? { parentNumber: parent.number, parentHeadSha: parent.headSha } : {}),
          })
          const result = yield* callEffect(
            '/api/scm/pulls/create',
            {
              repositoryId,
              ...input,
              expectedDestination,
            },
            pullActionResultSchema,
          )
          clear()
          sheet.current?.dismiss(() => onCreated(repositoryId, result.number))
        }).pipe(
          Effect.catch((cause) =>
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
    <Sheet ref={sheet} title="Create pull request" onClose={onClose} busy={busy}>
      <Choice
        label="Project"
        value={repositoryId}
        onChange={(id) => {
          setRepository(id)
          setField('expectedDestination', undefined)
          setSourceTask('')
          setParent(undefined)
          setBase('')
        }}
        disabled={busy || parentBusy}
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
            source
              .readEffect(
                '/api/scm/pulls/describe',
                { repositoryId, head, base, ...(sourceTask ? { taskId: sourceTask } : {}) },
                describedSchema,
              )
              .pipe(
                Effect.tap((result) =>
                  Effect.sync(() => {
                    setTitle(result.title)
                    setBody(result.body)
                  }),
                ),
                Effect.catch((cause) => Effect.sync(() => setError(String(cause)))),
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
      <Text style={styles.muted}>Stack on a PR (optional)</Text>
      <Choice
        value={String(parent?.number ?? '')}
        disabled={busy || parentBusy}
        onChange={(value) => void chooseParent(value)}
        label="Parent pull request"
        items={[
          { id: '', name: 'Independent PR' },
          ...[
            ...new Map(
              [...(parent ? [parent] : []), ...parents].map((pull) => [pull.number, pull]),
            ).values(),
          ].map((pull) => ({ id: String(pull.number), name: `#${pull.number} · ${pull.title}` })),
        ]}
      />
      <Text style={styles.muted}>
        The next PR targets the parent’s branch, keeping its changes separate.
      </Text>
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
        onChangeText={(value) => {
          setParent(undefined)
          setBase(value)
        }}
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
        disabled={busy || parentBusy || !source.ready || !connected || !repositoryId}
        onPress={() => void submit()}
      />
    </Sheet>
  )
}
