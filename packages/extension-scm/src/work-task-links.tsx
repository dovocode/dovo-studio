import { useEffect, useRef, useState } from 'react'
import {
  useStudioHost,
  useWorkspace,
  workTaskResponseSchema,
  responses,
  type ForgeIssue,
  type ForgePipeline,
} from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  FormField,
} from '@dovo/studio-ui'
import { ArrowRight, FolderGit2 } from 'lucide-react'

export function WorkTaskLinks({
  repositoryId,
  jiraSourceId,
  source,
  disabled,
}: {
  repositoryId?: string
  jiraSourceId?: string
  source: ForgeIssue | ForgePipeline
  disabled: boolean
}) {
  const { workspace, request, connected, refreshRuntimes } = useWorkspace()
  const host = useStudioHost()
  const kind = 'revision' in source ? 'issue' : 'pipeline'
  const linkedProject = jiraSourceId
    ? workspace.repositories.find(
        (repository) =>
          repository.id ===
          workspace.jiraIssueLinks?.find(
            (link) => link.sourceId === jiraSourceId && link.issueId === source.id,
          )?.repositoryId,
      )
    : undefined
  const related = workspace.tasks.filter(
    (task) =>
      task.workItem?.kind === kind &&
      task.workItem.url === source.url &&
      (jiraSourceId
        ? task.workItem.kind === 'issue' &&
          (!task.workItem.jiraSourceId || task.workItem.jiraSourceId === jiraSourceId)
        : task.repositoryId === repositoryId),
  )
  const requestId = useRef(crypto.randomUUID())
  const attemptedRepository = useRef('')
  const pending = useRef(false)
  const linkPending = useRef(false)
  const mounted = useRef(true)
  const [busy, setBusy] = useState(false)
  const [linking, setLinking] = useState(false)
  const [error, setError] = useState('')
  const [linkError, setLinkError] = useState('')
  const [created, setCreated] = useState('')
  const [picking, setPicking] = useState(false)
  const [destination, setDestination] = useState('')
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    if (!created || !workspace.tasks.some((task) => task.id === created)) return
    setCreated('')
    host.navigate({ viewId: 'tasks', entityId: created })
  }, [created, workspace.tasks, host])
  const linkProject = async (selected: string) => {
    if (!jiraSourceId || linkPending.current || disabled || !connected) return
    linkPending.current = true
    setLinking(true)
    setLinkError('')
    try {
      await request(
        '/api/scm/jira/issues/link',
        { sourceId: jiraSourceId, issueId: source.id, repositoryId: selected || null },
        responses.ok,
      )
      await refreshRuntimes()
    } catch (error) {
      if (mounted.current) setLinkError(error instanceof Error ? error.message : String(error))
    } finally {
      linkPending.current = false
      if (mounted.current) setLinking(false)
    }
  }
  const start = async (selected?: string) => {
    if (pending.current || linkPending.current || disabled || !connected) return
    const target = attemptedRepository.current || selected || linkedProject?.id || repositoryId
    if (!created && !target) {
      setPicking(true)
      return
    }
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (created) {
        await refreshRuntimes()
        return
      }
      if (!target) return
      // Keep the destination and id together when retrying an uncertain response.
      attemptedRepository.current = target
      const result = await request(
        '/api/scm/work/task',
        {
          repositoryId: target,
          ...(jiraSourceId ? { jiraSourceId } : {}),
          requestId: requestId.current,
          id: source.id,
          url: source.url,
          ...('revision' in source
            ? { kind: 'issue', revision: source.revision }
            : { kind: 'pipeline', sha: source.sha }),
        },
        workTaskResponseSchema,
      )
      if (!mounted.current) return
      setCreated(result.id)
      setPicking(false)
      await refreshRuntimes()
    } catch (error) {
      if (mounted.current) setError(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <section aria-label="Linked tasks" className="space-y-3">
      {jiraSourceId && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <FolderGit2 className="size-3.5" /> Dovo project
            </span>
            <ChoicePicker
              aria-label="Linked Dovo project"
              className="h-8 w-auto max-w-64 text-xs"
              value={linkedProject?.id ?? ''}
              disabled={disabled || !connected || busy || linking}
              onValueChange={(value) => void linkProject(value)}
            >
              <option value="">Not linked</option>
              {workspace.repositories.map((repository) => (
                <option key={repository.id} value={repository.id}>
                  {repository.name}
                </option>
              ))}
            </ChoicePicker>
            {linking && <span className="text-xs text-muted-foreground">Saving link…</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            Optional · saved in Dovo. This does not change the Jira issue.
          </p>
          {linkError && (
            <p role="alert" className="text-xs text-destructive">
              {linkError}
            </p>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={disabled || !connected || busy || linking}
          onClick={() => void start()}
          title="Open a draft with source context. Choose the model and checkout before sending."
        >
          {busy
            ? 'Preparing…'
            : created
              ? 'Open created task'
              : error && attemptedRepository.current
                ? 'Retry task creation'
                : kind === 'issue'
                  ? 'Start task from issue'
                  : 'Investigate run'}
        </Button>
        {!related.length && (
          <span className="text-xs text-muted-foreground">
            Creates a draft · review before sending
          </span>
        )}
      </div>
      {error && !picking && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {related.length > 0 && (
        <details className="text-xs">
          <summary className="w-fit cursor-pointer py-1.5 text-muted-foreground hover:text-foreground">
            {related.length} linked {related.length === 1 ? 'task' : 'tasks'}
          </summary>
          <div className="grid gap-1 pt-1">
            {related.map((task) => (
              <button
                key={task.id}
                type="button"
                className="flex min-w-0 items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-muted"
                onClick={() => host.navigate({ viewId: 'tasks', entityId: task.id })}
              >
                <span className="min-w-0 flex-1 truncate">{task.title}</span>
                {jiraSourceId && (
                  <span className="max-w-32 truncate text-muted-foreground">
                    {
                      workspace.repositories.find(
                        (repository) => repository.id === task.repositoryId,
                      )?.name
                    }
                  </span>
                )}
                <span className="text-muted-foreground">
                  {task.archived ? 'Settled' : task.status}
                </span>
                <ArrowRight className="size-3.5 shrink-0" />
              </button>
            ))}
          </div>
        </details>
      )}
      <Dialog open={picking} onOpenChange={(open) => !busy && setPicking(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Choose a project for this task</DialogTitle>
            <DialogDescription>
              The project provides the checkout for your agent. Dovo saves the project link for
              future tasks; your issue stays in Jira.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (destination) void start(destination)
            }}
          >
            {workspace.repositories.length ? (
              <FormField label="Task project">
                <ChoicePicker
                  aria-label="Task project"
                  value={destination}
                  disabled={busy || !!attemptedRepository.current}
                  onValueChange={setDestination}
                >
                  <option value="">Choose a project…</option>
                  {workspace.repositories.map((repository) => (
                    <option key={repository.id} value={repository.id}>
                      {repository.name}
                    </option>
                  ))}
                </ChoicePicker>
              </FormField>
            ) : (
              <p className="text-sm text-muted-foreground">
                Add a project from Tasks to run an agent. You can keep working with this issue here.
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => setPicking(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!destination || busy || disabled || !connected}>
                {busy ? 'Preparing…' : error ? 'Retry task creation' : 'Create task draft'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
