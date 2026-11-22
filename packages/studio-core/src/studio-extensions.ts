import { Schema } from 'effect'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  decode,
  responses,
  studioExtensionCallResultSchema,
  studioExtensionCommandSchema,
  studioExtensionResultSchema,
  studioExtensionOpenResultSchema,
  studioExtensionsListSchema,
  type RuntimeSnapshot,
  type StudioExtensionCommand,
  type StudioExtensionComponentVersion,
  type StudioExtensionEntry,
} from '@dovo/protocol'
import type { WorkspaceRequest } from './workspace/context'

const mutationResult = Schema.Union([responses.ok, studioExtensionResultSchema])
export function extensionComponentVersion(
  snapshot?: RuntimeSnapshot | null,
): StudioExtensionComponentVersion | undefined {
  return snapshot?.studioExtensionCustomPropsSupported
    ? 2
    : snapshot?.studioExtensionComponentVersion
}

export function useStudioExtensions(
  request: WorkspaceRequest,
  active: boolean,
  scope: string | null = null,
  revision = 0,
  componentVersion?: StudioExtensionComponentVersion,
) {
  const [saved, setSaved] = useState<{
    scope: string | null
    entries: StudioExtensionEntry[]
    allowAgentInstall: boolean
  }>()
  const generation = useRef(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const visible = useRef(active)
  visible.current = active

  async function load() {
    if (!visible.current || running.current) return
    const current = ++generation.current
    try {
      const result = await request(
        '/api/studio-extensions',
        { action: 'list', ...(componentVersion && { componentVersion }) },
        studioExtensionsListSchema,
      )
      if (visible.current && current === generation.current) {
        setSaved({
          scope,
          entries: result.extensions,
          allowAgentInstall: result.allowAgentInstall ?? false,
        })
        setError('')
      }
    } catch (cause) {
      if (visible.current && current === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const loadNow = useEffectEvent(load)
  useEffect(() => {
    if (active) void loadNow()
    return () => {
      generation.current++
    }
  }, [active, scope, request, revision, componentVersion])

  type Change =
    | StudioExtensionCommand
    | { action: 'stage'; manifest: unknown; expectedRevision: number }

  async function mutate(input: Change) {
    if (!visible.current) throw new Error('The computer is offline.')
    if (running.current) throw new Error('Another extension change is in progress.')
    generation.current++
    running.current = true
    setBusy(true)
    setError('')
    try {
      const result = await request(
        '/api/studio-extensions',
        decode(
          studioExtensionCommandSchema,
          componentVersion && (input.action === 'install' || input.action === 'rollback')
            ? { ...input, componentVersion }
            : input,
        ),
        mutationResult,
      )
      // Settings responses may omit views on older wire versions. Merge only the saved fields.
      if (input.action === 'settings' && 'extension' in result) {
        const { id, revision, settings } = result.extension
        setSaved((current) =>
          current?.scope === scope && current
            ? {
                ...current,
                entries: current.entries.map((entry) =>
                  entry.id === id && entry.revision === input.expectedRevision
                    ? { ...entry, revision, settings }
                    : entry,
                ),
              }
            : current,
        )
      }
    } finally {
      running.current = false
      setBusy(false)
      // A rejected write can mean the entry changed on another client. Refresh before retry.
      await load()
    }
  }

  async function change(input: Change) {
    try {
      await mutate(input)
      return true
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return false
    }
  }

  function saveSettings(entry: StudioExtensionEntry, settings: StudioExtensionEntry['settings']) {
    return mutate({ action: 'settings', id: entry.id, expectedRevision: entry.revision, settings })
  }

  return {
    entries: saved?.scope === scope ? saved.entries : [],
    allowAgentInstall: saved?.scope === scope ? saved.allowAgentInstall : false,
    loaded: saved?.scope === scope,
    error,
    busy,
    load,
    change,
    saveSettings,
  }
}

export async function callStudioExtension(
  request: WorkspaceRequest,
  extension: StudioExtensionEntry,
  contributionId: string,
) {
  return request(
    '/api/studio-extensions',
    {
      action: 'call',
      id: extension.id,
      expectedRevision: extension.revision,
      contributionId,
    },
    studioExtensionCallResultSchema,
  )
}

export async function openStudioExtension(
  request: WorkspaceRequest,
  extension: StudioExtensionEntry,
  contributionId: string,
) {
  return request(
    '/api/studio-extensions',
    {
      action: 'open',
      id: extension.id,
      expectedRevision: extension.revision,
      contributionId,
    },
    studioExtensionOpenResultSchema,
  )
}

export function extensionTileOptions(entries: StudioExtensionEntry[]) {
  return entries.flatMap((entry) =>
    entry.enabled && entry.installed
      ? entry.installed.contributions.map((contribution) => ({
          id: `${entry.id}/${contribution.id}`,
          name: `${entry.installed?.name}: ${contribution.title}`,
          extensionId: entry.id,
          contributionId: contribution.id,
        }))
      : [],
  )
}
