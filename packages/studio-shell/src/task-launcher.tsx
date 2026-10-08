import { runtimeComputerName, taskProjectGroups, preferredProjectEntry } from '@dovo/protocol'
import { TaskLauncherControls } from './task-launcher-controls'
import { useEffect, useRef, useState } from 'react'
import { useAppPreferences, useWorkspace, useStudioHost, WorkspaceScope } from '@dovo/studio-core'
import {
  randomUUID,
  snapshotSchema,
  type RuntimeSnapshot,
  type TaskLauncherBridge,
} from '@dovo/protocol'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  Button,
  ComposerSurface,
  ComposerTextarea,
  ComposerSubmit,
  ComposerWorkspaceBar,
} from '@dovo/studio-ui'
import { ChevronDown, Folder, Monitor } from 'lucide-react'
import {
  launcherDefaultAgent,
  type LauncherAgent,
  createLauncherTask,
  dispatchLauncherTask,
  type LauncherAttempt,
} from '@dovo/protocol'

export function TaskLauncher({ bridge }: { bridge: TaskLauncherBridge }) {
  const { runtimeRegistry } = useWorkspace()
  const { registerCommand } = useStudioHost()
  const { taskLauncherShortcut } = useAppPreferences()
  useEffect(
    () =>
      registerCommand({
        id: 'studio.task-launcher',
        title: 'Start task · global launcher',
        run: () => {
          void bridge
            .open()
            .catch((error: unknown) => console.error('Could not open quick task:', error))
        },
      }),
    [registerCommand, bridge],
  )
  useEffect(() => {
    void bridge
      .sync(runtimeRegistry)
      .catch((error: unknown) => console.error('Could not update quick task computers:', error))
  }, [bridge, runtimeRegistry])
  useEffect(() => {
    void bridge
      .configure(taskLauncherShortcut)
      .then((result) => {
        if (result.error) console.error(result.error)
      })
      .catch((error: unknown) => console.error('Could not configure quick task:', error))
  }, [bridge, taskLauncherShortcut])
  return null
}

export function TaskLauncherForm({ bridge }: { bridge: TaskLauncherBridge }) {
  const { runtimeRegistry, activeRuntimeId, readRuntime, runtimes } = useWorkspace()
  const [open, setOpen] = useState(true)
  const input = useRef<HTMLTextAreaElement>(null)
  const [runtimeId, setRuntimeId] = useState(activeRuntimeId ?? '')
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null)
  const [repositoryId, setRepositoryId] = useState('')
  const [selection, setSelection] = useState<LauncherAgent | null>(null)
  const [loadedRuntimeId, setLoadedRuntimeId] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const attempt = useRef<LauncherAttempt | null>(null)
  const submitting = useRef(false)
  const manualSelection = useRef(false)
  useEffect(() => bridge.subscribe(() => setOpen(true)), [bridge])
  const close = () => {
    setOpen(false)
    void bridge.dismiss().catch((error: unknown) => setError(String(error)))
  }
  useEffect(() => {
    if (!open || runtimeRegistry.profiles.some((profile) => profile.id === runtimeId)) return
    setRuntimeId(
      runtimeRegistry.profiles.find((profile) => profile.id === activeRuntimeId)?.id ??
        runtimeRegistry.profiles[0]?.id ??
        '',
    )
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
  }, [open, runtimeId, runtimeRegistry.profiles, readRuntime, refresh])
  useEffect(() => {
    if (attempt.current) return
    if (loadedRuntimeId !== runtimeId) manualSelection.current = false
    if (!snapshot || loadedRuntimeId !== runtimeId) return
    const repository = snapshot?.workspace.repositories.find((entry) => entry.id === repositoryId)
    setSelection((previous) =>
      repository
        ? manualSelection.current && previous
          ? previous
          : launcherDefaultAgent(snapshot, repository)
        : null,
    )
  }, [snapshot, repositoryId, loadedRuntimeId, runtimeId])
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
          task: {
            ...createLauncherTask(snapshot, repository, agent, text, randomUUID()),
            harnessCustomized: manualSelection.current || undefined,
          },
          profile,
          messageId: randomUUID(),
          text: text.trim(),
          created: false,
        }
      }
      const current = attempt.current
      if (!current) return
      await dispatchLauncherTask(current, readRuntime)
      attempt.current = null
      setText('')
      close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const locked = busy || !!attempt.current
  const selectedRepository = snapshot?.workspace.repositories.find(
    (entry) => entry.id === repositoryId,
  )
  const projectGroups = taskProjectGroups(
    runtimeRegistry.profiles.flatMap((profile) => {
      const overview = runtimes.find((entry) => entry.profile.id === profile.id)
      const current = profile.id === runtimeId && loadedRuntimeId === runtimeId && snapshot
      const available = current || overview?.snapshot
      return (available?.workspace.repositories ?? []).map((repository) => ({
        repository,
        runtimeId: profile.id,
        profile,
        defaults: available?.defaults,
        online: overview?.connected ?? !!current,
      }))
    }),
  )
  const selectedGroup = projectGroups.find((group) =>
    group.entries.some(
      (entry) => entry.runtimeId === runtimeId && entry.repository.id === repositoryId,
    ),
  )
  const selectedProfile = runtimeRegistry.profiles.find((profile) => profile.id === runtimeId)
  const selectClass =
    'h-7 min-w-0 max-w-48 appearance-none bg-transparent pr-5 text-[0.6875rem] outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50'
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          if (value) setOpen(true)
          else close()
        }
      }}
    >
      <DialogContent
        className="max-w-[calc(100vw-24px)] max-h-[calc(100vh-24px)] overflow-y-auto gap-5 rounded-2xl p-6"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          input.current?.focus()
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        <DialogHeader className="input-preview-drag">
          <DialogTitle>Start a task</DialogTitle>
          <DialogDescription>
            Choose an agent and model, then send an idea to any of your computers.
          </DialogDescription>
        </DialogHeader>
        <div>
          <ComposerSurface
            onSubmit={(event) => {
              event.preventDefault()
              void dispatch()
            }}
            controls={
              selection &&
              loadedRuntimeId === runtimeId &&
              selectedProfile &&
              selectedRepository ? (
                <WorkspaceScope key={runtimeId} profile={selectedProfile}>
                  <TaskLauncherControls
                    repository={selectedRepository}
                    selection={selection}
                    onChange={(selection) => {
                      manualSelection.current = true
                      setSelection(selection)
                    }}
                    disabled={locked || loading}
                  />
                </WorkspaceScope>
              ) : (
                <span role="status" className="px-2 text-xs text-muted-foreground">
                  {loading ? 'Loading agent settings…' : 'Choose a computer and project below'}
                </span>
              )
            }
            actions={
              <ComposerSubmit
                busy={busy}
                aria-label={attempt.current ? 'Retry dispatch' : 'Start task'}
                title={busy ? 'Dispatching…' : attempt.current ? 'Retry dispatch' : 'Start task'}
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
              />
            }
            error={error}
          >
            <ComposerTextarea
              ref={input}
              autoFocus
              aria-label="Task prompt"
              placeholder="What would you like to build or fix?"
              value={text}
              maxLength={120000}
              disabled={locked}
              onChange={(event) => setText(event.target.value)}
            />
          </ComposerSurface>
          <ComposerWorkspaceBar>
            <label className="relative flex min-w-0 items-center gap-1.5 px-2">
              <Folder className="size-3 shrink-0" />
              <select
                aria-label="Project"
                className={selectClass}
                value={selectedGroup?.key ?? ''}
                disabled={locked || !projectGroups.length}
                onChange={(event) => {
                  const group = projectGroups.find((group) => group.key === event.target.value)
                  const preferred = group && preferredProjectEntry(group.entries, runtimeId)
                  if (preferred) {
                    setRuntimeId(preferred.runtimeId)
                    setRepositoryId(preferred.repository.id)
                  }
                }}
              >
                <option value="" disabled>
                  {loading ? 'Loading projects…' : 'Choose a project'}
                </option>
                {projectGroups.map((group) => (
                  <option
                    key={group.key}
                    value={group.key}
                    disabled={!preferredProjectEntry(group.entries, runtimeId)}
                  >
                    {group.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 size-3" />
            </label>
            {runtimeRegistry.profiles.length !== 1 && (
              <>
                <span className="h-4 border-l border-border/60" aria-hidden="true" />
                <label className="relative flex min-w-0 items-center gap-1.5 px-2">
                  <Monitor className="size-3 shrink-0" />
                  <select
                    aria-label="Server"
                    className={selectClass}
                    value={runtimeId}
                    disabled={locked}
                    onChange={(event) => {
                      const target = selectedGroup?.entries.find(
                        (entry) =>
                          entry.runtimeId === event.target.value &&
                          entry.online &&
                          !entry.repository.gitIdentityError,
                      )
                      if (target) {
                        setRuntimeId(target.runtimeId)
                        setRepositoryId(target.repository.id)
                      }
                    }}
                  >
                    {!runtimeRegistry.profiles.length && (
                      <option value="">Connect a computer</option>
                    )}
                    {runtimeRegistry.profiles.map((profile) => (
                      <option
                        key={profile.id}
                        value={profile.id}
                        disabled={
                          !selectedGroup?.entries.some(
                            (entry) =>
                              entry.runtimeId === profile.id &&
                              entry.online &&
                              !entry.repository.gitIdentityError,
                          )
                        }
                      >
                        {runtimeComputerName({
                          profile,
                          snapshot: runtimes.find((entry) => entry.profile.id === profile.id)
                            ?.snapshot,
                        })}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 size-3" />
                </label>
              </>
            )}
          </ComposerWorkspaceBar>
          {error && !attempt.current && !loading && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => setRefresh((value) => value + 1)}
            >
              Retry server connection
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
