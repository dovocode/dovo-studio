import { TaskLauncherControls } from './task-launcher-controls'
import { useEffect, useRef, useState } from 'react'
import { useAppPreferences, useWorkspace, useStudioHost, WorkspaceScope } from '@dovo/studio-core'
import { snapshotSchema, type RuntimeSnapshot, type TaskLauncherBridge } from '@dovo/protocol'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
} from '@dovo/studio-ui'
import { ArrowUpRight } from 'lucide-react'
import {
  launcherDefaultAgent,
  type LauncherAgent,
  createLauncherTask,
  dispatchLauncherTask,
  type LauncherAttempt,
} from '@dovo/protocol'

export function TaskLauncher({
  bridge,
  onDispatched,
}: {
  bridge: TaskLauncherBridge
  onDispatched: (target: { viewId: 'tasks'; entityId: string; runtimeId: string }) => void
}) {
  const { runtimeRegistry, activeRuntimeId, readRuntime, refreshRuntime } = useWorkspace()
  const { registerCommand } = useStudioHost()
  useEffect(
    () =>
      registerCommand({
        id: 'studio.task-launcher',
        title: 'Start task · global launcher',
        run: () => setOpen(true),
      }),
    [registerCommand],
  )
  const { taskLauncherShortcut } = useAppPreferences()
  const [open, setOpen] = useState(false)
  const [runtimeId, setRuntimeId] = useState(activeRuntimeId ?? '')
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null)
  const [repositoryId, setRepositoryId] = useState('')
  const [selection, setSelection] = useState<LauncherAgent | null>(null)
  const [loadedRuntimeId, setLoadedRuntimeId] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [shortcutError, setShortcutError] = useState('')
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const attempt = useRef<LauncherAttempt | null>(null)
  const submitting = useRef(false)
  useEffect(() => bridge.subscribe(() => setOpen(true)), [bridge])
  useEffect(() => {
    let current = true
    void bridge.configure(taskLauncherShortcut).then(
      (result) => {
        if (current) setShortcutError(result.error ?? '')
      },
      (cause: unknown) => {
        if (current) setShortcutError(String(cause))
      },
    )
    return () => {
      current = false
    }
  }, [bridge, taskLauncherShortcut])
  useEffect(() => {
    if (!open || runtimeId) return
    setRuntimeId(activeRuntimeId ?? runtimeRegistry.profiles[0]?.id ?? '')
  }, [open, runtimeId, activeRuntimeId, runtimeRegistry.profiles])
  useEffect(() => {
    if (!open || attempt.current) return
    const profile = runtimeRegistry.profiles.find((profile) => profile.id === runtimeId)
    let current = true
    setSnapshot(null)
    setError('')
    if (!profile) return
    setLoading(true)
    void readRuntime(profile, '/api/snapshot', undefined, snapshotSchema, 'GET')
      .then(
        (next) => {
          if (!current) return
          setSnapshot(next)
          setRepositoryId((id) =>
            next.workspace.repositories.some((repository) => repository.id === id)
              ? id
              : (next.workspace.repositories[0]?.id ?? ''),
          )
          setLoadedRuntimeId(runtimeId)
          void refreshRuntime(profile).catch((cause: unknown) => setError(String(cause)))
        },
        (cause: unknown) => {
          if (current) setError(cause instanceof Error ? cause.message : String(cause))
        },
      )
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [open, runtimeId, runtimeRegistry.profiles, readRuntime, refreshRuntime, refresh])
  useEffect(() => {
    if (attempt.current) return
    const repository = snapshot?.workspace.repositories.find((entry) => entry.id === repositoryId)
    setSelection(snapshot && repository ? launcherDefaultAgent(snapshot, repository) : null)
  }, [snapshot, repositoryId])
  const dispatch = async () => {
    if (submitting.current) return
    const profile = runtimeRegistry.profiles.find((profile) => profile.id === runtimeId)
    const repository = snapshot?.workspace.repositories.find(
      (repository) => repository.id === repositoryId,
    )
    const agent = loadedRuntimeId === runtimeId ? selection : null
    if (!attempt.current && (!profile || !repository || !agent || !text.trim())) return
    submitting.current = true
    setBusy(true)
    setError('')
    try {
      if (!attempt.current && snapshot && profile && repository && agent) {
        attempt.current = {
          task: createLauncherTask(snapshot, repository, agent, text, crypto.randomUUID()),
          profile,
          messageId: crypto.randomUUID(),
          text: text.trim(),
          created: false,
        }
      }
      const current = attempt.current
      if (!current) return
      await dispatchLauncherTask(current, readRuntime)
      onDispatched({ runtimeId: current.profile.id, viewId: 'tasks', entityId: current.task.id })
      void refreshRuntime(current.profile).catch((cause: unknown) => setError(String(cause)))
      attempt.current = null
      setText('')
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const locked = busy || !!attempt.current
  const selectedProfile = runtimeRegistry.profiles.find((profile) => profile.id === runtimeId)
  const selectClass = 'h-10 w-full rounded-lg border bg-background px-3 text-sm disabled:opacity-50'
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) setOpen(value)
      }}
    >
      <DialogContent
        className="max-w-xl gap-5 rounded-2xl p-6"
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>Start a task</DialogTitle>
          <DialogDescription>
            Choose an agent and model, then send an idea to any of your computers.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            void dispatch()
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5 text-xs text-muted-foreground">
              Server
              <select
                aria-label="Server"
                className={selectClass}
                value={runtimeId}
                disabled={locked}
                onChange={(event) => setRuntimeId(event.target.value)}
              >
                {runtimeRegistry.profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5 text-xs text-muted-foreground">
              Project
              <select
                aria-label="Project"
                className={selectClass}
                value={repositoryId}
                disabled={locked || loading}
                onChange={(event) => setRepositoryId(event.target.value)}
              >
                <option value="" disabled>
                  {loading ? 'Loading projects…' : 'Choose a project'}
                </option>
                {snapshot?.workspace.repositories.map((repository) => (
                  <option key={repository.id} value={repository.id}>
                    {repository.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selection && loadedRuntimeId === runtimeId && selectedProfile && (
            <WorkspaceScope key={runtimeId} profile={selectedProfile}>
              <TaskLauncherControls
                selection={selection}
                onChange={setSelection}
                disabled={locked || loading}
              />
            </WorkspaceScope>
          )}
          <textarea
            autoFocus
            aria-label="Task prompt"
            placeholder="What would you like to work on?"
            className="min-h-36 w-full resize-y rounded-xl border bg-muted/30 p-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={text}
            maxLength={120000}
            disabled={locked}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                void dispatch()
              }
            }}
          />
          {(error || shortcutError) && (
            <p role="alert" className="text-xs text-destructive">
              {error || shortcutError}
            </p>
          )}
          {error && !attempt.current && !loading && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setRefresh((value) => value + 1)}
            >
              Retry server connection
            </Button>
          )}
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-muted-foreground">
              {attempt.current
                ? 'Retry keeps the same task and message.'
                : '⌘ / Ctrl + Enter to dispatch'}
            </span>
            <Button
              type="submit"
              disabled={
                busy ||
                (!attempt.current &&
                  (!snapshot ||
                    loading ||
                    !repositoryId ||
                    !selection ||
                    loadedRuntimeId !== runtimeId ||
                    !text.trim()))
              }
            >
              {busy ? 'Dispatching…' : attempt.current ? 'Retry dispatch' : 'Start task'}
              <ArrowUpRight size={15} />
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
