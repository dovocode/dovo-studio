import { useApplicationState } from '@dovo/studio-core/state'
import { nativeAgentWorking, taskFamilyIds } from '@dovo/protocol'
import { responses, useStudioHost, useWorkspace, type Repository } from '@dovo/studio-core'
import { AlertTriangle } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@dovo/studio-ui'
import { useEffect, useRef } from 'react'

export function ProjectDeletion({
  repository,
  onDeleted,
}: {
  repository: Repository
  onDeleted?: (refreshError?: string) => void
}) {
  const host = useStudioHost()
  const { connected, activeRuntimeId, readRuntime, refreshRuntime, runtimes, workspace, snapshot } =
    useWorkspace()
  const [confirmation, setConfirmation] = useApplicationState<{
    repositoryId: string
    runtimeId: string | null
  } | null>(null)
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const pending = useRef(false)
  const cancel = useRef<HTMLButtonElement>(null)
  // Mirror the deletion service's guards using activity already known to this computer.
  // The service remains authoritative for in-flight work and changes after confirmation.
  const projectTasks = workspace.tasks.filter((task) => task.repositoryId === repository.id)
  const guardedIds = new Set(
    projectTasks.flatMap((task) => [...taskFamilyIds(workspace.tasks, task.id)]),
  )
  for (const task of workspace.tasks) {
    if (
      [...(task.linkedCheckouts ?? []), ...(task.pendingLinkedCheckouts ?? [])].some(
        (link) => link.repositoryId === repository.id,
      )
    )
      guardedIds.add(task.id)
  }
  const guardedTasks = workspace.tasks.filter((task) => guardedIds.has(task.id))
  const affectedFlows = new Set(
    workspace.automations
      .filter((flow) =>
        flow.nodes.some(
          (node) =>
            node.data.repositoryId === repository.id ||
            node.data.linkedCheckouts?.some((link) => link.repositoryId === repository.id),
        ),
      )
      .map((flow) => flow.id),
  )
  let activeWorkReason = ''
  const activeTurn = guardedTasks.find(
    (task) => task.status === 'running' || task.subagents?.some(nativeAgentWorking),
  )
  const pendingDecision =
    snapshot?.questions.find((question) => guardedIds.has(question.taskId)) ??
    snapshot?.approvals.find((approval) => guardedIds.has(approval.taskId))
  const activeTerminal = snapshot?.terminals.find(
    (terminal) => guardedIds.has(terminal.taskId) && !terminal.exited,
  )
  const watchedThread = guardedTasks.find((task) =>
    task.threadWatches?.some((watch) => watch.status === 'watching'),
  )
  const activeAutomation = snapshot?.runs.find(
    (run) =>
      (run.status === 'running' || run.status === 'waiting') &&
      (affectedFlows.has(run.automationId) || run.taskIds.some((id) => guardedIds.has(id))),
  )
  const activeWorkThreadId =
    activeTurn?.id ??
    pendingDecision?.taskId ??
    activeTerminal?.taskId ??
    watchedThread?.id ??
    activeAutomation?.taskIds.find((id) => guardedIds.has(id))
  if (activeTurn) activeWorkReason = 'Stop active turns and agents before deleting this project.'
  else if (pendingDecision)
    activeWorkReason = 'Finish pending questions or approvals before deleting this project.'
  else if (activeTerminal) activeWorkReason = 'Close active terminals before deleting this project.'
  else if (watchedThread)
    activeWorkReason = 'Stop linked active threads before deleting this project.'
  else if (activeAutomation)
    activeWorkReason = 'Finish or cancel active automations before deleting this project.'
  const open =
    confirmation?.repositoryId === repository.id && confirmation.runtimeId === activeRuntimeId
  useEffect(() => {
    setConfirmation(null)
  }, [activeRuntimeId, repository.id, setConfirmation])

  if (repository.kind) return null

  const remove = async () => {
    if (!open || !confirmation || pending.current || !connected || activeWorkReason) return
    const target = confirmation
    const profile = runtimes.find((entry) => entry.profile.id === target.runtimeId)?.profile
    if (!profile) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await readRuntime(
        profile,
        '/api/scm/repositories/delete',
        { repositoryId: target.repositoryId },
        responses.ok,
        'POST',
      )
      setConfirmation(null)
      let refreshError: string | undefined
      try {
        await refreshRuntime(profile)
      } catch (cause) {
        refreshError = cause instanceof Error ? cause.message : String(cause)
      }
      onDeleted?.(refreshError)
      if (refreshError && !onDeleted)
        setError(`Project deleted, but refresh failed: ${refreshError}`)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border border-destructive/40 p-3">
      <div>
        <h3 className="text-sm font-medium">Delete project</h3>
        <p className="text-xs text-muted-foreground">
          Remove this project and its thread and conversation history from Dovo. Repository and
          worktree files stay on disk.
        </p>
      </div>
      <Button
        type="button"
        variant="destructive"
        disabled={!connected || busy}
        onClick={() => {
          setError('')
          setConfirmation({ repositoryId: repository.id, runtimeId: activeRuntimeId })
        }}
      >
        Delete {repository.name}…
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={open}
        onOpenChange={(open) => {
          if (!busy) setConfirmation(open ? confirmation : null)
        }}
      >
        <DialogContent
          className="max-w-md"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            cancel.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete “{repository.name}”?</DialogTitle>
            <DialogDescription>
              This removes the project and its thread and conversation history from Dovo. The
              repository and worktree files remain on disk. Active work must finish before you can
              delete this project.
            </DialogDescription>
          </DialogHeader>
          {activeWorkReason && (
            <div
              role="status"
              className="flex items-start gap-3 rounded-lg border border-status-warning/30 bg-status-warning/5 p-3 text-xs"
            >
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-status-warning"
                aria-hidden="true"
              />
              <div className="space-y-2">
                <p className="font-medium text-foreground">Active work prevents deletion</p>
                <p className="leading-relaxed text-muted-foreground">{activeWorkReason}</p>
                {activeWorkThreadId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setConfirmation(null)
                      host.navigate({ viewId: 'tasks', entityId: activeWorkThreadId })
                    }}
                  >
                    Open affected thread
                  </Button>
                )}
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              ref={cancel}
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!connected || busy || !!activeWorkReason}
              onClick={() => void remove()}
            >
              {busy ? 'Deleting…' : `Delete ${repository.name} and history`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
