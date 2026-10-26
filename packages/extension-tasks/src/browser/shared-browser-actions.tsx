import { browserQuote } from './shared-browser-tabs'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Copy, MessageSquarePlus } from 'lucide-react'
import {
  browserContextActionSchema,
  decodeResult,
  watchRuntimeSettled,
  workspacePatchResultSchema,
} from '@dovo/protocol'
import {
  updateTask,
  createTask,
  resolveTaskDefaults,
  useStudioHost,
  useWorkspace,
} from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@dovo/studio-ui'
import { collectTasks, taskSources, type TaskEntry } from '../list/task-collection'

type Selection = { text: string; url: string; title: string }
export function SharedBrowserActions({
  enabled,
  capture,
  tabKey,
  url,
  title,
  children,
}: {
  enabled: boolean
  url: string
  title: string
  tabKey: string
  capture: () => Promise<Selection>
  children: (actions: ReactNode) => ReactNode
}) {
  const store = useWorkspace()
  const host = useStudioHost()
  const [selection, setSelection] = useState<Selection | null>(null)
  const [query, setQuery] = useState('')
  const [projectId, setProjectId] = useState('')
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    setError('')
    setNotice('')
  }, [tabKey])
  useEffect(
    () =>
      host.onBrowserContextAction?.((input) => {
        const parsed = decodeResult(browserContextActionSchema, input)
        if (!parsed.success) return
        const action = parsed.data
        if (action.key !== tabKey || busy) return
        setError('')
        setNotice('')
        setQuery('')
        setSelection({
          text: action.action === 'selection' ? action.text : '',
          url: action.url,
          title: action.title,
        })
      }),
    [host.onBrowserContextAction, tabKey, busy],
  )
  const open = !!selection
  const entries = useMemo(
    () => (open ? collectTasks(taskSources(store)) : []),
    [
      open,
      store.workspace,
      store.snapshot,
      store.runtimes,
      store.activeRuntimeId,
      store.connected,
      store.connection,
    ],
  )
  const connections = [
    ...new Map(
      [
        ...store.runtimeRegistry.profiles.map((profile) => profile.connection),
        ...(store.connection ? [store.connection] : []),
      ].map((connection) => [JSON.stringify(connection), connection]),
    ).values(),
  ]
  const identity = JSON.stringify(connections)
  useEffect(() => {
    if (!open) return
    const stops = connections.map((connection) => watchRuntimeSettled(connection))
    return () => stops.forEach((stop) => stop())
  }, [open, identity])
  const act = async (action: 'copy' | 'selection' | 'page') => {
    if (busy) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const value = action === 'page' ? { text: '', url, title } : await capture()
      if (action !== 'page' && !value.text.trim()) throw new Error('Select text on the page first.')
      if (action === 'copy') {
        await navigator.clipboard.writeText(value.text)
        setNotice('Selection copied.')
      } else {
        setQuery('')
        setSelection(value)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  const syncDraft = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        store.flush(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  'The draft is kept in this window, but syncing is taking too long. Reconnect Studio before opening it in another window.',
                ),
              ),
            10000,
          )
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
  const insert = async (entry: TaskEntry) => {
    if (!selection || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (!entry.source.online) throw new Error('This thread’s computer is offline.')
      const quote = browserQuote(selection)
      if (entry.source.runtimeId === store.activeRuntimeId) {
        store.setWorkspace((workspace) => {
          if (!workspace.tasks.some((task) => task.id === entry.task.id))
            throw new Error('This thread no longer exists.')
          return updateTask(workspace, entry.task.id, (task) => ({
            ...task,
            draft: [task.draft, quote].filter(Boolean).join('\n\n'),
          }))
        })
        setSelection(null)
        if (host.browserWindowId) await syncDraft()
        else
          void store
            .flush()
            .catch((cause: unknown) =>
              setError(`The draft is kept locally, but has not synced: ${String(cause)}`),
            )
      } else {
        const profile = store.runtimeRegistry.profiles.find(
          (profile) => profile.id === entry.source.runtimeId,
        )
        if (!profile) throw new Error('This thread’s computer is no longer paired.')
        const result = await store.readRuntime(
          profile,
          '/api/workspace',
          {
            collection: 'tasks',
            id: entry.task.id,
            changes: {
              draft: {
                before: entry.task.draft,
                after: [entry.task.draft, quote].filter(Boolean).join('\n\n'),
              },
            },
          },
          workspacePatchResultSchema,
          'PATCH',
        )
        if (result.outcome === 'rejected')
          throw new Error(result.reason || 'This edit no longer applies to that thread.')
        if (result.outcome === 'reconciled' && result.recoveryId)
          throw new Error(
            result.reason ||
              'The draft changed on that computer. Your selection was saved in Recovered edits.',
          )
        setSelection(null)
        try {
          await store.refreshRuntime(profile)
        } catch {
          setError(
            'Selection was saved, but the thread list could not refresh. Reconnect before opening it.',
          )
          return
        }
      }
      setSelection(null)
      setNotice(`Added to ${entry.task.title || 'Untitled thread'} as a draft.`)
      host.openThread?.({
        runtimeId: entry.source.runtimeId,
        threadId: entry.task.id,
        title: entry.task.title,
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const createDraft = async () => {
    if (!selection || pending.current || !store.connected) return
    const repository = store.workspace.repositories.find((repo) => repo.id === projectId)
    if (!repository) {
      setError('Choose a project for the draft.')
      return
    }
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const task = {
        ...createTask({
          title: selection.title.slice(0, 100) || 'Browser selection',
          objective: '',
          agentId: '',
          ...resolveTaskDefaults(store.snapshot?.defaults, repository),
          repositoryId: repository.id,
        }),
        draft: browserQuote(selection),
      }
      store.setWorkspace((workspace) => ({ ...workspace, tasks: [task, ...workspace.tasks] }))
      setSelection(null)
      if (host.browserWindowId) await syncDraft()
      else
        void store
          .flush()
          .catch((cause: unknown) =>
            setError(`The draft is kept locally, but has not synced: ${String(cause)}`),
          )
      setNotice('Created a draft thread. Review before sending.')
      host.openThread?.({ runtimeId: store.activeRuntimeId, threadId: task.id, title: task.title })
    } catch (cause) {
      setError(String(cause))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const matches = entries.filter(
    (entry) =>
      !entry.task.archived &&
      !entry.task.example &&
      `${entry.task.title} ${entry.projectName} ${entry.source.name}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  )
  return (
    <>
      {children(
        <div className="flex flex-col gap-1 border-t pt-2" aria-label="Page actions">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="justify-start text-xs"
            disabled={!enabled || busy}
            onClick={() => void act('copy')}
          >
            <Copy size={14} /> Copy selection
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="justify-start text-xs"
            disabled={!enabled || busy}
            onClick={() => void act('selection')}
          >
            <MessageSquarePlus size={14} /> Add selection to thread…
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="justify-start text-xs"
            disabled={!enabled || busy}
            onClick={() => void act('page')}
          >
            Add page to thread…
          </Button>
        </div>,
      )}
      {notice && (
        <p role="status" className="border-b px-3 py-2 text-xs text-muted-foreground">
          {notice}
        </p>
      )}
      {error && !selection && (
        <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={!!selection}
        onOpenChange={(open) => {
          if (!open && !busy) setSelection(null)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogTitle>Add selection to a thread</DialogTitle>
          <DialogDescription>
            Append the selected text and source link to a draft. Review it before sending.
          </DialogDescription>
          {selection?.text && (
            <p className="break-all text-xs text-muted-foreground">
              {selection.title}
              <br />
              {selection.url}
            </p>
          )}
          {selection?.text ? (
            <blockquote className="max-h-28 overflow-y-auto whitespace-pre-wrap border-l-2 pl-3 text-xs text-muted-foreground">
              {selection.text}
            </blockquote>
          ) : (
            <p className="break-all text-xs text-muted-foreground">
              {selection?.title}
              <br />
              {selection?.url}
            </p>
          )}
          <div className="flex flex-wrap gap-2 border-b pb-3">
            <Select
              value={projectId}
              onValueChange={setProjectId}
              disabled={busy || !store.connected}
            >
              <SelectTrigger aria-label="Project for new draft thread" className="min-w-0 flex-1">
                <SelectValue placeholder="Choose project on this computer…" />
              </SelectTrigger>
              <SelectContent>
                {store.workspace.repositories.map((repo) => (
                  <SelectItem key={repo.id} value={repo.id}>
                    {repo.kind === 'scratch' ? 'General' : repo.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              disabled={busy || !store.connected || !projectId}
              onClick={() => void createDraft()}
            >
              Create draft thread
            </Button>
          </div>
          {busy && (
            <p role="status" className="text-xs text-muted-foreground">
              Saving draft…
            </p>
          )}
          <Input
            aria-label="Find a thread for selection"
            placeholder="Search threads, projects or computers…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="max-h-72 space-y-1 overflow-y-auto" aria-label="Destination threads">
            {matches.map((entry) => (
              <button
                key={entry.key}
                type="button"
                disabled={busy || !entry.source.online}
                className="block w-full rounded-md px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent disabled:opacity-50"
                onClick={() => void insert(entry)}
              >
                <span className="block truncate text-sm">
                  {entry.task.title || 'Untitled thread'}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {entry.projectName} · {entry.source.name}
                  {!entry.source.online ? ' · Offline' : ''}
                </span>
              </button>
            ))}
            {!matches.length && (
              <p className="p-3 text-sm text-muted-foreground">No matching threads.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
