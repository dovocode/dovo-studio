import { useApplicationState } from '@dovo/studio-core/state'
import { ExternalLink, GitPullRequest, Unlink } from 'lucide-react'
import { pullDetailSchema, updateTask, useWorkspace, type Task } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  IconButton,
  Input,
} from '@dovo/studio-ui'
import { pullReference, taskPullLinks, verifyPullUrl } from './task-pull-links'
export function TaskPullLinkDialog({ task, onClose }: { task: Task; onClose: () => void }) {
  const { request, connected, setWorkspace, flush, workspace } = useWorkspace()
  const [reference, setReference] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const links = taskPullLinks(task)
  const save = async (links: NonNullable<Task['linkedPullRequests']>) => {
    setWorkspace((w) =>
      updateTask(w, task.id, (t) => ({
        ...t,
        linkedPullRequests: links,
      })),
    )
    await flush()
  }
  const link = async () => {
    if (busy || !connected) return
    setBusy(true)
    setError('')
    try {
      const input = pullReference(reference)
      const { pull } = await request(
        '/api/scm/pulls/detail',
        {
          repositoryId: task.repositoryId,
          number: input.number,
        },
        pullDetailSchema,
      )
      verifyPullUrl(input.url, pull.url)
      if (links.some((entry) => entry.url === pull.url))
        throw new Error('This PR is already linked.')
      await save([
        ...(task.linkedPullRequests ?? []),
        {
          number: pull.number,
          url: pull.url,
          title: pull.title,
          provider: pull.provider,
          repositoryUrl: pull.repositoryUrl,
        },
      ])
      setReference('')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  const unlink = async (url: string) => {
    setBusy(true)
    setError('')
    try {
      await save((task.linkedPullRequests ?? []).filter((pull) => pull.url !== url))
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-w-md">
        <DialogTitle className="flex items-center gap-2 text-sm">
          <GitPullRequest size={16} />
          Linked pull requests
        </DialogTitle>
        <DialogDescription className="text-xs">
          Link a PR from{' '}
          {workspace.repositories.find((repo) => repo.id === task.repositoryId)?.name ??
            'this project'}
          . Your checkout stays the same.
        </DialogDescription>
        <div className="max-h-[40vh] space-y-1 overflow-y-auto">
          {links.map((pull) => (
            <div
              key={pull.url}
              className="flex min-w-0 items-center gap-2 rounded-lg bg-muted/40 px-3 py-2"
            >
              <GitPullRequest size={14} className="shrink-0 text-violet-400" />
              <a
                href={pull.url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 text-xs hover:underline"
              >
                <span className="block truncate">
                  #{pull.number} · {pull.title}
                </span>
                {task.pullRequest?.url === pull.url && (
                  <span className="text-[0.625rem] text-muted-foreground">
                    Source PR · used for checkout
                  </span>
                )}
              </a>
              {task.pullRequest?.url === pull.url ? (
                <ExternalLink size={12} className="text-muted-foreground" />
              ) : (
                <IconButton
                  label={`Unlink PR #${pull.number}`}
                  disabled={busy || !connected}
                  className="size-7"
                  onClick={() => void unlink(pull.url)}
                >
                  <Unlink size={13} />
                </IconButton>
              )}
            </div>
          ))}
          {!links.length && (
            <p className="py-2 text-xs text-muted-foreground">No pull requests linked yet.</p>
          )}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void link()
          }}
          className="flex gap-2"
        >
          <Input
            aria-label="Pull request number or URL"
            placeholder="#123 or pull request URL"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            disabled={busy || !connected}
            className="min-w-0 flex-1"
          />
          <Button
            type="submit"
            size="sm"
            disabled={
              busy ||
              !connected ||
              !reference.trim() ||
              !task.repositoryId ||
              (task.linkedPullRequests?.length ?? 0) >= 20
            }
          >
            {busy ? 'Saving…' : 'Link PR'}
          </Button>
        </form>
        {!connected && (
          <p className="text-xs text-muted-foreground">
            Connect to the task’s computer to manage links.
          </p>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
