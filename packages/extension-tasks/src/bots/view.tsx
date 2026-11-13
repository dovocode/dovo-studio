import { BotAvatar } from '@dovo/studio-ui'
import { botCreateHosts, botPairing } from './bot-create-host'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Plus } from 'lucide-react'
import { compareBotActivity } from '@dovo/protocol'
import { useStudioHost, useWorkspace, type StudioViewProps } from '@dovo/studio-core'
import { Button, Input, SidebarHeader, useNavigationSidebar } from '@dovo/studio-ui'
import TasksView from '../view'
import { TaskRow } from '../list/task-row'
import {
  collectTasks,
  retainTaskOwner,
  taskCollectionKey,
  taskSources,
  type TaskEntry,
} from '../list/task-collection'
import { ResizableSidebar } from '../detail/resizable-sidebar'
import { BotCreateForm } from './bot-create'

export default function BotsView({ entityId }: StudioViewProps) {
  const store = useWorkspace()
  const latest = useRef(store)
  latest.current = store
  const host = useStudioHost()
  const sidebar = useNavigationSidebar()
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(
    entityId ? taskCollectionKey(store.activeRuntimeId, entityId) : '',
  )
  const selection = useRef(0)
  const routeEntity = useRef(entityId)
  const sources = useMemo(
    () => taskSources(store),
    [
      store.workspace,
      store.snapshot,
      store.activeRuntimeId,
      store.connected,
      store.runtimes,
      store.connection,
    ],
  )
  const bots = useMemo(
    () =>
      collectTasks(sources)
        .filter(
          (entry) =>
            entry.task.bot &&
            !entry.task.delegation &&
            !entry.task.replica &&
            !entry.task.archivedAt,
        )
        .sort((a, b) => compareBotActivity(a.task, b.task) || a.key.localeCompare(b.key)),
    [sources],
  )
  useEffect(() => {
    // Workbench keeps this view mounted when the Bots route entity changes.
    // Our own navigation is already selected; an external entity change cancels creation.
    if (entityId !== routeEntity.current) {
      routeEntity.current = entityId
      selection.current++
      setBusy(false)
      setError('')
      setCreating(false)
      setSelected(entityId ? taskCollectionKey(store.activeRuntimeId, entityId) : '')
    } else if (entityId && !creating && !bots.some((entry) => entry.key === selected)) {
      setSelected(taskCollectionKey(store.activeRuntimeId, entityId))
    }
  }, [entityId, store.activeRuntimeId])
  useEffect(
    () => () => {
      selection.current++
    },
    [],
  )
  const current = bots.find((entry) => entry.key === selected)
  const supported = store.snapshot?.botsSupported === true
  const canCreate = botCreateHosts(store).some((item) => item.online && item.supported)
  const select = async (entry: TaskEntry) => {
    const attempt = ++selection.current
    setBusy(true)
    setError('')
    try {
      if (entry.source.runtimeId && entry.source.runtimeId !== store.activeRuntimeId)
        await store.switchRuntime(entry.source.runtimeId)
      if (attempt !== selection.current) return
      setSelected(entry.key)
      setCreating(false)
      routeEntity.current = entry.task.id
      host.navigate({ viewId: 'bots', entityId: entry.task.id })
    } catch (cause) {
      if (attempt === selection.current)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (attempt === selection.current) setBusy(false)
    }
  }
  const beginCreate = () => {
    selection.current++
    routeEntity.current = undefined
    setSelected('')
    setCreating(true)
    setError('')
    host.navigate({ viewId: 'bots' })
  }
  const matches = bots.filter((entry) =>
    `${entry.task.title} ${entry.task.bot?.role} ${entry.source.name}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  )
  return (
    <section aria-label="Bots" className="flex min-h-0 min-w-0 flex-1">
      {!sidebar?.collapsed && (
        <ResizableSidebar
          preference="threadSidebarWidth"
          side="left"
          label="Bots sidebar"
          maxFraction={0.4}
          maxWidth={480}
          className="studio-task-sidebar flex min-h-0 flex-col border-r"
        >
          <SidebarHeader />
          <div className="grid shrink-0 gap-2 border-b p-3">
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-sm font-semibold">Bots</h1>
              <Button size="sm" variant="ghost" disabled={!canCreate || busy} onClick={beginCreate}>
                <Plus className="size-4" />
                New Bot
              </Button>
            </div>
            <Input
              aria-label="Search Bots"
              placeholder="Search Bots…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {matches.map((entry) => (
              <div key={entry.key} data-bot-row={entry.task.id} className="mb-2">
                <TaskRow
                  task={entry.task}
                  owner={retainTaskOwner(undefined, entry.source)}
                  selected={selected === entry.key && !creating}
                  onSelect={() => void select(entry)}
                  needsInput={entry.needsInput}
                  terminals={0}
                  editable={false}
                  disabled={busy}
                  titleIcon={
                    <BotAvatar
                      avatar={entry.task.bot?.avatar}
                      name={entry.task.title}
                      className="size-6 rounded-lg [&_svg]:size-3.5"
                    />
                  }
                />
                {entry.task.bot?.state === 'paused' && (
                  <p className="px-3 py-1 text-xs text-muted-foreground">Paused</p>
                )}
              </div>
            ))}
            {!matches.length && (
              <p className="p-3 text-xs text-muted-foreground">
                {search
                  ? 'No Bots match this search.'
                  : 'Your ongoing assistants will appear here.'}
              </p>
            )}
          </div>
        </ResizableSidebar>
      )}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {error && (
          <p role="alert" className="border-b p-3 text-sm text-destructive">
            {error}
          </p>
        )}
        {creating ? (
          <BotCreateForm
            navigating={busy}
            onCancel={() => {
              selection.current++
              setCreating(false)
            }}
            onCreated={async (id, profile, refreshError) => {
              const attempt = ++selection.current
              setBusy(true)
              try {
                const pairing = botPairing(profile)
                const paired = () =>
                  botCreateHosts(latest.current).some((item) => item.pairing === pairing)
                if (!paired())
                  throw Error('This computer’s pairing changed. Reopen its Bots to continue.')
                if (profile.id !== latest.current.activeRuntimeId)
                  await latest.current.switchRuntime(profile.id)
                if (attempt !== selection.current) return false
                if (!paired())
                  throw Error('The active computer changed. Select Open Bot to continue.')
                setError(refreshError ?? '')
                setCreating(false)
                setSelected(taskCollectionKey(profile.id, id))
                routeEntity.current = id
                host.navigate({ viewId: 'bots', entityId: id })
                return true
              } finally {
                if (attempt === selection.current) setBusy(false)
              }
            }}
          />
        ) : current && current.source.runtimeId === store.activeRuntimeId ? (
          <TasksView entityId={current.task.id} embedded />
        ) : entityId && !current ? (
          <div role="status" className="p-6 text-sm">
            {store.connected
              ? 'Waiting for this Bot’s thread from its computer.'
              : 'This computer is offline. Reconnect to load this Bot’s thread.'}
            <Button
              className="mt-3 block"
              variant="outline"
              onClick={() => {
                setSelected('')
                host.navigate({ viewId: 'bots' })
              }}
            >
              Back to Bots
            </Button>
          </div>
        ) : (
          <div className="m-auto max-w-md p-6 text-center">
            <Bot className="mx-auto mb-3 size-8 text-muted-foreground" />
            <h2 className="text-lg font-semibold">
              {bots.length ? 'Select a Bot' : 'An assistant that keeps working with you'}
            </h2>
            <p className="mb-4 mt-2 text-sm text-muted-foreground">
              Each Bot has one lasting thread, a clear role, private memory and tool permissions.
              Give it work here or send it work from routines.
            </p>
            {canCreate ? (
              <Button disabled={busy} onClick={beginCreate}>
                {bots.length ? 'Create a Bot' : 'Create your first Bot'}
              </Button>
            ) : !supported ? (
              <p role="status" className="text-sm text-muted-foreground">
                Update this runtime to use Bots. Bots on other saved computers remain in the list.
              </p>
            ) : !store.connected ? (
              <p role="status" className="text-sm text-muted-foreground">
                This computer is offline. Connect to create a Bot.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  )
}
