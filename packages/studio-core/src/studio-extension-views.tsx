import { Component, useMemo, useRef, useState, type ReactNode } from 'react'
import { clientScopeKey } from '@dovo/client-runtime'
import {
  extensionViewResultIds,
  extensionViewActionIds,
  isStudioDataSource,
  type ExtensionSettingValue,
  type ExtensionContribution,
  type ExtensionView,
  type ExtensionViewValue,
  type StudioExtensionEntry,
} from '@dovo/protocol'
import { callStudioExtension, readExtensionDataSource } from './studio-extensions'
import type { WorkspaceRequest } from './workspace/context'

export type SaveExtensionSettings = (settings: StudioExtensionEntry['settings']) => Promise<void>

export function extensionViewValue(
  value: ExtensionViewValue,
  settings: StudioExtensionEntry['settings'],
  results: ReadonlyMap<string, unknown>,
): unknown {
  if (typeof value !== 'object') return value
  if ('setting' in value)
    return Object.hasOwn(settings, value.setting) ? settings[value.setting] : undefined
  let data = results.get(value.result)
  for (const key of value.path ?? []) {
    if (!data || typeof data !== 'object') return undefined
    data = Object.getOwnPropertyDescriptor(data, key)?.value
  }
  return data
}

export function extensionViewText(value: unknown) {
  return typeof value === 'string'
    ? value.slice(0, 4096)
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : ''
}

export function useExtensionSettingsDraft(
  entry: StudioExtensionEntry,
  save: SaveExtensionSettings,
) {
  const [edits, setEdits] = useState(
    new Map<string, { base: ExtensionSettingValue; value: ExtensionSettingValue }>(),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  const compatible = [...edits].filter(([id, edit]) => {
    if (!Object.hasOwn(entry.settings, id)) return false
    const saved = entry.settings[id]
    return typeof saved === typeof edit.value && saved !== edit.value
  })
  if (compatible.length !== edits.size) setEdits(new Map(compatible))
  const patch = Object.fromEntries(compatible.map(([id, edit]) => [id, edit.value]))
  const conflicts = compatible.flatMap(([id, edit]) => {
    const saved = entry.settings[id]
    return saved === undefined || saved === edit.base
      ? []
      : [
          {
            id,
            saved,
            title: entry.installed?.settings?.find((field) => field.id === id)?.title ?? id,
          },
        ]
  })
  return {
    values: { ...entry.settings, ...patch },
    dirty: compatible.length > 0,
    edit: (id: string, value: ExtensionSettingValue) => {
      if (!Object.hasOwn(entry.settings, id)) return
      const saved = entry.settings[id]
      if (saved === undefined) return
      setEdits((previous) =>
        new Map(previous).set(id, { base: previous.get(id)?.base ?? saved, value }),
      )
    },
    conflicts,
    resolveConflicts: (resolution: 'saved' | 'local') => {
      if (running.current) return
      setEdits((previous) => {
        const next = new Map(previous)
        for (const { id, saved } of conflicts) {
          const edit = next.get(id)
          if (resolution === 'saved') next.delete(id)
          else if (edit) next.set(id, { ...edit, base: saved })
        }
        return next
      })
      setError('')
    },
    discard: () => {
      setEdits(new Map())
      setError('')
    },
    commit: async () => {
      if (running.current || compatible.length === 0 || conflicts.length) return
      running.current = true
      setSaving(true)
      setError('')
      try {
        await save(patch)
        setEdits(new Map())
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        running.current = false
        setSaving(false)
      }
    },
    saving,
    error,
  }
}

export function useExtensionView(
  view: ExtensionView,
  entry: StudioExtensionEntry,
  request: WorkspaceRequest,
  connected: boolean,
  save: SaveExtensionSettings,
  connection: object | null | undefined,
) {
  const draft = useExtensionSettingsDraft(entry, save)
  const manifest = useMemo(
    () => JSON.stringify([clientScopeKey(connection), entry.installed]),
    [connection, entry.installed],
  )
  const [toolState, setToolState] = useState(() => ({
    manifest,
    results: new Map<string, unknown>(),
  }))
  if (toolState.manifest !== manifest) setToolState({ manifest, results: new Map() })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const running = useRef(0)

  async function perform(work: () => Promise<void>, automatic = false) {
    if (!connected || (running.current && !automatic)) return
    running.current++
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      running.current--
      if (!running.current) setBusy(false)
    }
  }

  function setResult(id: string, data: unknown) {
    setToolState((previous) =>
      previous.manifest === manifest && !Object.is(previous.results.get(id), data)
        ? { ...previous, results: new Map(previous.results).set(id, data) }
        : previous,
    )
  }

  const results = extensionViewResultIds(view)
  const actions = extensionViewActionIds(view)
  const tools =
    entry.installed?.contributions.filter(
      (item): item is Extract<ExtensionContribution, { kind: 'tool' }> =>
        item.kind === 'tool' && (actions.has(item.id) || results.has(item.id)),
    ) ?? []
  const sources =
    entry.installed?.contributions
      .filter(isStudioDataSource)
      .filter((source) => results.has(source.id)) ?? []
  const positioned = new Set(
    view.nodes.flatMap((node) => (node.kind === 'data-source' ? [node.source] : [])),
  )
  const { dirty, values } = draft
  return {
    extensionId: entry.id,
    extensionRevision: entry.revision,
    resultScope: manifest,
    sources,
    tools,
    implicitSources: sources.filter((source) => !positioned.has(source.id)),
    readSource: (id: string, automatic?: boolean) =>
      readExtensionDataSource(request, entry, id, automatic),
    setResult,
    nodes: new Map(view.nodes.map((node) => [node.id, node])),
    get: (value: ExtensionViewValue) => extensionViewValue(value, values, toolState.results),
    getSetting: (id: string) => (Object.hasOwn(values, id) ? values[id] : undefined),
    edit: draft.edit,
    dirty,
    discard: draft.discard,
    conflicts: draft.conflicts,
    resolveConflicts: draft.resolveConflicts,
    save: draft.commit,
    settingsSaving: draft.saving,
    run: (id: string, automatic = false) => {
      if (dirty || draft.saving) return
      return perform(async () => {
        if (!entry.installed?.contributions.some((item) => item.kind === 'tool' && item.id === id))
          return
        const { data } = await callStudioExtension(request, entry, id, automatic)
        setResult(id, data)
      }, automatic)
    },
    error: draft.error || error,
    busy: busy || draft.saving,
    disabled: !connected || busy || draft.saving,
    // Tools use saved settings on the runtime. Save local edits before calling a tool.
    actionsDisabled: !connected || busy || draft.saving || dirty,
  }
}

export type ExtensionViewState = ReturnType<typeof useExtensionView>

export class ExtensionComponentBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}
