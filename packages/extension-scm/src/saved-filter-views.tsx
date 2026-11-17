import { useEffect, useState } from 'react'
import {
  randomUUID,
  saveFilterView,
  availableSavedFilterView,
  savedFilterSourceScope,
  type SavedFilterSource,
  type SavedFilterView,
  type SavedFilterValues,
} from '@dovo/protocol'
import { readAppPreferences, updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { Button, Input } from '@dovo/studio-ui'

export function SavedFilterViews({
  kind,
  scope,
  sources,
  value,
  onApply,
  requestedId,
}: {
  kind: SavedFilterView['kind']
  scope: string
  sources: readonly SavedFilterSource[]
  value: SavedFilterValues
  onApply: (filters: SavedFilterValues) => void
  requestedId?: string
}) {
  const { savedFilterViews } = useAppPreferences()
  const views = savedFilterViews.filter(
    (view) => view.kind === kind && availableSavedFilterView(view, scope, sources),
  )
  const [selectedId, setSelected] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const selected = views.find((view) => view.id === selectedId)
  const choose = (id: string) => {
    const view = views.find((view) => view.id === id)
    setSelected(id)
    setName(view?.name ?? '')
    setError('')
    if (view) onApply(view.filters)
  }
  const requestedVersion = JSON.stringify(
    views.find((view) => `saved-view:${view.id}` === requestedId),
  )
  useEffect(() => {
    if (!requestedId?.startsWith('saved-view:')) return
    const id = requestedId.slice('saved-view:'.length)
    if (views.some((view) => view.id === id)) choose(id)
    else setError('This saved view belongs to a different source or account.')
  }, [requestedId, scope, requestedVersion])
  const save = (view: SavedFilterView) => {
    try {
      if (view.filters.source && !savedFilterSourceScope(view.filters.source, sources))
        throw new Error('Choose an available source before saving a view.')
      const next = saveFilterView(readAppPreferences().savedFilterViews, {
        ...view,
        sourceScope: savedFilterSourceScope(view.filters.source, sources),
      })
      if (!updateAppPreferences({ savedFilterViews: next }))
        throw new Error('Could not save this view. Retry in Settings.')
      setSelected(view.id)
      setName(view.name.trim())
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <details className="rounded-md border p-2 text-xs">
      <summary className="cursor-pointer">
        Saved views{selected ? ` · ${selected.name}` : ''}
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <select
          aria-label="Saved view"
          className="max-w-56 rounded border bg-background p-2"
          value={selected?.id ?? ''}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="">Choose a saved view</option>
          {views.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
        <Input
          aria-label="View name"
          className="h-8 w-48"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="View name"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!name.trim()}
          onClick={() => save({ id: randomUUID(), name, kind, scope, filters: value })}
        >
          Save new view
        </Button>
        {selected && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => save({ ...selected, filters: value })}
            >
              Update filters
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!name.trim()}
              onClick={() => save({ ...selected, name })}
            >
              Rename
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (
                  !updateAppPreferences({
                    savedFilterViews: readAppPreferences().savedFilterViews.filter(
                      (view) => view.id !== selected.id,
                    ),
                  })
                )
                  setError('Could not remove this view. Retry in Settings.')
                else {
                  setSelected('')
                  setName('')
                  setError('')
                }
              }}
            >
              Delete view
            </Button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {error}
        </p>
      )}
    </details>
  )
}
