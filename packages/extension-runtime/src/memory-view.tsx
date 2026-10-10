import { useCallback, useEffect, useRef } from 'react'
import { useApplicationState } from '@dovo/studio-core/state'
import { responses, useSettingsDraft, useWorkspace } from '@dovo/studio-core'
import {
  memoryEntrySchema,
  memoryPageSize,
  memoryListSchema,
  memoryProjectsSchema,
  memorySettingsSchema,
  mutableStruct,
  type MemoryEntry,
  type MemoryScopeRequest,
  type MemorySettings,
} from '@dovo/protocol'
import {
  Button,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  FormField,
  Input,
  SettingRow,
  SettingsGroup,
  Textarea,
  Toggle,
} from '@dovo/studio-ui'
import { HostPage } from './host-page'

export default function MemoryView({ entityId }: { entityId?: string }) {
  return (
    <HostPage
      initialRuntimeId={entityId}
      title="Memory"
      description="Optional saved notes for agents on this computer. Every scope starts off."
    >
      <MemorySettings />
    </HostPage>
  )
}

function MemorySettings() {
  const { request, connected } = useWorkspace()
  const [settings, setSettings] = useApplicationState<MemorySettings | null>(null)
  const [projects, setProjects] = useApplicationState<typeof memoryProjectsSchema.Type.projects>([])
  const [selection, setSelection] = useApplicationState('system')
  const [result, setResult] = useApplicationState<typeof memoryListSchema.Type | null>(null)
  const [query, setQuery] = useApplicationState('')
  const [offset, setOffset] = useApplicationState(0)
  const [editing, setEditing] = useApplicationState<MemoryEntry | null>(null)
  const [key, setKey] = useApplicationState('')
  const [content, setContent] = useApplicationState('')
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [deleting, setDeleting] = useApplicationState<MemoryEntry | null>(null)
  const [listError, setListError] = useApplicationState('')
  const loadGeneration = useRef(0)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const dirty = editing ? content !== editing.content : !!key || !!content
  useSettingsDraft(dirty, busy)
  const discardEditor = () => !dirty || window.confirm('Discard unsaved memory changes?')
  const targets: Array<MemoryScopeRequest & { value: string; label: string; registered: boolean }> =
    [
      { value: 'system', scope: 'system', label: 'System-wide', registered: true },
      { value: 'projectless', scope: 'projectless', label: 'No project', registered: true },
      ...projects.map((project) => ({
        value: `project:${project.id}`,
        scope: 'project' as const,
        repositoryId: project.id,
        label: project.name,
        registered: project.registered,
      })),
    ]
  const target = targets.find((item) => item.value === selection) ?? targets[0]
  const { scope, repositoryId } = target
  const enabled =
    !!settings &&
    (scope === 'system'
      ? settings.systemEnabled
      : scope === 'projectless'
        ? settings.projectlessEnabled
        : !!repositoryId && settings.projectRepositoryIds.includes(repositoryId))
  const disabled = !connected || busy || !settings
  const clearEditor = () => {
    setEditing(null)
    setKey('')
    setContent('')
  }
  useEffect(() => {
    let active = true
    setSettings(null)
    setProjects([])
    setError('')
    if (connected)
      void Promise.all([
        request('/api/memory/settings/read', {}, memorySettingsSchema),
        request('/api/memory/projects/read', {}, memoryProjectsSchema),
      ])
        .then(([value, library]) => {
          if (active) {
            setSettings(value)
            setProjects(library.projects)
          }
        })
        .catch((cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : String(cause))
        })
    return () => {
      active = false
    }
  }, [request, connected])
  const ready = connected && !!settings
  const applyResult = useCallback(
    (value: typeof memoryListSchema.Type) => {
      const lastOffset = Math.max(0, Math.ceil(value.total / memoryPageSize) - 1) * memoryPageSize
      if (offset > lastOffset) setOffset(lastOffset)
      else setResult(value)
    },
    [offset, setOffset, setResult],
  )
  const load = useCallback(
    () => request('/api/memory/list', { scope, repositoryId, query, offset }, memoryListSchema),
    [request, scope, repositoryId, query, offset],
  )
  useEffect(() => {
    let active = true
    const generation = ++loadGeneration.current
    if (!ready) setResult(null)
    setListError('')
    if (ready)
      void load()
        .then((value) => {
          if (active && generation === loadGeneration.current) {
            setListError('')
            applyResult(value)
          }
        })
        .catch((cause: unknown) => {
          if (active && generation === loadGeneration.current)
            setListError(cause instanceof Error ? cause.message : String(cause))
        })
    return () => {
      active = false
    }
  }, [ready, load, applyResult, setResult, setListError])
  const run = async (action: () => Promise<void>) => {
    ++loadGeneration.current
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-5">
      <SettingsGroup
        title="Agent memory"
        description="Each scope is enabled independently. Notes stay on this computer and survive thread deletion."
      >
        <SettingRow
          label="Memory scope"
          description="System-wide notes reach all threads. Project notes stay within that project; No project notes reach only threads without a project."
        >
          <ChoicePicker
            aria-label="Memory scope"
            value={target.value}
            disabled={disabled}
            onValueChange={(value) => {
              if (value === selection || !discardEditor()) return
              setResult(null)
              setSelection(value)
              setOffset(0)
              setQuery('')
              setError('')
              clearEditor()
              setDeleting(null)
            }}
          >
            {targets.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </ChoicePicker>
        </SettingRow>
        <SettingRow
          label="Enable memory for this scope"
          description={
            target.registered
              ? 'Changes apply on the next agent turn. Turning memory off keeps saved notes and stops agent access. Agents save notes explicitly; conversations are never mined automatically.'
              : 'This project was removed. Its saved notes remain available; register the project again to enable memory.'
          }
        >
          <Toggle
            label="Enable memory for this scope"
            checked={enabled}
            disabled={disabled || (!target.registered && !enabled)}
            onChange={(value) =>
              void run(async () => {
                setSettings(
                  await request(
                    '/api/memory/settings/save',
                    { scope, repositoryId, enabled: value },
                    memorySettingsSchema,
                  ),
                )
                applyResult(await load())
              })
            }
          />
        </SettingRow>
      </SettingsGroup>
      {(error || listError) && !deleting && (
        <p role="alert" className="text-sm text-destructive">
          {error || listError}
        </p>
      )}
      {!settings && !error && (
        <p role="status" className="text-xs text-muted-foreground">
          {connected ? 'Loading memory settings…' : 'Reconnect this computer to manage memory.'}
        </p>
      )}
      <section className="space-y-3" aria-label="Saved memory notes">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Saved notes {result ? `(${result.total})` : ''}</h2>
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                applyResult(await load())
              })
            }
          >
            Refresh
          </Button>
        </div>
        <Input
          aria-label="Search memory"
          placeholder="Search notes"
          value={query}
          disabled={disabled}
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            setOffset(0)
          }}
          maxLength={200}
        />
        {ready && !result && !listError && (
          <p role="status" className="text-xs text-muted-foreground">
            Loading saved notes…
          </p>
        )}
        {result?.entries.length === 0 && (
          <p role="status" className="rounded-lg border p-4 text-sm text-muted-foreground">
            {query.trim() ? 'No saved notes match your search.' : 'No saved notes in this scope.'}
          </p>
        )}
        {!!result?.entries.length && (
          <ul className="divide-y rounded-lg border">
            {result.entries.map((entry) => (
              <li key={entry.key} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm font-medium">{entry.key}</p>
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                    {entry.content}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Edit ${entry.key}`}
                  disabled={disabled}
                  onClick={() => {
                    if (!discardEditor()) return
                    setEditing(entry)
                    setKey(entry.key)
                    setContent(entry.content)
                    setError('')
                    noteRef.current?.focus()
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={disabled}
                  aria-label={`Delete ${entry.key}`}
                  onClick={() => setDeleting(entry)}
                >
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!!result && (result.total > memoryPageSize || offset > 0) && (
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - memoryPageSize))}
            >
              Previous
            </Button>
            <span className="text-xs text-muted-foreground">
              {offset + 1}–{Math.min(offset + memoryPageSize, result.total)} of {result.total}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={disabled || offset + memoryPageSize >= result.total}
              onClick={() => setOffset(offset + memoryPageSize)}
            >
              Next
            </Button>
          </div>
        )}
      </section>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleting(null)
        }}
      >
        <DialogContent>
          <DialogTitle>Delete memory note?</DialogTitle>
          <DialogDescription>
            “{deleting?.key}” will be permanently deleted from this scope.
          </DialogDescription>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={disabled || !deleting}
              onClick={() => {
                const entry = deleting
                if (!entry) return
                void run(async () => {
                  await request(
                    '/api/memory/delete',
                    { scope, repositoryId, key: entry.key, expectedRevision: entry.revision },
                    responses.ok,
                  )
                  if (editing?.key === entry.key) clearEditor()
                  setDeleting(null)
                  applyResult(await load())
                })
              }}
            >
              Delete note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <form
        className="grid gap-3 rounded-lg border p-4"
        onSubmit={(event) => {
          event.preventDefault()
          void run(async () => {
            await request(
              '/api/memory/write',
              {
                scope,
                repositoryId,
                key: key.trim(),
                content,
                expectedRevision: editing?.revision,
              },
              mutableStruct({ memory: memoryEntrySchema }),
            )
            clearEditor()
            applyResult(await load())
          })
        }}
      >
        <div>
          <h2 className="text-sm font-semibold">{editing ? 'Edit note' : 'New note'}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Saved in {target.label}
            {!enabled ? ' · Agent access is off' : ''}.
          </p>
        </div>
        <FormField label="Note key">
          <Input
            aria-label="Key"
            value={key}
            disabled={disabled || !!editing || !target.registered}
            onChange={(event) => setKey(event.currentTarget.value)}
            maxLength={120}
            placeholder="e.g. testing-conventions"
          />
        </FormField>
        <FormField label="Note">
          <Textarea
            aria-label="Note"
            ref={noteRef}
            value={content}
            disabled={disabled || (!target.registered && !editing)}
            onChange={(event) => setContent(event.currentTarget.value)}
            maxLength={16000}
            rows={5}
          />
        </FormField>
        <p className="text-xs text-muted-foreground">
          Save durable preferences, decisions and useful facts. Avoid credentials, secrets and
          temporary progress. Notes remain after threads are deleted.
        </p>
        <div className="flex justify-end gap-2">
          {editing && (
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => {
                if (discardEditor()) clearEditor()
              }}
            >
              Cancel edit
            </Button>
          )}
          <Button
            type="submit"
            disabled={
              disabled || !key.trim() || !content.trim() || (!target.registered && !editing)
            }
          >
            {busy ? 'Saving…' : 'Save note'}
          </Button>
        </div>
      </form>
    </div>
  )
}
