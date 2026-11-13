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
    if (note) change({ key: note.key, content: note.content, revision: note.revision })
    else clear()
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
      <h2 className="font-semibold">Memory</h2>
      <p className="text-xs text-muted-foreground">
        Dovo memory tools keep these notes separate from other threads and delegated agents. An
        agent with full file access on this computer can read saved files. Do not save secrets.
      </p>
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
      {notes.map((note) => (
        <div key={note.key} className="flex min-w-0 items-center gap-2">
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
                  { scope: 'bot', botId: taskId, key: note.key, expectedRevision: note.revision },
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
      <form
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
            if (drafts.get(scope) === draft) clear()
            await load()
          })
        }}
      >
        <fieldset disabled={disabled} className="grid min-w-0 gap-2">
          <FormField label="Note key">
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
              required
              maxLength={16000}
              value={draft.content}
              onChange={(event) => change({ ...draft, content: event.target.value })}
            />
          </FormField>
          <Button size="sm" type="submit" disabled={!draft.key.trim() || !draft.content.trim()}>
            Save memory note
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
