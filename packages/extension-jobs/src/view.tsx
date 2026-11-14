import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { randomUUID, resolveRuntimeTarget } from '@dovo/protocol'
import { PageHeader, SidebarHeader, useLeftSidebar } from '@dovo/studio-ui'
import { SearchField } from '@dovo/studio-ui/search-field'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef } from 'react'
import { ArrowLeft, Monitor, Plus, RefreshCw, Workflow } from 'lucide-react'
import {
  clientScopeKey,
  formatDateTime,
  isActiveRuntime,
  useWorkspace,
  type RuntimeConnection,
  type StudioViewProps,
} from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogTitle,
  EmptyState,
  IconButton,
  Input,
} from '@dovo/studio-ui'
import { AutomationDetail } from './automation-detail'
import { CachedAutomation } from './cached-automation'
import { aggregateAutomations, liveAutomationRuntimes, type FleetAutomation } from './fleet'
import { newNode } from './graph'
import { automationDestination } from './automation-destination'
type Selection = {
  runtimeId: string
  automationId: string
  canvas?: boolean
}
/** Section navigation unmounts this page; keep its list position, not the automation view. */
const remembered: { search: string; selected: Selection | null } = { search: '', selected: null }
type Creation = {
  runtimeId: string
  connection: RuntimeConnection
  id: string
  name: string
}
export default function JobsView({ entityId, automationTarget, navigationKey }: StudioViewProps) {
  const uiText = useInterfaceText()

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
  const [selected, setSelected] = useApplicationState<Selection | null>(remembered.selected)
  const [sidebarVisible] = useLeftSidebar()
  const [search, setSearch] = useApplicationState(remembered.search)
  const [error, setError] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [refreshing, setRefreshing] = useApplicationState(false)
  const [creating, setCreating] = useApplicationState(false)
  const [owner, setOwner] = useApplicationState('')
  const [name, setName] = useApplicationState('')
  const [pending, setPending] = useApplicationState<Creation | null>(null)
  useEffect(() => {
    // A new automation opens its canvas once; returning later shows its runs.
    remembered.selected = selected && {
      runtimeId: selected.runtimeId,
      automationId: selected.automationId,
    }
    remembered.search = search
  }, [selected, search])
  const completedCreation = useRef('')
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  const entries = liveAutomationRuntimes(runtimes, {
    activeRuntimeId,
    connection,
    connected,
    snapshot,
    workspace,
  })
  const rows = aggregateAutomations(entries)
  const destination = automationDestination(rows, activeRuntimeId, entityId, automationTarget)
  const notifiedRow = destination?.row
  const query = search.trim().toLowerCase()
  const visible = rows.filter((row) =>
    [row.flow.name, row.runtimeName, ...row.projects, row.status, row.botJob ?? ''].some((value) =>
      value.toLowerCase().includes(query),
    ),
  )
  const chosen =
    selected && (!automationTarget || destination)
      ? rows.find(
          (row) =>
            row.runtime.profile.id === selected.runtimeId && row.flow.id === selected.automationId,
        )
      : undefined
  const ownDetail =
    !!chosen && connected && isActiveRuntime(chosen.runtime.profile, activeRuntimeId, connection)
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
  useEffect(() => {
    if (notifiedRow) void open(notifiedRow)
  }, [entityId, notifiedRow?.key, automationTarget?.runId, navigationKey])
  const startCreation = async () => {
    const destination = entries.find((entry) => entry.profile.id === owner)
    if (busy || !destination?.connected || !name.trim()) return
    const attempt = ++request.current
    setError('')
    setBusy(true)
    setPending({
      runtimeId: owner,
      connection: destination.profile.connection,
      id: randomUUID(),
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
    const target = pending && { id: pending.runtimeId, connection: pending.connection }
    if (
      target &&
      !resolveRuntimeTarget(
        runtimes.map((entry) => entry.profile),
        target,
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
      !target ||
      !isActiveRuntime(target, activeRuntimeId, connection) ||
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
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      {!selected && (
        <PageHeader title="Automations">
          <Button
            size="icon"
            variant="ghost"
            aria-label={uiText('Refresh')}
            title={uiText('Refresh')}
            className="size-8"
            disabled={busy || refreshing}
            onClick={() => {
              setRefreshing(true)
              void refreshRuntimes()
                .catch((cause) => setError(String(cause)))
                .finally(() => setRefreshing(false))
            }}
          >
            <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
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
        </PageHeader>
      )}
      {!selected && error && (
        <p role="alert" className="px-4 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex min-h-0 min-w-0 flex-1">
        <div
          style={selected && !sidebarVisible ? { display: 'none' } : undefined}
          className={cn(
            'studio-navigation-sidebar studio-side-panel min-h-0 min-w-0 flex-col bg-background',
            selected ? 'hidden w-72 shrink-0 lg:flex' : 'flex flex-1',
          )}
        >
          <SidebarHeader enabled={!!selected} />
          <div
            className={cn(
              'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden',
              selected ? 'studio-overview-pane bg-sidebar' : 'studio-page-surface bg-background',
            )}
          >
            <div className="shrink-0 border-b border-border/70 px-3 py-2">
              <SearchField
                aria-label="Search automations"
                placeholder="Search automations, Bots, projects or computers…"
                value={search}
                onValueChange={setSearch}
              />
            </div>
            <p
              role="status"
              className="shrink-0 border-b border-border/70 px-3 py-2 text-xs text-muted-foreground"
            >
              {visible.length} automation{visible.length === 1 ? '' : 's'}
              {query ? ` of ${rows.length}` : ' across your computers'}
            </p>
            <nav
              aria-label="Automations across computers"
              className="min-h-0 flex-1 divide-y divide-border/50 overflow-y-auto px-3 py-2"
            >
              {visible.map((row) => (
                <button
                  key={row.key}
                  disabled={busy}
                  aria-current={chosen?.key === row.key ? 'true' : undefined}
                  onClick={() => void open(row)}
                  className={cn(
                    'studio-collection-row w-full text-left disabled:opacity-60',
                    chosen?.key === row.key && 'bg-accent',
                  )}
                >
                  <span className="studio-collection-body">
                    <span className="studio-collection-meta">
                      <span
                        className={cn(
                          'studio-collection-status',
                          row.needsInput || row.latest?.status === 'waiting'
                            ? 'text-status-warning'
                            : row.latest?.status === 'failed'
                              ? 'text-destructive'
                              : 'text-muted-foreground',
                        )}
                      >
                        <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
                        {row.status}
                      </span>
                      {!row.runtime.connected && <span>Offline · Last saved state</span>}
                    </span>
                    <span className="studio-collection-title truncate">{row.flow.name}</span>
                    <span className="studio-collection-context">
                      {row.botJob && <span className="truncate">{row.botJob}</span>}
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <Monitor className="size-3 shrink-0" />
                        <span className="truncate">{row.runtimeName}</span>
                      </span>
                      {row.projects.length > 0 && (
                        <span className="truncate">{row.projects.join(', ')}</span>
                      )}
                    </span>
                  </span>
                  {row.latest && (
                    <time
                      className="studio-collection-date"
                      dateTime={row.latest.updatedAt ?? row.latest.createdAt}
                      title={`Last run updated ${formatDateTime(row.latest.updatedAt ?? row.latest.createdAt)}`}
                    >
                      {formatDateTime(row.latest.updatedAt ?? row.latest.createdAt, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </time>
                  )}
                </button>
              ))}
              {!visible.length && (
                <EmptyState
                  icon={<Workflow />}
                  title={query ? 'No matching automations' : 'Automate repeatable work'}
                  description={
                    query
                      ? 'Search by automation, Bot, project or computer.'
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
        </div>
        {selected && (
          <div className="min-h-0 min-w-0 flex-1">
            {chosen ? (
              ownDetail ? (
                <AutomationDetail
                  key={`${chosen.key}:${clientScopeKey(connection)}:${destination?.runId ?? ''}:${navigationKey ?? ''}`}
                  automationId={chosen.flow.id}
                  initialRunId={notifiedRow?.key === chosen.key ? destination?.runId : undefined}
                  initialSurface={selected.canvas ? 'canvas' : 'runs'}
                  onBack={back}
                />
              ) : (
                <CachedAutomation
                  key={`${chosen.key}:${destination?.runId ?? ''}`}
                  row={chosen}
                  initialRunId={notifiedRow?.key === chosen.key ? destination?.runId : undefined}
                  busy={busy}
                  error={error}
                  onOpen={() => void open(chosen, true)}
                  onBack={back}
                />
              )
            ) : (
              <section className="flex h-full min-h-0 flex-col">
                <PageHeader
                  title="Automation unavailable"
                  leading={
                    <IconButton label="Back to automations" className="size-8" onClick={back}>
                      <ArrowLeft className="size-4" />
                    </IconButton>
                  }
                />
                <EmptyState
                  icon={<Workflow />}
                  title="Automation unavailable"
                  description="This automation or its computer is no longer available."
                  action={<Button onClick={back}>Back to automations</Button>}
                />
              </section>
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
          <label className="grid gap-2 text-xs text-muted-foreground">
            <span>{uiText('Name')}</span>
            <Input
              autoFocus
              placeholder="e.g. Review incoming changes"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
            />
          </label>
          <label className="grid gap-2 text-xs text-muted-foreground">
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
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setCreating(false)}>
              {uiText('Cancel')}
            </Button>
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
