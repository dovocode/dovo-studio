import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import {
  watchRuntimeSettled,
  watchRuntimeTask,
  type BrowserWebsiteCustomization,
} from '@dovo/protocol'
import {
  createTask,
  resolveTaskDefaults,
  useCachedTask,
  useStudioHost,
  useWorkspace,
  WorkspaceScope,
} from '@dovo/studio-core'
import { Button, IconButton, Input } from '@dovo/studio-ui'
import { ArrowUpRight, X } from 'lucide-react'
import { collectTasks, taskSources } from '../list/task-collection'
import type { BrowserTab } from './shared-browser-tabs'
import { websiteCustomizationProposal } from '@dovo/protocol'
const Conversation = lazy(() =>
  import('../detail/task-conversation').then((module) => ({ default: module.TaskConversation })),
)

type Insert = { id: string; text: string }
export function BrowserThreadPanel({
  thread,
  onThread,
  onClose,
  onBrowser,
  insert,
  onInserted,
  websiteOrigin,
  onProposal,
}: {
  thread?: BrowserTab['thread']
  onThread: (thread: NonNullable<BrowserTab['thread']>) => void
  onClose: () => void
  onBrowser: (url: string) => void
  insert?: Insert | null
  onInserted: () => void
  websiteOrigin?: string
  onProposal: (website: BrowserWebsiteCustomization) => void
}) {
  const store = useWorkspace()
  const [choosing, setChoosing] = useState(!thread)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [projectId, setProjectId] = useState('')
  const [busy, setBusy] = useState(false)
  const entries = useMemo(
    () => collectTasks(taskSources(store)),
    [
      store.workspace,
      store.snapshot,
      store.runtimes,
      store.activeRuntimeId,
      store.connected,
      store.connection,
    ],
  )
  const owner =
    thread && store.runtimeRegistry.profiles.find((profile) => profile.id === thread.runtimeId)
  const available = !thread || thread.runtimeId === store.activeRuntimeId || owner
  useEffect(() => {
    if (!choosing) return
    const stops = store.runtimeRegistry.profiles.map((profile) =>
      watchRuntimeSettled(profile.connection),
    )
    return () => stops.forEach((stop) => stop())
  }, [choosing, store.runtimeRegistry.profiles])
  const create = async () => {
    const repository = store.workspace.repositories.find((repo) => repo.id === projectId)
    if (!repository || busy) return
    setBusy(true)
    setError('')
    try {
      const task = createTask({
        title: 'Website thread',
        objective: '',
        agentId: '',
        ...resolveTaskDefaults(store.snapshot?.defaults, repository),
        repositoryId: repository.id,
      })
      store.setWorkspace((workspace) => ({ ...workspace, tasks: [task, ...workspace.tasks] }))
      // The browser stays mounted; a failed sync leaves the new draft available locally.
      onThread({ id: task.id, runtimeId: store.activeRuntimeId })
      setChoosing(false)
      await store.flush()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const content = thread && available && (
    <ThreadConversation
      key={JSON.stringify(thread)}
      id={thread.id}
      onBrowser={onBrowser}
      insert={insert}
      onInserted={onInserted}
      websiteOrigin={websiteOrigin}
      onProposal={onProposal}
    />
  )
  return (
    <aside
      aria-label="Browser tab thread"
      className="flex h-full min-h-0 flex-col border-l bg-background"
    >
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">Thread for this tab</span>
        {thread && (
          <Button size="sm" variant="ghost" onClick={() => setChoosing(!choosing)}>
            {choosing ? 'Back' : 'Change thread'}
          </Button>
        )}
        <IconButton label="Close tab thread panel" onClick={onClose}>
          <X size={15} />
        </IconButton>
      </header>
      {error && (
        <p role="alert" className="p-2 text-xs text-destructive">
          {error}
        </p>
      )}
      {choosing ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
          {insert && (
            <p className="text-xs text-muted-foreground">
              Choose or create a thread to review the website customization request before sending.
            </p>
          )}
          <label className="block text-xs">
            Project for new thread
            <select
              aria-label="Project for tab thread"
              className="mt-1 w-full rounded border bg-background p-2"
              value={projectId}
              disabled={busy}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">Choose project…</option>
              {store.workspace.repositories.map((repo) => (
                <option key={repo.id} value={repo.id}>
                  {repo.kind === 'scratch' ? 'General' : repo.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            size="sm"
            disabled={!projectId || !store.connected || busy}
            onClick={() => void create()}
          >
            Create thread for tab
          </Button>
          <Input
            aria-label="Find thread for tab"
            placeholder="Search threads…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {entries
            .filter(
              (entry) =>
                !entry.task.archived &&
                `${entry.task.title} ${entry.projectName} ${entry.source.name}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
            )
            .map((entry) => (
              <button
                key={entry.key}
                type="button"
                className="block w-full rounded p-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                disabled={!entry.source.online}
                onClick={() => {
                  onThread({ id: entry.task.id, runtimeId: entry.source.runtimeId })
                  setChoosing(false)
                }}
              >
                <span className="block truncate">{entry.task.title || 'Untitled thread'}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {entry.projectName} · {entry.source.name}
                </span>
              </button>
            ))}
        </div>
      ) : !available ? (
        <p role="status" className="p-3 text-sm">
          This thread’s computer is no longer paired. Choose another thread.
        </p>
      ) : owner && thread?.runtimeId !== store.activeRuntimeId ? (
        <WorkspaceScope profile={owner}>{content}</WorkspaceScope>
      ) : (
        content
      )}
    </aside>
  )
}

function ThreadConversation({
  id,
  onBrowser,
  insert,
  onInserted,
  websiteOrigin,
  onProposal,
}: {
  id: string
  onBrowser: (url: string) => void
  insert?: Insert | null
  onInserted: () => void
  websiteOrigin?: string
  onProposal: (website: BrowserWebsiteCustomization) => void
}) {
  const store = useWorkspace()
  const host = useStudioHost()
  const { task, loaded, error } = useCachedTask(
    store.workspace.tasks.find((task) => task.id === id),
  )
  useEffect(() => {
    if (store.connection) return watchRuntimeTask(store.connection, id)
  }, [store.connection, id])
  if (!task)
    return (
      <p role="status" className="p-3 text-sm">
        This thread is unavailable. Reconnect its computer or choose another thread.
      </p>
    )
  const proposal = websiteOrigin && websiteCustomizationProposal(task.messages, websiteOrigin)
  const open = () =>
    host.openThread?.({ threadId: task.id, runtimeId: store.activeRuntimeId, title: task.title })
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1">
        <span className="min-w-0 flex-1 truncate text-xs">{task.title || 'Untitled thread'}</span>
        {proposal && (
          <Button size="sm" variant="outline" onClick={() => onProposal(proposal)}>
            Review website changes
          </Button>
        )}
        <IconButton label="Open full thread" onClick={open}>
          <ArrowUpRight size={14} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1">
        <Suspense fallback={<p className="p-3 text-sm">Loading thread…</p>}>
          <Conversation
            task={task}
            historyLoaded={loaded}
            historyError={error}
            visible
            onReview={open}
            onArtifact={open}
            onTerminal={open}
            onBrowser={onBrowser}
            composerInsert={insert}
            onComposerInsertApplied={onInserted}
          />
        </Suspense>
      </div>
    </>
  )
}
