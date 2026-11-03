import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, ChevronDown, Monitor, Pencil, Plus, Search, Terminal } from 'lucide-react'
import { Schema } from 'effect'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  decodeResult,
  runtimeComputerName,
  STUDIO_TERMINAL_SCOPE,
  type TerminalInfo,
  type UpdateTerminal,
} from '@dovo/protocol'
import {
  responses,
  useStudioHost,
  useWorkspace,
  WorkspaceScope,
  type StudioViewProps,
} from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  HeaderContent,
  IconButton,
  Input,
  SidebarHeader,
  useNavigationSidebar,
  cn,
} from '@dovo/studio-ui'
import { ResizableSidebar } from '../detail/resizable-sidebar'
import { TerminalPane } from './terminal-pane'
import { TerminalStarter } from './terminal-starter'
import { WorkspaceResourceMenu } from '../unified/workspace-resource-menu'
import { WorkspaceTerminalRow } from '../unified/workspace-rows'
import { terminalStatus, type TerminalStatusTone } from './terminal-status'

const statusColors: Record<TerminalStatusTone, string> = {
  muted: 'text-muted-foreground',
  working: 'text-primary',
  warning: 'text-status-warning',
  success: 'text-status-success',
  error: 'text-destructive',
}

const targetSchema = Schema.Struct({ runtimeId: Schema.String, id: Schema.String })
export type TerminalTarget = Schema.Schema.Type<typeof targetSchema>
export function readTerminalTarget(value?: string): TerminalTarget | undefined {
  try {
    const result = decodeResult(targetSchema, JSON.parse(value ?? ''))
    return result.success ? result.data : undefined
  } catch {
    return undefined
  }
}

/** Use the active editor's snapshot immediately, including its optimistic workspace edits. */
export function useWorkspaceComputers() {
  const { runtimes, activeRuntimeId, connected, snapshot, workspace } = useWorkspace()
  return useMemo(
    () =>
      runtimes.map((entry) =>
        entry.profile.id === activeRuntimeId
          ? {
              ...entry,
              connected,
              snapshot: snapshot ? { ...snapshot, workspace } : entry.snapshot,
            }
          : entry,
      ),
    [runtimes, activeRuntimeId, connected, snapshot, workspace],
  )
}

export function NewWorkspaceTerminal({ onOpen }: { onOpen: (target: TerminalTarget) => void }) {
  const computers = useWorkspaceComputers()
  return <TerminalStarter computers={computers} onOpen={onOpen} />
}

export function NewWorkspaceTerminalDialog({
  open,
  onOpenChange,
  onOpen,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpen: (target: TerminalTarget) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogTitle>New terminal</DialogTitle>
        <DialogDescription>Open a shell on a paired computer.</DialogDescription>
        <NewWorkspaceTerminal
          onOpen={(target) => {
            onOpen(target)
            onOpenChange(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

/** Terminal workflow metadata never changes the lifetime of its shell. */
function TerminalResourceActions({
  owner,
  session,
  onError,
}: {
  owner: ReturnType<typeof useWorkspaceComputers>[number]
  session: TerminalInfo
  onError: (message: string) => void
}) {
  const store = useWorkspace()
  const pendingRef = useRef(false)
  const [pending, setPending] = useState(false)
  const change = async (updates: Omit<UpdateTerminal, 'id'>) => {
    if (!owner.connected || pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    onError('')
    try {
      await store.readRuntime(
        owner.profile,
        '/api/terminals/update',
        { id: session.id, ...updates },
        responses.terminal,
        'POST',
      )
      await store.refreshRuntime(owner.profile).catch(() => undefined)
    } catch (cause: unknown) {
      onError(
        `Could not update ${session.title}: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  return (
    <div className="flex shrink-0 flex-col items-end">
      <WorkspaceResourceMenu
        title={session.title}
        pinned={session.pinned ?? false}
        settled={Boolean(session.settledAt)}
        snoozedUntil={session.snoozedUntil}
        disabled={!owner.connected || pending}
        onPin={() => void change({ pinned: !session.pinned })}
        onSettle={() => void change({ settled: !session.settledAt })}
        onSnooze={(until) => void change({ snoozedUntil: until })}
      />
    </div>
  )
}

function TerminalTitle({
  owner,
  session,
  onError,
}: {
  owner: ReturnType<typeof useWorkspaceComputers>[number]
  session: TerminalInfo
  onError: (message: string) => void
}) {
  const store = useWorkspace()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  const [error, setError] = useState('')
  const save = async (next: string | null) => {
    if (pendingRef.current || !owner.connected) return
    pendingRef.current = true
    setPending(true)
    setError('')
    onError('')
    try {
      await store.readRuntime(
        owner.profile,
        '/api/terminals/update',
        { id: session.id, title: next },
        responses.terminal,
        'POST',
      )
      await store.refreshRuntime(owner.profile)
      setOpen(false)
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }
  return (
    <>
      <h1 className="min-w-0 text-sm font-medium">
        <button
          type="button"
          aria-label="Rename terminal"
          disabled={!owner.connected}
          className="group/title inline-flex max-w-full items-center gap-1.5 text-left"
          onClick={() => {
            setTitle(session.title)
            setError('')
            setOpen(true)
          }}
        >
          <span className="truncate">{session.title}</span>
          <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover/title:opacity-100 group-focus-visible/title:opacity-100" />
        </button>
      </h1>
      <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
        <DialogContent className="max-w-md">
          <DialogTitle>Rename terminal</DialogTitle>
          <DialogDescription>
            Choose a name, or let the shell and its programs update it automatically.
          </DialogDescription>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              if (title.trim()) void save(title.trim())
            }}
          >
            <Input
              aria-label="Terminal title"
              autoFocus
              maxLength={256}
              value={title}
              disabled={pending}
              onChange={(event) => setTitle(event.target.value)}
            />
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending || !owner.connected}
                onClick={() => void save(null)}
              >
                Use automatic title
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !owner.connected || !title.trim()}>
                Save
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function WorkspaceTerminalSurface({
  target,
  onHide,
  onNew,
  embedded = false,
  onLifecycleError,
}: {
  target: TerminalTarget
  onHide: () => void
  onNew?: () => void
  embedded?: boolean
  onLifecycleError?: (message: string) => void
}) {
  const computers = useWorkspaceComputers()
  const host = useStudioHost()
  const [error, setError] = useState('')
  const reportError = onLifecycleError ?? setError
  const owner = computers.find((entry) => entry.profile.id === target.runtimeId)
  const currentSession = owner?.snapshot?.terminals.find((session) => session.id === target.id)
  // Keep an established pane mounted across delayed snapshots and its own close response.
  // Only the explicit successful-close callback removes the workspace reference.
  const knownSession = useRef<{ key: string; session: TerminalInfo } | undefined>(undefined)
  const targetKey = JSON.stringify([target.runtimeId, target.id])
  if (knownSession.current?.key !== targetKey) knownSession.current = undefined
  if (currentSession) knownSession.current = { key: targetKey, session: currentSession }
  const session = currentSession ?? knownSession.current?.session
  const status = session ? terminalStatus(session, owner?.connected ?? false) : undefined
  const thread = owner?.snapshot?.workspace.tasks.find((task) => task.id === session?.taskId)
  if (!owner)
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        This terminal’s computer is no longer paired.
        {error && (
          <span role="alert" className="block text-destructive">
            {error}
          </span>
        )}
      </p>
    )
  if (!session)
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        {!owner.snapshot
          ? 'Loading terminal sessions…'
          : owner.connected
            ? 'Waiting for terminal session… It may have been closed.'
            : 'This computer is offline. Reconnect to resume its terminals.'}
        {error && (
          <span role="alert" className="block text-destructive">
            {error}
          </span>
        )}
      </p>
    )
  if (session.taskId !== STUDIO_TERMINAL_SCOPE)
    return (
      <div role="status" className="p-6 text-sm text-muted-foreground">
        <p>This terminal belongs to a thread. Open the thread to use it.</p>
        <div className="mt-3 flex gap-2">
          {thread && host.openThread && (
            <Button
              size="sm"
              onClick={() =>
                host.openThread?.({
                  runtimeId: target.runtimeId,
                  threadId: thread.id,
                  title: thread.title,
                })
              }
            >
              Open thread <ArrowUpRight className="size-3.5" />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onHide}>
            Back to terminals
          </Button>
        </div>
      </div>
    )
  return (
    <WorkspaceScope profile={owner.profile}>
      <HeaderContent enabled={!embedded}>
        <header
          className="studio-task-thread-header"
          data-window-edge={!embedded || undefined}
          data-window-right-edge={!embedded || undefined}
        >
          <Terminal className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <TerminalTitle key={targetKey} owner={owner} session={session} onError={reportError} />
            <p className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
              <span className="truncate" title={session.directory}>
                {terminalContext(session, owner.snapshot?.workspace)}
              </span>
              <span aria-hidden="true">·</span>
              <Monitor className="size-3 shrink-0" />
              <span className="truncate">{runtimeComputerName(owner)}</span>
              {status && (
                <span className={cn('shrink-0', statusColors[status.tone])}>· {status.label}</span>
              )}
            </p>
            {status?.detail && (
              <p className="truncate text-xs text-muted-foreground" title={status.detail}>
                {status.detail}
              </p>
            )}
          </div>
          <TerminalResourceActions owner={owner} session={session} onError={reportError} />
        </header>
      </HeaderContent>
      {error && (
        <p role="alert" className="border-b p-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {!owner.connected && (
        <p role="status" className="border-b p-2 text-xs text-muted-foreground">
          Computer offline. Reconnect to resume this session.
        </p>
      )}
      {owner.connected && !currentSession && (
        <p role="status" className="border-b p-2 text-xs text-muted-foreground">
          {!owner.snapshot
            ? 'Loading terminal sessions…'
            : 'Waiting for terminal session… This workspace remains open.'}
        </p>
      )}
      <div
        className="m-2 min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border/60"
        data-terminal-primary
      >
        <TerminalPane
          key={targetKey}
          taskId={session.taskId}
          focusId={session.id}
          sessionScopeId={target.id}
          repositoryId={session.repositoryId}
          autoCreate={false}
          onClose={onHide}
          onNewSession={onNew}
          onSessionsClosed={(ids) => {
            if (ids.includes(target.id)) onHide()
          }}
        />
      </div>
    </WorkspaceScope>
  )
}

export function terminalContext(
  session: TerminalInfo,
  workspace: ReturnType<typeof useWorkspace>['workspace'] | undefined,
) {
  if (session.taskId !== STUDIO_TERMINAL_SCOPE)
    return workspace?.tasks.find((task) => task.id === session.taskId)?.title ?? 'Thread terminal'
  const project = workspace?.repositories.find((repo) => repo.id === session.repositoryId)
  if (!project) return 'Home folder'
  return session.checkoutBranch ? `${project.name} · ${session.checkoutBranch}` : project.name
}

export default function TerminalWorkspace({ entityId }: StudioViewProps) {
  const computers = useWorkspaceComputers()
  const [selected, setSelected] = useApplicationState<TerminalTarget | undefined>(() =>
    readTerminalTarget(entityId),
  )
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    Pinned: true,
    'Needs input': true,
    Working: true,
    Active: true,
    Snoozed: false,
    Settled: false,
  })
  const [lifecycleError, setLifecycleError] = useState('')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])
  const sidebar = useNavigationSidebar()
  const sessions = computers.flatMap((owner) =>
    (owner.snapshot?.terminals ?? [])
      .filter((session) => session.taskId === STUDIO_TERMINAL_SCOPE)
      .map((session) => ({ owner, session })),
  )
  const matches = sessions.filter(({ owner, session }) =>
    `${session.title} ${terminalContext(session, owner.snapshot?.workspace)} ${runtimeComputerName(owner)}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  )
  useEffect(() => {
    const next = readTerminalTarget(entityId)
    if (next) setSelected(next)
  }, [entityId])
  return (
    <section className="flex min-h-0 min-w-0 flex-1" aria-label="Terminals workspace">
      {!sidebar?.collapsed && (
        <ResizableSidebar
          preference="threadSidebarWidth"
          side="left"
          label="Terminal sidebar"
          maxFraction={0.45}
          maxWidth={640}
          className="studio-task-sidebar flex min-h-0 flex-col"
        >
          <SidebarHeader />
          <div className="studio-overview-pane flex min-h-0 flex-1 flex-col overflow-hidden bg-sidebar">
            <div className="studio-thread-sidebar-controls space-y-2 border-b px-3 pb-2 pt-3">
              <div className="flex items-center gap-2">
                <div className="studio-thread-search relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    aria-label="Search terminals"
                    placeholder="Search terminals…"
                    value={search}
                    className="h-8 pl-8 text-xs md:text-xs"
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <IconButton
                  label="New terminal"
                  title="New terminal"
                  className="studio-thread-new size-8"
                  onClick={() => setCreating(true)}
                >
                  <Plus className="size-4" />
                </IconButton>
              </div>
              <div className="flex items-center justify-between px-1 text-xs text-muted-foreground">
                <span>Terminals</span>
                <span className="tabular-nums">{sessions.length}</span>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {(['Pinned', 'Needs input', 'Working', 'Active', 'Snoozed', 'Settled'] as const).map(
                (group) => {
                  const entries = matches.filter(({ owner, session }) => {
                    const activity = terminalStatus(session, owner.connected)
                    const status = session.pinned
                      ? 'Pinned'
                      : session.settledAt
                        ? 'Settled'
                        : session.snoozedUntil && Date.parse(session.snoozedUntil) > now
                          ? 'Snoozed'
                          : activity.section === 'working'
                            ? 'Working'
                            : activity.section === 'needs-input'
                              ? 'Needs input'
                              : 'Active'
                    return status === group
                  })
                  if (!entries.length) return null
                  return (
                    <details
                      key={group}
                      data-section={group.toLowerCase().replaceAll(' ', '-')}
                      open={openSections[group]}
                      className="group studio-list-section mb-1 shrink-0"
                    >
                      <summary
                        className="studio-list-section-header"
                        onClick={(event) => {
                          event.preventDefault()
                          setOpenSections((previous) => ({
                            ...previous,
                            [group]: !previous[group],
                          }))
                        }}
                      >
                        <ChevronDown
                          size={11}
                          className="studio-list-section-chevron"
                          aria-hidden="true"
                        />
                        {group !== 'Pinned' && (
                          <span className="studio-thread-section-dot" aria-hidden="true" />
                        )}
                        <span className="min-w-0 flex-1 truncate">{group}</span>
                        <span>{entries.length}</span>
                      </summary>
                      {openSections[group] &&
                        entries.map(({ owner, session }) => {
                          const activity = terminalStatus(session, owner.connected)
                          const active =
                            selected?.id === session.id && selected.runtimeId === owner.profile.id
                          const repository = owner.snapshot?.workspace.repositories.find(
                            (item) => item.id === session.repositoryId,
                          )
                          const branch =
                            session.checkoutBranch ??
                            (session.execution === 'worktree' ? undefined : repository?.branch)
                          return (
                            <WorkspaceTerminalRow
                              key={`${owner.profile.id}:${session.id}`}
                              title={session.title}
                              selected={active}
                              disabled={false}
                              status={
                                session.settledAt
                                  ? 'settled'
                                  : session.snoozedUntil && Date.parse(session.snoozedUntil) > now
                                    ? 'snoozed'
                                    : 'active'
                              }
                              onSelect={() =>
                                setSelected({ runtimeId: owner.profile.id, id: session.id })
                              }
                              project={repository?.name ?? 'Home folder'}
                              checkout={
                                branch ??
                                (repository
                                  ? (session.directory ?? 'Local checkout')
                                  : 'Home folder')
                              }
                              checkoutIsBranch={branch !== undefined}
                              state={activity.label}
                              stateTone={activity.tone}
                              stateDetail={activity.detail}
                              computer={runtimeComputerName(owner)}
                              runtimeIcon={owner.snapshot?.runtimeIcon}
                              pinned={session.pinned ?? false}
                              offline={!owner.connected}
                              actions={
                                <TerminalResourceActions
                                  owner={owner}
                                  session={session}
                                  onError={setLifecycleError}
                                />
                              }
                            />
                          )
                        })}
                    </details>
                  )
                },
              )}
              {!matches.length && (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {search ? 'No matching terminals.' : 'Your terminal sessions will appear here.'}
                </p>
              )}
            </div>
          </div>
        </ResizableSidebar>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {lifecycleError && (
          <p role="alert" className="border-b p-2 text-xs text-destructive">
            {lifecycleError}
          </p>
        )}
        {selected ? (
          <WorkspaceTerminalSurface
            target={selected}
            onHide={() => setSelected(undefined)}
            onNew={() => setCreating(true)}
            onLifecycleError={setLifecycleError}
          />
        ) : (
          <>
            <HeaderContent>
              <header className="studio-task-thread-header" data-window-edge data-window-right-edge>
                <Terminal className="size-4 text-muted-foreground" />
                <h1 className="flex-1 text-sm font-medium">Terminals</h1>
                <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
                  <Plus className="size-4" />
                  New terminal
                </Button>
              </header>
            </HeaderContent>
            <div className="flex min-h-0 flex-1 items-center justify-center p-8">
              <div className="w-full max-w-2xl text-center">
                <h2 className="startup-heading text-balance text-xl font-medium tracking-tight sm:text-2xl">
                  What would you like to work on?
                </h2>
                <div className="mt-6">
                  <NewWorkspaceTerminal onOpen={setSelected} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
      <NewWorkspaceTerminalDialog open={creating} onOpenChange={setCreating} onOpen={setSelected} />
    </section>
  )
}
