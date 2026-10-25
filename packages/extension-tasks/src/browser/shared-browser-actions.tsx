import { browserQuote } from './shared-browser-tabs'
import { useEffect, useMemo, useState } from 'react'
import { Copy, MessageSquarePlus } from 'lucide-react'
import { watchRuntimeSettled, workspacePatchResultSchema } from '@dovo/protocol'
import { updateTask, useStudioHost, useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  Input,
} from '@dovo/studio-ui'
import { collectTasks, taskSources, type TaskEntry } from '../list/task-collection'

type Selection = { text: string; url: string; title: string }
export function SharedBrowserActions({
  enabled,
  capture,
  tabKey,
  url,
  title,
}: {
  enabled: boolean
  url: string
  title: string
  tabKey: string
  capture: () => Promise<Selection>
}) {
  const store = useWorkspace()
  const host = useStudioHost()
  const [selection, setSelection] = useState<Selection | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => {
    setError('')
    setNotice('')
  }, [tabKey])
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
  const insert = async (entry: TaskEntry) => {
    if (!selection || busy) return
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
        await store.flush()
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
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={!enabled || busy}
          onClick={() => void act('copy')}
        >
          <Copy size={14} /> Copy selection
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!enabled || busy}
          onClick={() => void act('selection')}
        >
          <MessageSquarePlus size={14} /> Add selection to thread…
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!enabled || busy}
          onClick={() => void act('page')}
        >
          Add page to thread…
        </Button>
        {notice && (
          <p role="status" className="text-xs text-muted-foreground">
            {notice}
          </p>
        )}
        {error && !selection && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
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
