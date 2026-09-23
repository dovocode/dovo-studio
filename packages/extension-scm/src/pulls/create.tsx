import { useApplicationState } from '@dovo/studio-core/state'
import { Schema } from 'effect'
import { useEffect, useRef } from 'react'
import { pullActionResultSchema, pullCreateOptionsSchema, useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Checkbox,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  Input,
  Textarea,
} from '@dovo/studio-ui'
export function CreatePull({
  initialRepositoryId,
  onClose,
  onCreated,
}: {
  initialRepositoryId: string
  onClose: () => void
  onCreated: (repositoryId: string, number: number) => void
}) {
  const { workspace, request, connected } = useWorkspace()
  const [repositoryId, setRepository] = useApplicationState(
    initialRepositoryId || workspace.repositories[0]?.id || '',
  )
  const [head, setHead] = useApplicationState(
    workspace.repositories.find((repo) => repo.id === repositoryId)?.branch ?? '',
  )
  const [base, setBase] = useApplicationState('')
  const [title, setTitle] = useApplicationState('')
  const [body, setBody] = useApplicationState('')
  const [sourceTask, setSourceTask] = useApplicationState('')
  const sourceTasks = workspace.tasks.filter(
    (task) => task.repositoryId === repositoryId && task.workItem && task.checkoutBranch,
  )
  const [draft, setDraft] = useApplicationState(false)
  const [busy, setBusy] = useApplicationState(false)
  const pending = useRef(false)
  const [error, setError] = useApplicationState('')
  const [options, setOptions] = useApplicationState<Schema.Schema.Type<
    typeof pullCreateOptionsSchema
  > | null>(null)
  const [optionsError, setOptionsError] = useApplicationState('')
  useEffect(() => {
    let stopped = false
    setOptions(null)
    setOptionsError('')
    setDraft(false)
    if (connected && repositoryId)
      void request(
        '/api/scm/pulls/options/read',
        {
          repositoryId,
        },
        pullCreateOptionsSchema,
      )
        .then((value) => {
          if (!stopped) setOptions(value)
        })
        .catch((error: unknown) => {
          if (!stopped) setOptionsError(error instanceof Error ? error.message : String(error))
        })
    return () => {
      stopped = true
    }
  }, [connected, repositoryId, request])
  const submit = async () => {
    if (
      pending.current ||
      !connected ||
      !options ||
      !repositoryId ||
      !title.trim() ||
      !head.trim() ||
      !base.trim()
    )
      return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const result = await request(
        '/api/scm/pulls/create',
        {
          repositoryId,
          title,
          body,
          head,
          base,
          draft: !!options.draft && draft,
        },
        pullActionResultSchema,
      )
      onCreated(repositoryId, result.number)
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
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
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create pull request</DialogTitle>
          <DialogDescription>
            Compare existing remote branches. Push your changes before creating the PR.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <FormField label="Project">
            <ChoicePicker
              aria-label="Create PR project"
              value={repositoryId}
              disabled={busy}
              onValueChange={(value) => {
                setRepository(value)
                setSourceTask('')
                setHead(workspace.repositories.find((repo) => repo.id === value)?.branch ?? '')
              }}
            >
              {workspace.repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.name}
                </option>
              ))}
            </ChoicePicker>
          </FormField>
          {sourceTasks.length > 0 && (
            <FormField label="From task (optional)">
              <ChoicePicker
                aria-label="PR source task"
                value={sourceTask}
                disabled={busy}
                onValueChange={(id) => {
                  setSourceTask(id)
                  const task = sourceTasks.find((task) => task.id === id)
                  if (!task?.workItem || !task.checkoutBranch) return
                  setTitle(task.workItem.title)
                  setHead(task.checkoutBranch)
                  setBody(`Related ${task.workItem.kind}: ${task.workItem.url}\n\n`)
                }}
              >
                <option value="">Choose a linked task…</option>
                {sourceTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title} · {task.checkoutBranch}
                  </option>
                ))}
              </ChoicePicker>
              <p className="text-xs text-muted-foreground">
                Use the task branch and reference its source. Review the fields before submitting.
              </p>
            </FormField>
          )}
          <FormField label="Title">
            <Input
              aria-label="New PR title"
              autoFocus
              value={title}
              disabled={busy}
              maxLength={300}
              onChange={(e) => setTitle(e.target.value)}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Head branch">
              <Input
                aria-label="New PR head branch"
                value={head}
                disabled={busy}
                onChange={(e) => setHead(e.target.value)}
              />
            </FormField>
            <FormField label="Base branch">
              <Input
                aria-label="New PR base branch"
                placeholder="main"
                value={base}
                disabled={busy}
                onChange={(e) => setBase(e.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Description">
            <Textarea
              aria-label="New PR description"
              className="min-h-32"
              value={body}
              disabled={busy}
              maxLength={60000}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Markdown supported"
            />
          </FormField>
          {options?.draft && (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={draft}
                disabled={busy}
                onCheckedChange={(value) => setDraft(value === true)}
              />
              Create as draft
            </label>
          )}
          {optionsError && (
            <p role="alert" className="text-xs text-destructive">
              {optionsError}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                !options ||
                !connected ||
                !repositoryId ||
                !title.trim() ||
                !head.trim() ||
                !base.trim()
              }
            >
              {busy ? 'Creating…' : 'Create PR'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
