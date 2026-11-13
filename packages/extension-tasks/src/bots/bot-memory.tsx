import { BotMemoryLearning } from './bot-memory-learning'
import { botScope } from './bot-scope'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  memoryEntrySchema,
  memoryListSchema,
  mutableStruct,
  type MemoryEntry,
} from '@dovo/protocol'
import { responses, useConfirmation, useWorkspace } from '@dovo/studio-core'
import { Button, FormField, Input, Textarea } from '@dovo/studio-ui'

type NoteDraft = { key: string; content: string; revision?: string }
const drafts = new Map<string, NoteDraft>()
const blank: NoteDraft = { key: '', content: '' }

export function BotMemory({ taskId }: { taskId: string }) {
  const { request, connected, snapshot, activeRuntimeId, connection } = useWorkspace()
  const scope = JSON.stringify([
    botScope(snapshot?.runtimeId ?? activeRuntimeId, connection),
    taskId,
  ])
  const [draft, setDraft] = useState(() => drafts.get(scope) ?? blank)
  const [notes, setNotes] = useState<MemoryEntry[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const lock = useRef(false)
  const generation = useRef(0)
  const confirm = useConfirmation()
  const supported = snapshot?.botsSupported === true
  const disabled = !connected || !supported || busy
  const load = useCallback(
    async (offset = 0) => {
      const current = ++generation.current
      setLoading(true)
      try {
        const result = await request(
          '/api/memory/list',
          { scope: 'bot', botId: taskId, offset },
          memoryListSchema,
        )
        if (current !== generation.current) return
        setNotes((previous) => (offset ? [...previous, ...result.entries] : result.entries))
        setTotal(result.total)
        setError('')
      } catch (cause) {
        if (current === generation.current)
          setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (current === generation.current) setLoading(false)
      }
    },
    [request, taskId],
  )
  useEffect(() => {
    if (connected && supported) void load()
    return () => {
      generation.current++
    }
  }, [load, connected, supported])
  const change = (value: NoteDraft) => {
    drafts.set(scope, value)
    setDraft(value)
  }
  const clear = () => {
    drafts.delete(scope)
    setDraft(blank)
  }
  const choose = async (note?: MemoryEntry) => {
    if (
      drafts.has(scope) &&
      !(await confirm({
        title: 'Replace memory draft?',
        description: 'Your unsaved memory note will be replaced.',
        confirmLabel: 'Replace draft',
        destructive: true,
      }))
    )
      return
    if (note) {
      drafts.delete(scope)
      setDraft({ key: note.key, content: note.content, revision: note.revision })
    } else clear()
  }
  const run = async (operation: () => Promise<void>) => {
    if (disabled || lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <section className="grid gap-3" aria-label="Memory">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Memory</h2>
        <span className="text-xs text-muted-foreground">
          {total} {total === 1 ? 'note' : 'notes'}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Dovo memory tools keep these notes separate from other threads and delegated agents. An
        agent with full file access on this computer can read saved files. Do not save secrets.
      </p>
      <details className="rounded-xl border p-3">
        <summary className="cursor-pointer text-sm font-medium">Background learning</summary>
        <div className="mt-3">
          <BotMemoryLearning key={scope} taskId={taskId} onChanged={() => void load()} />
        </div>
      </details>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || loading}
          onClick={() => void load()}
        >
          Refresh memory
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void choose()}>
          New note
        </Button>
      </div>
      {loading && (
        <p role="status" className="text-xs">
          Loading memory…
        </p>
      )}
      {!loading && !notes.length && (
        <p className="text-xs text-muted-foreground">No saved notes yet.</p>
      )}
      <Input
        aria-label="Search loaded notes"
        placeholder="Search loaded notes…"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() && notes.length < total ? (
        <p className="text-xs text-muted-foreground">
          Search covers {notes.length} loaded notes. Load more to search the rest.
        </p>
      ) : null}
      {!!query.trim() &&
        !notes.some((note) =>
          `${note.key} ${note.content}`
            .toLocaleLowerCase()
            .includes(query.trim().toLocaleLowerCase()),
        ) && <p className="text-xs text-muted-foreground">No matching loaded notes.</p>}
      <div aria-label="Saved memory notes" className="max-h-72 space-y-2 overflow-y-auto">
        {notes
          .filter((note) =>
            `${note.key} ${note.content}`
              .toLocaleLowerCase()
              .includes(query.trim().toLocaleLowerCase()),
          )
          .map((note) => (
            <div
              key={note.key}
              className={`grid gap-2 rounded-xl border p-3 ${draft.revision && draft.key === note.key ? 'border-primary bg-primary/5' : 'bg-card'}`}
            >
              <div className="flex min-w-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-w-0 flex-1 justify-start truncate"
                  disabled={busy}
                  onClick={() => void choose(note)}
                >
                  {note.key}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={`Delete memory ${note.key}`}
                  onClick={() =>
                    void run(async () => {
                      if (
                        !(await confirm({
                          title: 'Delete memory note?',
                          description: `Delete “${note.key}” from this Bot’s memory.`,
                          confirmLabel: 'Delete note',
                          destructive: true,
                        }))
                      )
                        return
                      await request(
                        '/api/memory/delete',
                        {
                          scope: 'bot',
                          botId: taskId,
                          key: note.key,
                          expectedRevision: note.revision,
                        },
                        responses.ok,
                      )
                      if (draft.key === note.key) clear()
                      await load()
                    })
                  }
                >
                  Delete
                </Button>
              </div>
              <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm text-muted-foreground">
                {note.content}
              </p>
              <p className="text-xs text-muted-foreground">
                Updated {new Date(note.updatedAt).toLocaleDateString()}
              </p>
              {note.evidence && (
                <details className="text-xs text-muted-foreground">
                  <summary>Learned from your messages</summary>
                  {note.evidence.sources.map((source) => (
                    <blockquote key={source.messageId} className="my-2 border-l pl-2">
                      <p>{source.quote}</p>
                      <Button
                        size="sm"
                        variant="link"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent('dovo:bot-memory-source', {
                              detail: {
                                scope: botScope(snapshot?.runtimeId ?? activeRuntimeId, connection),
                                taskId,
                                messageId: source.messageId,
                              },
                            }),
                          )
                        }
                      >
                        View source message
                      </Button>
                    </blockquote>
                  ))}
                </details>
              )}
            </div>
          ))}
        {notes.length < total && (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled || loading}
            onClick={() => void load(notes.length)}
          >
            More notes
          </Button>
        )}
      </div>
      <form
        className="grid gap-3 rounded-xl border bg-card p-3"
        onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            await request(
              '/api/memory/write',
              {
                scope: 'bot',
                botId: taskId,
                key: draft.key.trim(),
                content: draft.content,
                expectedRevision: draft.revision,
              },
              mutableStruct({ memory: memoryEntrySchema }),
            )
            if (!drafts.has(scope) || drafts.get(scope) === draft) clear()
            await load()
          })
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{draft.revision ? 'Edit note' : 'New note'}</h3>
          <span className="text-xs text-muted-foreground">
            {drafts.has(scope) ? 'Draft kept on this device' : 'Ready to write'}
          </span>
        </div>
        <fieldset disabled={disabled} className="grid min-w-0 gap-3">
          <FormField label="Note name">
            <Input
              aria-label="Memory key"
              required
              maxLength={120}
              disabled={!!draft.revision}
              value={draft.key}
              onChange={(event) => change({ ...draft, key: event.target.value })}
            />
          </FormField>
          <FormField label="Note">
            <Textarea
              aria-label="Memory note"
              className="min-h-64 resize-y text-sm leading-6"
              required
              maxLength={16000}
              value={draft.content}
              onChange={(event) => change({ ...draft, content: event.target.value })}
            />
          </FormField>
          <p className="text-xs text-muted-foreground">
            {draft.content.length.toLocaleString()} / 16,000 characters
          </p>
          <Button size="sm" type="submit" disabled={!draft.key.trim() || !draft.content.trim()}>
            Save memory note
          </Button>
          <Button size="sm" type="button" variant="ghost" onClick={() => void choose()}>
            Cancel editing
          </Button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
