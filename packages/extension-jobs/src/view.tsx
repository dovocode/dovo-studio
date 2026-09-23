import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import { ArrowRight, Monitor, Plus, RefreshCw, Workflow } from 'lucide-react'
import { clientScopeKey, useWorkspace, type RuntimeConnection } from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  EmptyState,
  Input,
} from '@dovo/studio-ui'
import { AutomationDetail } from './automation-detail'
import { CachedAutomation } from './cached-automation'
import { aggregateAutomations, type FleetAutomation } from './fleet'
import { newNode } from './graph'
type Selection = {
  runtimeId: string
  automationId: string
  canvas?: boolean
}
type Creation = {
  runtimeId: string
  connection: RuntimeConnection
  id: string
  name: string
}
export default function JobsView() {
  const {
    runtimes,
    activeRuntimeId,
    workspace,
    snapshot,
    connection,
    connected,
    switchRuntime,
    setWorkspace,
    refreshRuntimes,
  } = useWorkspace()
  const [selected, setSelected] = useApplicationState<Selection | null>(null)
  const [search, setSearch] = useApplicationState('')
  const [error, setError] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [refreshing, setRefreshing] = useApplicationState(false)
  const [creating, setCreating] = useApplicationState(false)
  const [owner, setOwner] = useApplicationState('')
  const [name, setName] = useApplicationState('')
  const [pending, setPending] = useApplicationState<Creation | null>(null)
  const completedCreation = useRef('')
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  // Keep unsynced edits on the current host visible while other hosts use saved snapshots.
  const entries = runtimes.map((entry) =>
    entry.profile.id === activeRuntimeId && connection?.token === entry.profile.connection.token
      ? {
          ...entry,
          connected,
          snapshot: snapshot
            ? {
                ...snapshot,
                workspace,
              }
            : entry.snapshot,
        }
      : entry,
  )
  const rows = aggregateAutomations(entries)
  const query = search.trim().toLowerCase()
  const visible = rows.filter((row) =>
    [row.flow.name, row.runtimeName, ...row.projects, row.status].some((value) =>
      value.toLowerCase().includes(query),
    ),
  )
  const chosen =
    selected &&
    rows.find(
      (row) =>
        row.runtime.profile.id === selected.runtimeId && row.flow.id === selected.automationId,
    )
  const ownDetail =
    !!chosen &&
    connected &&
    activeRuntimeId === chosen.runtime.profile.id &&
    connection?.token === chosen.runtime.profile.connection.token
  const back = () => {
    setSelected(null)
    setError('')
  }
  const open = async (row: FleetAutomation, reconnect = false) => {
    if (busy) return
    const attempt = ++request.current
    setSelected({
      runtimeId: row.runtime.profile.id,
      automationId: row.flow.id,
    })
    setError('')
    if (!row.runtime.connected && !reconnect) return
    if (row.runtime.profile.id === activeRuntimeId && connected) return
    setBusy(true)
    try {
      await switchRuntime(row.runtime.profile.id)
    } catch (cause) {
      if (request.current === attempt)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (request.current === attempt) setBusy(false)
    }
  }
  const startCreation = async () => {
    const destination = entries.find((entry) => entry.profile.id === owner)
    if (busy || !destination?.connected || !name.trim()) return
    const attempt = ++request.current
    setError('')
    setBusy(true)
    setPending({
      runtimeId: owner,
      connection: destination.profile.connection,
      id: crypto.randomUUID(),
      name: name.trim(),
    })
    try {
      if (activeRuntimeId !== owner) await switchRuntime(owner)
    } catch (cause) {
      if (request.current === attempt) {
        setPending(null)
        setError(cause instanceof Error ? cause.message : String(cause))
        setBusy(false)
      }
    }
  }
  useEffect(() => {
    if (
      pending &&
      !runtimes.some(
        (entry) =>
          entry.profile.id === pending.runtimeId &&
          entry.profile.connection.token === pending.connection.token,
      )
    ) {
      setPending(null)
      setBusy(false)
      setError(
        'This computer’s connection changed. Choose it again before creating the automation.',
      )
      return
    }
    if (
      !pending ||
      activeRuntimeId !== pending.runtimeId ||
      !connection ||
      connection.token !== pending.connection.token ||
      completedCreation.current === pending.id
    )
      return
    completedCreation.current = pending.id
    try {
      setWorkspace((current) =>
        current.automations.some((flow) => flow.id === pending.id)
          ? current
          : {
              ...current,
              automations: [
                ...current.automations,
                {
                  id: pending.id,
                  name: pending.name,
                  nodes: [newNode('trigger', current, 0)],
                  edges: [],
                },
              ],
            },
      )
      setSelected({
        runtimeId: pending.runtimeId,
        automationId: pending.id,
        canvas: true,
      })
      setCreating(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
    setPending(null)
    setBusy(false)
  }, [pending, activeRuntimeId, connection, setWorkspace, runtimes])
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="studio-page-header flex shrink-0 flex-wrap items-center gap-3 border-b">
        <div className="mr-auto min-w-0">
          <h1 className="text-sm font-medium">Automations</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            {rows.length} automation{rows.length === 1 ? '' : 's'} across your computers
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || refreshing}
          onClick={() => {
            setRefreshing(true)
            void refreshRuntimes()
              .catch((cause) => setError(String(cause)))
              .finally(() => setRefreshing(false))
          }}
        >
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} /> Refresh
        </Button>
        <Button
          size="sm"
          disabled={busy || !entries.some((entry) => entry.connected)}
          onClick={() => {
            setOwner(
              entries.find((entry) => entry.profile.id === activeRuntimeId && entry.connected)
                ?.profile.id ??
                entries.find((entry) => entry.connected)?.profile.id ??
                '',
            )
            setName('')
            setError('')
            setCreating(true)
          }}
        >
          <Plus className="size-3.5" /> New automation
        </Button>
      </header>
      {!selected && error && (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          className={cn(
            'min-h-0 min-w-0 flex-col',
            selected ? 'hidden w-72 shrink-0 border-r lg:flex' : 'flex flex-1',
          )}
        >
          <div className="p-3">
            <Input
              aria-label="Search automations"
              placeholder="Search automations, projects or computers…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <nav
            aria-label="Automations across computers"
            className="min-h-0 flex-1 overflow-y-auto px-2 pb-2"
          >
            {visible.map((row) => (
              <button
                key={row.key}
                disabled={busy}
                aria-current={chosen?.key === row.key ? 'true' : undefined}
                onClick={() => void open(row)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left hover:bg-accent disabled:opacity-60',
                  chosen?.key === row.key && 'bg-accent',
                )}
              >
                <Workflow className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{row.flow.name}</span>
                  <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    <Monitor className="size-3 shrink-0" />
                    <span className="truncate">
                      {row.runtimeName}
                      {row.projects.length ? ` · ${row.projects.join(', ')}` : ''}
                      {!row.runtime.connected ? ' · Offline' : ''}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'mt-1 block text-xs',
                      row.needsInput || row.latest?.status === 'waiting'
                        ? 'text-amber-500'
                        : row.latest?.status === 'failed'
                          ? 'text-destructive'
                          : 'text-muted-foreground',
                    )}
                  >
                    {row.runtime.connected ? row.status : `Last seen: ${row.status.toLowerCase()}`}
                    {row.latest
                      ? ` · ${new Date(row.latest.updatedAt ?? row.latest.createdAt).toLocaleDateString()}`
                      : ''}
                  </span>
                </span>
                <ArrowRight className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            ))}
            {!visible.length && (
              <EmptyState
                icon={<Workflow />}
                title={query ? 'No matching automations' : 'Automate repeatable work'}
                description={
                  query
                    ? 'Search by automation, project or computer.'
                    : 'Create an automation on one of your computers. Its runs appear here alongside your other work.'
                }
              />
            )}
            {entries
              .filter((entry) => !entry.snapshot)
              .map((entry) => (
                <p key={entry.profile.id} className="px-3 py-2 text-xs text-muted-foreground">
                  {entry.profile.name}:{' '}
                  {entry.error ? 'Could not load saved automations.' : 'Loading automations…'}
                </p>
              ))}
          </nav>
        </div>
        {selected && (
          <div className="min-h-0 min-w-0 flex-1">
            {chosen ? (
              ownDetail ? (
                <AutomationDetail
                  key={`${chosen.key}:${clientScopeKey(connection)}`}
                  automationId={chosen.flow.id}
                  initialSurface={selected.canvas ? 'canvas' : 'runs'}
                  onBack={back}
                />
              ) : (
                <CachedAutomation
                  key={chosen.key}
                  row={chosen}
                  busy={busy}
                  error={error}
                  onOpen={() => void open(chosen, true)}
                  onBack={back}
                />
              )
            ) : (
              <EmptyState
                icon={<Workflow />}
                title="Automation unavailable"
                description="This automation or its computer is no longer available."
                action={<Button onClick={back}>Back to automations</Button>}
              />
            )}
          </div>
        )}
      </div>
      <Dialog
        open={creating}
        onOpenChange={(open) => {
          if (!busy) setCreating(open)
        }}
      >
        <DialogContent>
          <DialogTitle>New automation</DialogTitle>
          <DialogDescription>Choose where it runs, then connect its steps.</DialogDescription>
          <label className="space-y-2 text-sm">
            <span>Name</span>
            <Input
              autoFocus
              placeholder="e.g. Review incoming changes"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="space-y-2 text-sm">
            <span>Run on</span>
            <ChoicePicker
              aria-label="Automation computer"
              value={owner}
              onValueChange={setOwner}
              disabled={busy}
            >
              {entries.map((entry) => (
                <option key={entry.profile.id} value={entry.profile.id} disabled={!entry.connected}>
                  {entry.snapshot?.runtimeHost ?? entry.profile.name}
                  {!entry.connected ? ' · Offline' : ''}
                </option>
              ))}
            </ChoicePicker>
          </label>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <Button
            disabled={
              busy ||
              !name.trim() ||
              !entries.find((entry) => entry.profile.id === owner)?.connected
            }
            onClick={() => void startCreation()}
          >
            {busy ? 'Creating…' : 'Create automation'}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  )
}
