import { appendUniqueRows, RequestScope } from '@dovo/client-runtime'
import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
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
  const { read, connected } = useRuntime()
  const { focused } = useNavigation()
  const [issue] = useState(initialIssue)
  const available =
    kind === 'run'
      ? options.pipelines && options.pipelineActions.includes('run')
      : options.issues &&
        (kind === 'create' || !!issue) &&
        (kind !== 'transition' || options.provider === 'jira')
  const [title, setTitle] = useState(kind === 'edit' ? (issue?.title ?? '') : ''),
    [body, setBody] = useState(kind === 'edit' ? (issue?.body ?? '') : '')
  const [type, setType] = useState(
      options.issueTypes[0] ?? (options.provider === 'jira' ? 'Task' : 'Issue'),
    ),
    [state, setState] = useState(issue?.state ?? '')
  const [assignees, setAssignees] = useState(issue?.assignees.join(', ') ?? ''),
    [labels, setLabels] = useState(issue?.labels.join(', ') ?? '')
  const [definition, setDefinition] = useState(initialDefinition ?? ''),
    [ref, setRef] = useState(initialRef ?? ''),
    [inputs, setInputs] = useState('{}')
  const [definitions, setDefinitions] = useState<z.infer<typeof forgeDefinitionsSchema>>()
  const [definitionsLoading, setDefinitionsLoading] = useState(kind === 'run')
  const [definitionsRevision, retryDefinitions] = useState(0)
  const definitionRequests = useRef(new RequestScope())
  const definitionPending = useRef(false)
  const [issueStates, setIssueStates] = useState(options.issueStates)
  useEffect(() => {
    if (kind !== 'edit' || options.provider !== 'azure-devops' || !issue) return
    let current = true
    void read(
      '/api/scm/work/options',
      { repositoryId, type: issue.type, area: 'issues' },
      forgeWorkOptionsSchema,
    )
      .then((v) => {
        if (current) setIssueStates(v.issueStates)
      })
      .catch((e) => {
        if (current) setError(String(e))
      })
    return () => {
      current = false
    }
  }, [kind, options.provider, issue, repositoryId, read])

  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const pending = useRef(false)
  useEffect(() => {
    if (kind !== 'run') return
    const current = definitionRequests.current.begin()
    definitionPending.current = true
    setDefinitionsLoading(true)
    setError('')
    void read('/api/scm/work/pipelines/definitions', { repositoryId }, forgeDefinitionsSchema)
      .then((value) => {
        if (current()) {
          setDefinitions(value)
          setDefinition((chosen) => chosen || value.items[0]?.id || '')
        }
      })
      .catch((error) => {
        if (current()) setError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (current()) {
          definitionPending.current = false
          setDefinitionsLoading(false)
        }
      })
    return () => definitionRequests.current.cancel()
  }, [kind, repositoryId, read, definitionsRevision])
  const moreDefinitions = async () => {
    if (!definitions?.next || definitionPending.current || busy || !connected) return
    definitionPending.current = true
    const current = definitionRequests.current.begin()
    setDefinitionsLoading(true)
    setError('')
    try {
      const value = await read(
        '/api/scm/work/pipelines/definitions',
        { repositoryId, cursor: definitions.next },
        forgeDefinitionsSchema,
      )
      if (current())
        setDefinitions({ ...value, items: appendUniqueRows(definitions.items, value.items) })
    } catch (error) {
      if (current()) setError(error instanceof Error ? error.message : String(error))
    } finally {
      if (current()) {
        definitionPending.current = false
        setDefinitionsLoading(false)
      }
    }
  }
  const split = (v: string) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  const submit = async () => {
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
    try {
      const data =
        kind === 'transition'
          ? { action: 'edit', id: issue?.id, revision: issue?.revision, state }
          : kind === 'run'
            ? {
                action: 'run',
                definition,
                ref,
                inputs: z.record(z.string(), z.string()).parse(JSON.parse(inputs)),
              }
            : kind === 'comment'
              ? { action: 'comment', id: issue?.id, revision: issue?.revision, body }
              : kind === 'edit' && issue
                ? issueEditInput(issue, {
                    title,
                    body,
                    state,
                    ...(options.assignees ? { assignees: split(assignees) } : {}),
                    ...(options.labels ? { labels: split(labels) } : {}),
                  })
                : { title, body, type, assignees: split(assignees), labels: split(labels) }
      const result = await read(
        '/api/scm/work/' +
          (kind === 'run'
            ? 'pipelines/action'
            : kind === 'create'
              ? 'issues/create'
              : 'issues/action'),
        {
          ...(jiraSourceId ? { jiraSourceId } : { repositoryId }),
          ...(kind === 'run'
            ? forgePipelineActionSchema.parse(data)
            : kind === 'create'
              ? forgeIssueCreateSchema.parse(data)
              : forgeIssueActionSchema.parse(data)),
        },
        forgeWorkResultSchema,
      )
      onDone(result.message, result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      pending.current = false
      setBusy(false)
    }
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
              items={definitions?.items.map((d) => ({ id: d.id, name: d.name })) ?? []}
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
            style={{ minHeight: 140, textAlignVertical: 'top' }}
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
              items={options.issueTypes.map((id) => ({ id, name: id }))}
            />
          )}
          {kind === 'edit' && options.provider !== 'jira' && issueStates.length > 0 && (
            <Choice
              label="State"
              value={state}
              onChange={setState}
              disabled={busy}
              items={issueStates.map((id) => ({ id, name: id }))}
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
