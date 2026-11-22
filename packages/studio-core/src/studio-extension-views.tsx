import { Component, useMemo, useRef, useState, type ReactNode } from 'react'
import type {
  ExtensionSettingValue,
  ExtensionView,
  ExtensionViewValue,
  StudioExtensionEntry,
} from '@dovo/protocol'
import { callStudioExtension } from './studio-extensions'
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
) {
  const draft = useExtensionSettingsDraft(entry, save)
  const manifest = useMemo(() => JSON.stringify(entry.installed), [entry.installed])
  const [toolState, setToolState] = useState(() => ({
    manifest,
    results: new Map<string, unknown>(),
  }))
  if (toolState.manifest !== manifest) setToolState({ manifest, results: new Map() })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const running = useRef(false)

  async function perform(work: () => Promise<void>) {
    if (!connected || running.current) return
    running.current = true
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      running.current = false
      setBusy(false)
    }
  }

  const { dirty, values } = draft
  return {
    nodes: new Map(view.nodes.map((node) => [node.id, node])),
    get: (value: ExtensionViewValue) => extensionViewValue(value, values, toolState.results),
    getSetting: (id: string) => (Object.hasOwn(values, id) ? values[id] : undefined),
    edit: draft.edit,
    dirty,
    discard: draft.discard,
    conflicts: draft.conflicts,
    resolveConflicts: draft.resolveConflicts,
    save: draft.commit,
    run: (id: string) => {
      if (dirty || draft.saving) return
      return perform(async () => {
        if (!entry.installed?.contributions.some((item) => item.kind === 'tool' && item.id === id))
          return
        const { data } = await callStudioExtension(request, entry, id)
        setToolState((previous) =>
          previous.manifest === manifest
            ? { ...previous, results: new Map(previous.results).set(id, data) }
            : previous,
        )
      })
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
