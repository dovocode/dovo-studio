import { useEffect, useRef, useState } from 'react'
import { Schema } from 'effect'
import {
  decodeResult,
  runtimeComputerName,
  STUDIO_TERMINAL_SCOPE,
  type TerminalInfo,
} from '@dovo/protocol'
import { responses, useWorkspace, WorkspaceScope, type StudioViewProps } from '@dovo/studio-core'
import { Button, ChoicePicker, Input, SidebarHeader, useNavigationSidebar } from '@dovo/studio-ui'
import { ResizableSidebar } from '../detail/resizable-sidebar'
import { TerminalPane } from './terminal-pane'

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
  const store = useWorkspace()
  const computers = useWorkspaceComputers()
  const [runtimeId, setRuntimeId] = useState(
    store.activeRuntimeId ?? computers[0]?.profile.id ?? '',
  )
  const [repositoryId, setRepositoryId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const owner = computers.find((entry) => entry.profile.id === runtimeId)
  const attempt = useRef(0)
  useEffect(
    () => () => {
      attempt.current++
    },
    [],
  )
  return (
    <form
      className="space-y-2 border-b p-3"
      aria-label="New workspace terminal"
      onSubmit={(event) => {
        event.preventDefault()
        if (!owner?.connected || busy) return
        const generation = ++attempt.current
        setBusy(true)
        setError('')
        void store
          .readRuntime(
            owner.profile,
            '/api/terminals/workspace',
            { repositoryId: repositoryId || undefined },
            responses.terminal,
          )
          .then((session) => {
            if (generation === attempt.current)
              onOpen({ runtimeId: owner.profile.id, id: session.id })
          })
          .catch((cause: unknown) => {
            if (generation === attempt.current) setError(String(cause))
          })
          .finally(() => {
            if (generation === attempt.current) setBusy(false)
          })
      }}
    >
      <ChoicePicker
        aria-label="Terminal computer"
        value={runtimeId}
        disabled={busy}
        onValueChange={(id) => {
          setRuntimeId(id)
          setRepositoryId('')
          setError('')
        }}
      >
        {!computers.length && <option value="">No paired computers</option>}
        {computers.map((entry) => (
          <option key={entry.profile.id} value={entry.profile.id}>
            {runtimeComputerName(entry)}
            {entry.connected ? '' : ' · offline'}
          </option>
        ))}
      </ChoicePicker>
      <ChoicePicker
        aria-label="Terminal working directory"
        value={repositoryId}
        disabled={busy}
        onValueChange={setRepositoryId}
      >
        <option value="">Home folder</option>
        {owner?.snapshot?.workspace.repositories.map((repo) => (
          <option key={repo.id} value={repo.id}>
            {repo.name}
          </option>
        ))}
      </ChoicePicker>
      <Button size="sm" className="w-full" disabled={!owner?.connected || busy} type="submit">
        {busy ? 'Opening…' : 'New terminal'}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  )
}

export function WorkspaceTerminalSurface({
  target,
  onHide,
  onSelect,
}: {
  target: TerminalTarget
  onHide: () => void
  onSelect?: (target: TerminalTarget) => void
}) {
  const computers = useWorkspaceComputers()
  const owner = computers.find((entry) => entry.profile.id === target.runtimeId)
  const session = owner?.snapshot?.terminals.find((session) => session.id === target.id)
  if (!owner)
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        This terminal’s computer is no longer paired.
      </p>
    )
  if (!session)
    return (
      <p role="status" className="p-6 text-sm text-muted-foreground">
        {owner.connected
          ? 'Waiting for terminal session… It may have been closed.'
          : 'This computer is offline. Reconnect to resume its terminals.'}
      </p>
    )
  return (
    <WorkspaceScope profile={owner.profile}>
      {!owner.connected && (
        <p role="status" className="border-b p-2 text-xs text-muted-foreground">
          Computer offline. Reconnect to resume this session.
        </p>
      )}
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
    </WorkspaceScope>
  )
}

export function terminalContext(
  session: TerminalInfo,
  workspace: ReturnType<typeof useWorkspace>['workspace'] | undefined,
) {
  if (session.taskId !== STUDIO_TERMINAL_SCOPE)
    return workspace?.tasks.find((task) => task.id === session.taskId)?.title ?? 'Thread terminal'
  return (
    workspace?.repositories.find((repo) => repo.id === session.repositoryId)?.name ?? 'Home folder'
  )
}

export default function TerminalWorkspace({ entityId }: StudioViewProps) {
  const computers = useWorkspaceComputers()
  const [selected, setSelected] = useState<TerminalTarget | undefined>(() =>
    readTerminalTarget(entityId),
  )
  const [search, setSearch] = useState('')
  const sidebar = useNavigationSidebar()
  useEffect(() => {
    const next = readTerminalTarget(entityId)
    if (next) setSelected(next)
  }, [entityId])
  return (
    <section className="flex min-h-0 min-w-0 flex-1" aria-label="Terminals workspace">
      {!sidebar?.collapsed && (
        <ResizableSidebar
          preference="browserSidebarWidth"
          side="left"
          label="Terminal sidebar"
          maxFraction={0.45}
          maxWidth={480}
          className="flex min-h-0 flex-col border-r"
        >
          <SidebarHeader />
          <h1 className="px-3 py-2 text-sm font-medium">Terminals</h1>
          <NewWorkspaceTerminal onOpen={setSelected} />
          <div className="p-2">
            <Input
              aria-label="Search terminals"
              placeholder="Search terminals…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {computers.map((owner) => (
              <div key={owner.profile.id} className="mb-3">
                <h2 className="px-2 py-1 text-xs text-muted-foreground">
                  {runtimeComputerName(owner)}
                  {owner.connected ? '' : ' · offline'}
                </h2>
                {owner.snapshot?.terminals
                  .filter((session) =>
                    `${session.title} ${terminalContext(session, owner.snapshot?.workspace)}`
                      .toLowerCase()
                      .includes(search.toLowerCase()),
                  )
                  .map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      className="mb-1 w-full rounded px-2 py-2 text-left text-xs hover:bg-accent aria-selected:bg-accent"
                      aria-selected={
                        selected?.id === session.id && selected.runtimeId === owner.profile.id
                      }
                      onClick={() => setSelected({ runtimeId: owner.profile.id, id: session.id })}
                    >
                      <span className="block truncate">
                        {session.title}
                        {session.exited ? ' · exited' : ''}
                      </span>
                      <span className="block truncate text-muted-foreground">
                        {terminalContext(session, owner.snapshot?.workspace)}
                      </span>
                    </button>
                  ))}
              </div>
            ))}
            {!computers.some((owner) => owner.snapshot?.terminals.length) && (
              <p className="p-2 text-xs text-muted-foreground">
                Open a terminal above. Existing thread terminals also appear here.
              </p>
            )}
          </div>
        </ResizableSidebar>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {selected ? (
          <WorkspaceTerminalSurface
            target={selected}
            onHide={() => setSelected(undefined)}
            onSelect={setSelected}
          />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            Select a session or open a terminal on a paired computer.
          </p>
        )}
      </div>
    </section>
  )
}
