import { useEffect, useRef, useState } from 'react'
import { AlarmClock, ArrowUpRight, Check, Monitor, Plus, Search, Terminal } from 'lucide-react'
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
  const store = useWorkspace()
  return store.runtimes.map((entry) =>
    entry.profile.id === store.activeRuntimeId
      ? {
          ...entry,
          connected: store.connected,
          snapshot: store.snapshot
            ? { ...store.snapshot, workspace: store.workspace }
            : entry.snapshot,
        }
      : entry,
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
      await store.refreshRuntime(owner.profile)
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

export function WorkspaceTerminalSurface({
  target,
  onHide,
  onSelect,
  embedded = false,
  onLifecycleError,
}: {
  target: TerminalTarget
  onHide: () => void
  onSelect?: (target: TerminalTarget) => void
  embedded?: boolean
  onLifecycleError?: (message: string) => void
}) {
  const computers = useWorkspaceComputers()
  const host = useStudioHost()
  const [error, setError] = useState('')
  const reportError = onLifecycleError ?? setError
  const owner = computers.find((entry) => entry.profile.id === target.runtimeId)
  const session = owner?.snapshot?.terminals.find((session) => session.id === target.id)
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
        {owner.connected
          ? 'Waiting for terminal session… It may have been closed.'
          : 'This computer is offline. Reconnect to resume its terminals.'}
        {error && (
          <span role="alert" className="block text-destructive">
            {error}
          </span>
        )}
      </p>
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
            <h1 className="truncate text-sm font-medium">{session.title}</h1>
            <p className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
              <span className="truncate" title={session.directory}>
                {terminalContext(session, owner.snapshot?.workspace)}
              </span>
              <span aria-hidden="true">·</span>
              <Monitor className="size-3 shrink-0" />
              <span className="truncate">{runtimeComputerName(owner)}</span>
              {session.exited && <span>· Exited</span>}
            </p>
          </div>
          <TerminalResourceActions owner={owner} session={session} onError={reportError} />
          {thread && host.openThread && (
            <Button
              size="sm"
              variant="ghost"
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
      <div
        className="m-2 min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-border/60"
        data-terminal-primary
      >
        <TerminalPane
          key={`${target.runtimeId}:${session.taskId}`}
          taskId={session.taskId}
          focusId={session.id}
          repositoryId={session.repositoryId}
          autoCreate={false}
          onClose={onHide}
          onSelectSession={
            onSelect ? (id) => onSelect({ runtimeId: target.runtimeId, id }) : undefined
          }
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
  const [lifecycleError, setLifecycleError] = useState('')
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])
  const sidebar = useNavigationSidebar()
  const sessions = computers.flatMap((owner) =>
    (owner.snapshot?.terminals ?? []).map((session) => ({ owner, session })),
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
              {(['Pinned', 'Active', 'Snoozed', 'Settled'] as const).map((group) => {
                const entries = matches.filter(({ session }) => {
                  const status = session.pinned
                    ? 'Pinned'
                    : session.settledAt
                      ? 'Settled'
                      : session.snoozedUntil && Date.parse(session.snoozedUntil) > now
                        ? 'Snoozed'
                        : 'Active'
                  return status === group
                })
                if (!entries.length) return null
                return (
                  <div key={group} className="mb-3">
                    <h2 className="flex items-center gap-1.5 px-2 py-2 text-[11px] font-medium text-muted-foreground">
                      {group}
                    </h2>
                    {entries.map(({ owner, session }) => {
                      const active =
                        selected?.id === session.id && selected.runtimeId === owner.profile.id
                      return (
                        <div
                          key={`${owner.profile.id}:${session.id}`}
                          className="studio-thread-row mb-1 flex items-center"
                          data-highlighted={active || undefined}
                        >
                          <button
                            type="button"
                            className="studio-thread-card flex min-w-0 flex-1 items-center gap-2.5 border px-2.5 py-2.5 text-left hover:bg-accent"
                            aria-selected={active}
                            onClick={() =>
                              setSelected({ runtimeId: owner.profile.id, id: session.id })
                            }
                          >
                            <Terminal
                              className={cn(
                                'size-4 shrink-0',
                                active ? 'text-primary' : 'text-muted-foreground',
                              )}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium">
                                {session.title}
                              </span>
                              <span className="studio-thread-card-context block truncate text-xs text-muted-foreground">
                                {terminalContext(session, owner.snapshot?.workspace)} ·{' '}
                                {runtimeComputerName(owner)}
                              </span>
                            </span>
                            {session.settledAt ? (
                              <Check
                                className="size-3.5 shrink-0 text-muted-foreground"
                                aria-label="Settled"
                              />
                            ) : session.snoozedUntil && Date.parse(session.snoozedUntil) > now ? (
                              <AlarmClock
                                className="size-3.5 shrink-0 text-muted-foreground"
                                aria-label="Snoozed"
                              />
                            ) : null}
                            <span
                              className={cn(
                                'size-1.5 shrink-0 rounded-full',
                                session.exited || !owner.connected
                                  ? 'bg-muted-foreground/40'
                                  : 'bg-status-success',
                              )}
                              title={
                                session.exited
                                  ? 'Exited'
                                  : owner.connected
                                    ? 'Live session'
                                    : 'Offline'
                              }
                            />
                          </button>
                          <TerminalResourceActions
                            owner={owner}
                            session={session}
                            onError={setLifecycleError}
                          />
                        </div>
                      )
                    })}
                  </div>
                )
              })}
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
            onSelect={setSelected}
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
