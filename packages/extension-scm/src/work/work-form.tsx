import { useApplicationState } from '@dovo/studio-core/state'
import { decode } from '@dovo/protocol'
import { issueEditInput, issueLabel } from '@dovo/studio-core'
import { useEffect, useMemo, useRef } from 'react'
import { Schema } from 'effect'
import {
  useWorkspace,
  appendUniqueRows,
  RequestScope,
  forgeWorkOptionsSchema,
  forgeIssueCreateSchema,
  forgeIssueActionSchema,
  forgePipelineActionSchema,
  forgeDefinitionsSchema,
  forgeWorkResultSchema,
  type ForgeIssueDetail,
  type ForgeWorkOptions,
  type ForgeWorkResult,
} from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  Input,
  Textarea,
  FormField,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@dovo/studio-ui'

export function WorkForm({
  kind,
  repositoryId,
  jiraSourceId,
  issue: initialIssue,
  initialRef = '',
  initialDefinition,
  options,
  onClose,
  onDone,
}: {
  kind: 'create' | 'edit' | 'comment' | 'run' | 'transition'
  repositoryId?: string
  jiraSourceId?: string
  issue?: ForgeIssueDetail['issue']
  initialRef?: string
  initialDefinition?: string
  options: ForgeWorkOptions
  onClose: () => void
  onDone: (message: string, result?: ForgeWorkResult) => void
}) {
  const { request, connected } = useWorkspace()
  const target = useMemo(
    () =>
      jiraSourceId
        ? {
            jiraSourceId,
          }
        : {
            repositoryId,
          },
    [jiraSourceId, repositoryId],
  )
  const [issue] = useApplicationState(initialIssue)
  const [title, setTitle] = useApplicationState(kind === 'edit' ? (issue?.title ?? '') : '')
  const [body, setBody] = useApplicationState(kind === 'edit' ? (issue?.body ?? '') : '')
  const [type, setType] = useApplicationState(
    options.issueTypes[0] ?? (options.provider === 'jira' ? 'Task' : 'Issue'),
  )
  const [state, setState] = useApplicationState(issue?.state ?? '')
  const [assignees, setAssignees] = useApplicationState(issue?.assignees.join(', ') ?? '')
  const [labels, setLabels] = useApplicationState(issue?.labels.join(', ') ?? '')
  const [definition, setDefinition] = useApplicationState(initialDefinition ?? ''),
    [ref, setRef] = useApplicationState(initialRef),
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
    void request(
      '/api/scm/work/options',
      {
        ...target,
        type: issue.type,
        area: 'issues',
      },
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
  }, [kind, options.provider, issue, target, request])
  const [error, setError] = useApplicationState(''),
    [busy, setBusy] = useApplicationState(false)
  const pending = useRef(false)
  useEffect(() => {
    if (kind !== 'run') return
    const current = definitionRequests.current.begin()
    definitionPending.current = true
    setDefinitionsLoading(true)
    setError('')
    void request(
      '/api/scm/work/pipelines/definitions',
      {
        repositoryId,
      },
      forgeDefinitionsSchema,
    )
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
  }, [kind, repositoryId, request, definitionsRevision])
  const moreDefinitions = async () => {
    if (!definitions?.next || definitionPending.current || busy || !connected) return
    definitionPending.current = true
    const current = definitionRequests.current.begin()
    setDefinitionsLoading(true)
    setError('')
    try {
      const value = await request(
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
      const result = await request(
        '/api/scm/work/' +
          (kind === 'run'
            ? 'pipelines/action'
            : kind === 'create'
              ? 'issues/create'
              : 'issues/action'),
        {
          ...target,
          ...(kind === 'run'
            ? decode(forgePipelineActionSchema, data)
            : kind === 'create'
              ? decode(forgeIssueCreateSchema, data)
              : decode(forgeIssueActionSchema, data)),
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {kind === 'transition'
              ? 'Change Jira status'
              : kind === 'run'
                ? 'Run pipeline'
                : kind === 'comment'
                  ? 'Add comment'
                  : kind === 'edit'
                    ? 'Edit issue'
                    : 'New issue'}
          </DialogTitle>
          <DialogDescription>
            {issue
              ? `${issueLabel(issue.id)} · ${issue.title}`
              : kind === 'run'
                ? 'Run a pipeline on the selected project’s server.'
                : options.provider === 'jira'
                  ? 'Create an issue in this Jira source. Linking it to a Dovo project is optional.'
                  : 'Create an issue in the selected project.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <fieldset className="grid gap-4" disabled={busy || !connected}>
            {kind === 'transition' ? (
              <FormField label="New Jira status">
                <Input
                  required
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="In Progress"
                />
                <p className="text-xs text-muted-foreground">
                  Current status: {issue?.state}. Enter a status allowed by this issue's Jira
                  workflow; Jira validates the transition.
                </p>
              </FormField>
            ) : kind === 'run' ? (
              <>
                <FormField label="Pipeline">
                  {definitions?.manual ? (
                    <Input
                      required
                      value={definition}
                      onChange={(e) => setDefinition(e.target.value)}
                    />
                  ) : (
                    <ChoicePicker
                      aria-label="Pipeline"
                      value={definition}
                      onValueChange={setDefinition}
                    >
                      {definition && !definitions?.items.some((item) => item.id === definition) && (
                        <option value={definition}>{definition} · Selected run</option>
                      )}
                      {definitions?.items.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </ChoicePicker>
                  )}
                </FormField>
                <p className="text-xs text-muted-foreground">{definitions?.hint}</p>
                {definitions?.next && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={definitionsLoading}
                    onClick={() => void moreDefinitions()}
                  >
                    More pipelines
                  </Button>
                )}
                {!definitions && !definitionsLoading && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => retryDefinitions((value) => value + 1)}
                  >
                    Retry pipelines
                  </Button>
                )}
                <FormField label="Branch or ref">
                  <Input required value={ref} onChange={(e) => setRef(e.target.value)} />
                </FormField>
                <FormField label="Inputs (JSON string values)">
                  <Textarea value={inputs} onChange={(e) => setInputs(e.target.value)} />
                </FormField>
              </>
            ) : (
              <>
                {kind !== 'comment' && (
                  <FormField label="Title">
                    <Input required value={title} onChange={(e) => setTitle(e.target.value)} />
                  </FormField>
                )}
                <FormField
                  label={
                    kind === 'edit' && issue?.bodyFormat === 'html'
                      ? 'Description (original HTML)'
                      : 'Description'
                  }
                >
                  <Textarea
                    required={kind === 'comment'}
                    rows={6}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </FormField>
                {kind === 'create' &&
                  options.provider === 'jira' &&
                  options.issueTypes.length === 0 && (
                    <FormField label="Issue type">
                      <Input
                        required
                        value={type}
                        onChange={(e) => setType(e.target.value)}
                        placeholder="Task"
                      />
                    </FormField>
                  )}
                {kind === 'create' && options.issueTypes.length > 1 && (
                  <FormField label="Type">
                    <ChoicePicker aria-label="Issue type" value={type} onValueChange={setType}>
                      {options.issueTypes.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </ChoicePicker>
                  </FormField>
                )}
                {kind === 'edit' && issueStates.length > 0 && (
                  <FormField label="State">
                    <ChoicePicker aria-label="Issue state" value={state} onValueChange={setState}>
                      {issueStates.map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </ChoicePicker>
                  </FormField>
                )}
                {kind !== 'comment' && options.assignees && (
                  <FormField
                    label={
                      options.provider === 'jira'
                        ? 'Assignee account ID'
                        : 'Assignees (comma separated)'
                    }
                  >
                    <Input value={assignees} onChange={(e) => setAssignees(e.target.value)} />
                    {options.provider === 'jira' && (
                      <p className="text-xs text-muted-foreground">
                        {issue?.assigneeNames?.length
                          ? `Currently ${issue.assigneeNames.join(', ')}. `
                          : ''}
                        Jira uses account IDs. Leave empty to unassign.
                      </p>
                    )}
                  </FormField>
                )}
                {kind !== 'comment' && options.labels && (
                  <FormField label="Labels (comma separated)">
                    <Input value={labels} onChange={(e) => setLabels(e.target.value)} />
                  </FormField>
                )}
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={kind === 'run' && (!definitions || definitionsLoading)}
              >
                {busy
                  ? 'Saving…'
                  : kind === 'create'
                    ? 'Create issue'
                    : kind === 'comment'
                      ? 'Post comment'
                      : kind === 'transition'
                        ? 'Change status'
                        : kind === 'run'
                          ? 'Run pipeline'
                          : 'Save changes'}
              </Button>
            </div>
          </fieldset>
          {error && (
            <p role="alert" className="break-words text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  )
}
