import { mobileWorkflow, nativeEffect } from '../runtime/native-effect'
import { useApplicationState } from '../runtime/application-state'
import { decode } from '@dovo/protocol'
import { appendUniqueRows, RequestScope, runClientEffect } from '@dovo/client-runtime'
import { useEffect, useRef } from 'react'
import { Schema, Effect } from 'effect'
import {
  forgeWorkOptionsSchema,
  issueEditInput,
  forgeDefinitionsSchema,
  forgeWorkResultSchema,
  forgeIssueCreateSchema,
  forgeIssueActionSchema,
  forgePipelineActionSchema,
  type ForgeIssueDetail,
  type ForgeWorkOptions,
  type ForgeWorkResult,
} from '@dovo/protocol'
import { useRuntime } from '../runtime/provider'
import { useNavigation } from '../shell/navigation'
import { Text } from '../ui/text'
import { styles } from '../ui/theme'
import { Choice } from '../ui/choice'
import { Action } from '../ui/action'
import { Field } from '../ui/field'
import { Sheet } from '../ui/sheet'
export function WorkForm({
  kind,
  repositoryId,
  jiraSourceId,
  issue: initialIssue,
  options,
  initialDefinition,
  initialRef,
  disabled,
  onClose,
  onDone,
}: {
  kind: 'create' | 'edit' | 'comment' | 'run' | 'transition'
  repositoryId?: string
  jiraSourceId?: string
  issue?: ForgeIssueDetail['issue']
  options: ForgeWorkOptions
  initialDefinition?: string
  initialRef?: string
  disabled: boolean
  onClose: () => void
  onDone: (message: string, result?: ForgeWorkResult) => void
}) {
  const { read, connected, readEffect } = useRuntime()
  const { focused } = useNavigation()
  const [issue] = useApplicationState(initialIssue)
  const available =
    kind === 'run'
      ? options.pipelines && options.pipelineActions.includes('run')
      : options.issues &&
        (kind === 'create' || !!issue) &&
        (kind !== 'transition' || options.provider === 'jira')
  const [title, setTitle] = useApplicationState(kind === 'edit' ? (issue?.title ?? '') : ''),
    [body, setBody] = useApplicationState(kind === 'edit' ? (issue?.body ?? '') : '')
  const [type, setType] = useApplicationState(
      options.issueTypes[0] ?? (options.provider === 'jira' ? 'Task' : 'Issue'),
    ),
    [state, setState] = useApplicationState(issue?.state ?? '')
  const [assignees, setAssignees] = useApplicationState(issue?.assignees.join(', ') ?? ''),
    [labels, setLabels] = useApplicationState(issue?.labels.join(', ') ?? '')
  const [definition, setDefinition] = useApplicationState(initialDefinition ?? ''),
    [ref, setRef] = useApplicationState(initialRef ?? ''),
    [inputs, setInputs] = useApplicationState('{}')
  const [definitions, setDefinitions] = useApplicationState<
    Schema.Schema.Type<typeof forgeDefinitionsSchema> | undefined
  >(undefined)
  const [definitionsLoading, setDefinitionsLoading] = useApplicationState(kind === 'run')
  const [definitionsRevision, retryDefinitions] = useApplicationState(0)
  const definitionRequests = useRef(new RequestScope())
  const definitionPending = useRef(false)
  const [issueStates, setIssueStates] = useApplicationState(options.issueStates)
  useEffect(() => {
    if (kind !== 'edit' || options.provider !== 'azure-devops' || !issue) return
    let current = true
    void runClientEffect(
      readEffect(
        '/api/scm/work/options',
        {
          repositoryId,
          type: issue.type,
          area: 'issues',
        },
        forgeWorkOptionsSchema,
      )
        .pipe(
          Effect.flatMap((v) =>
            nativeEffect(() => {
              if (current) setIssueStates(v.issueStates)
            }),
          ),
        )
        .pipe(
          Effect.catchAll((e) =>
            nativeEffect(() => {
              if (current) setError(String(e))
            }),
          ),
        ),
    )
    return () => {
      current = false
    }
  }, [kind, options.provider, issue, repositoryId, read])
  const [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const pending = useRef(false)
  useEffect(() => {
    if (kind !== 'run') return
    const current = definitionRequests.current.begin()
    definitionPending.current = true
    setDefinitionsLoading(true)
    setError('')
    void runClientEffect(
      readEffect(
        '/api/scm/work/pipelines/definitions',
        {
          repositoryId,
        },
        forgeDefinitionsSchema,
      )
        .pipe(
          Effect.flatMap((value) =>
            nativeEffect(() => {
              if (current()) {
                setDefinitions(value)
                setDefinition((chosen) => chosen || value.items[0]?.id || '')
              }
            }),
          ),
        )
        .pipe(
          Effect.catchAll((error) =>
            nativeEffect(() => {
              if (current()) setError(error instanceof Error ? error.message : String(error))
            }),
          ),
        )
        .pipe(
          Effect.ensuring(
            nativeEffect(() => {
              if (current()) {
                definitionPending.current = false
                setDefinitionsLoading(false)
              }
            }).pipe(Effect.orDie),
          ),
        ),
    )
    return () => definitionRequests.current.cancel()
  }, [kind, repositoryId, read, definitionsRevision])
  const moreDefinitions = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (!definitions?.next || definitionPending.current || busy || !connected) return
        definitionPending.current = true
        const current = definitionRequests.current.begin()
        setDefinitionsLoading(true)
        setError('')
        return yield* mobileWorkflow(function* () {
          const value = yield* readEffect(
            '/api/scm/work/pipelines/definitions',
            {
              repositoryId,
              cursor: definitions.next,
            },
            forgeDefinitionsSchema,
          )
          if (current())
            setDefinitions({
              ...value,
              items: appendUniqueRows(definitions.items, value.items),
            })
        }).pipe(
          Effect.catchAll((error) =>
            nativeEffect(() => {
              if (current()) setError(error instanceof Error ? error.message : String(error))
            }),
          ),
          Effect.ensuring(
            nativeEffect(() => {
              if (current()) {
                definitionPending.current = false
                setDefinitionsLoading(false)
              }
            }).pipe(Effect.orDie),
          ),
        )
      }),
    )
  }
  const split = (v: string) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  const submit = () => {
    return runClientEffect(
      mobileWorkflow(function* () {
        if (
          pending.current ||
          ((kind === 'create' || kind === 'edit') && !title.trim()) ||
          (kind === 'comment' && !body.trim()) ||
          (kind === 'transition' && (!state.trim() || state === issue?.state)) ||
          disabled ||
          !available ||
          !focused ||
          !connected ||
          (kind === 'run' && (!definitions || definitionPending.current))
        )
          return
        pending.current = true
        setBusy(true)
        setError('')
        return yield* mobileWorkflow(function* () {
          const data =
            kind === 'transition'
              ? {
                  action: 'edit',
                  id: issue?.id,
                  revision: issue?.revision,
                  state,
                }
              : kind === 'run'
                ? {
                    action: 'run',
                    definition,
                    ref,
                    inputs: decode(
                      Schema.mutable(
                        Schema.Record({
                          key: Schema.String,
                          value: Schema.String,
                        }),
                      ),
                      JSON.parse(inputs),
                    ),
                  }
                : kind === 'comment'
                  ? {
                      action: 'comment',
                      id: issue?.id,
                      revision: issue?.revision,
                      body,
                    }
                  : kind === 'edit' && issue
                    ? issueEditInput(issue, {
                        title,
                        body,
                        state,
                        ...(options.assignees
                          ? {
                              assignees: split(assignees),
                            }
                          : {}),
                        ...(options.labels
                          ? {
                              labels: split(labels),
                            }
                          : {}),
                      })
                    : {
                        title,
                        body,
                        type,
                        assignees: split(assignees),
                        labels: split(labels),
                      }
          const result = yield* readEffect(
            '/api/scm/work/' +
              (kind === 'run'
                ? 'pipelines/action'
                : kind === 'create'
                  ? 'issues/create'
                  : 'issues/action'),
            {
              ...(jiraSourceId
                ? {
                    jiraSourceId,
                  }
                : {
                    repositoryId,
                  }),
              ...(kind === 'run'
                ? decode(forgePipelineActionSchema, data)
                : kind === 'create'
                  ? decode(forgeIssueCreateSchema, data)
                  : decode(forgeIssueActionSchema, data)),
            },
            forgeWorkResultSchema,
          )
          onDone(result.message, result)
        }).pipe(
          Effect.catchAll((e) =>
            nativeEffect(() => {
              setError(e instanceof Error ? e.message : String(e))
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
    <Sheet
      title={
        kind === 'transition'
          ? 'Change Jira status'
          : kind === 'run'
            ? 'Run pipeline'
            : kind === 'comment'
              ? 'Add comment'
              : kind === 'edit'
                ? 'Edit issue'
                : 'New issue'
      }
      onClose={onClose}
      busy={busy}
    >
      {kind === 'transition' ? (
        <>
          <Text style={styles.muted}>
            Current status: {issue?.state}. Enter a status available in this project’s workflow.
          </Text>
          <Field
            label="New Jira status"
            value={state}
            onChangeText={setState}
            editable={!busy}
            placeholder="In Progress"
          />
        </>
      ) : kind === 'run' ? (
        <>
          {definitions?.manual ? (
            <Field
              label="Pipeline"
              value={definition}
              onChangeText={setDefinition}
              editable={!busy}
            />
          ) : (
            <Choice
              label="Pipeline"
              value={definition}
              onChange={setDefinition}
              disabled={busy}
              items={
                definitions?.items.map((d) => ({
                  id: d.id,
                  name: d.name,
                })) ?? []
              }
            />
          )}
          <Text style={styles.muted}>{definitions?.hint}</Text>
          {definitions?.next && (
            <Action
              label="More pipelines"
              secondary
              disabled={busy || definitionsLoading || !connected}
              onPress={() => void moreDefinitions()}
            />
          )}
          {!definitions && !definitionsLoading && (
            <Action
              secondary
              label="Retry pipelines"
              disabled={!connected || busy}
              onPress={() => retryDefinitions((value) => value + 1)}
            />
          )}
          <Field label="Branch or ref" value={ref} onChangeText={setRef} editable={!busy} />
          <Field
            label="Inputs (JSON string values)"
            value={inputs}
            onChangeText={setInputs}
            editable={!busy}
            multiline
          />
        </>
      ) : (
        <>
          {kind !== 'comment' && (
            <Field label="Title" value={title} onChangeText={setTitle} editable={!busy} />
          )}
          <Field
            label={
              kind === 'edit' && issue?.bodyFormat === 'html'
                ? 'Description (original HTML)'
                : kind === 'comment'
                  ? 'Comment'
                  : 'Description'
            }
            value={body}
            onChangeText={setBody}
            multiline
            style={{
              minHeight: 140,
              textAlignVertical: 'top',
            }}
            editable={!busy}
          />
          {kind === 'create' && options.provider === 'jira' && options.issueTypes.length === 0 && (
            <Field
              label="Issue type"
              value={type}
              onChangeText={setType}
              editable={!busy}
              placeholder="Task"
            />
          )}
          {kind === 'create' && options.issueTypes.length > 1 && (
            <Choice
              label="Type"
              value={type}
              onChange={setType}
              disabled={busy}
              items={options.issueTypes.map((id) => ({
                id,
                name: id,
              }))}
            />
          )}
          {kind === 'edit' && options.provider !== 'jira' && issueStates.length > 0 && (
            <Choice
              label="State"
              value={state}
              onChange={setState}
              disabled={busy}
              items={issueStates.map((id) => ({
                id,
                name: id,
              }))}
            />
          )}
          {kind !== 'comment' && options.assignees && (
            <Field
              label={
                options.provider === 'jira'
                  ? 'Assignee (account ID)'
                  : 'Assignees (comma separated)'
              }
              value={assignees}
              onChangeText={setAssignees}
              editable={!busy}
            />
          )}
          {kind !== 'comment' && options.labels && (
            <Field
              label="Labels (comma separated)"
              value={labels}
              onChangeText={setLabels}
              editable={!busy}
            />
          )}
        </>
      )}
      {!available && (
        <Text style={styles.muted}>This action is no longer available for this issue source.</Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        label={
          busy
            ? 'Saving…'
            : kind === 'create'
              ? 'Create issue'
              : kind === 'edit'
                ? 'Save changes'
                : kind === 'comment'
                  ? 'Post comment'
                  : kind === 'transition'
                    ? 'Change status'
                    : 'Run pipeline'
        }
        disabled={
          disabled ||
          !available ||
          !focused ||
          !connected ||
          busy ||
          ((kind === 'create' || kind === 'edit') && !title.trim()) ||
          (kind === 'comment' && !body.trim()) ||
          (kind === 'transition' && (!state.trim() || state === issue?.state)) ||
          (kind === 'run' && (!definitions || definitionsLoading))
        }
        onPress={() => void submit()}
      />
    </Sheet>
  )
}
