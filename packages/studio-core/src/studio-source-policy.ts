import { useEffect, useEffectEvent, useState } from 'react'
import { studioSourcePolicySchema, type StudioSourcePolicy } from '@dovo/protocol'
import type { WorkspaceRequest } from './workspace/context'
import type { StudioReadingOwner } from './studio-data-sources'

export function useStudioSourcePolicy(
  request: WorkspaceRequest,
  enabled: boolean,
  owner: StudioReadingOwner,
  revision: number | undefined,
  sourceId: string,
) {
  const [kind, id] = owner
  const key = JSON.stringify([kind, id, sourceId, revision])
  const [state, setState] = useState<{
    key: string
    request: WorkspaceRequest
    policy?: StudioSourcePolicy
    error?: string
  }>()
  const [saving, setSaving] = useState(false)
  const current = state?.key === key && state.request === request ? state : undefined
  useEffect(() => {
    if (!enabled || revision === undefined) return
    let active = true
    void request(
      '/api/studio/source-policy',
      { owner: kind, id, sourceId, expectedRevision: revision },
      studioSourcePolicySchema,
    ).then(
      (policy) => {
        if (active) setState({ key, request, policy })
      },
      (cause: unknown) => {
        if (active)
          setState({ key, request, error: cause instanceof Error ? cause.message : String(cause) })
      },
    )
    return () => {
      active = false
    }
  }, [enabled, revision, request, kind, id, sourceId, key])
  return {
    policy: enabled ? current?.policy : undefined,
    saving,
    error: enabled ? current?.error : undefined,
    save: async (policy: StudioSourcePolicy) => {
      if (!enabled || revision === undefined || saving) return
      setSaving(true)
      try {
        const updated = await request(
          '/api/studio/source-policy',
          { owner: kind, id, sourceId, expectedRevision: revision, policy },
          studioSourcePolicySchema,
        )
        setState({ key, request, policy: updated })
      } catch (cause) {
        setState({
          key,
          request,
          policy: current?.policy,
          error: cause instanceof Error ? cause.message : String(cause),
        })
      } finally {
        setSaving(false)
      }
    },
  }
}

export function useStudioAutoLoad(active: boolean, enabled: boolean, load: () => void) {
  const start = useEffectEvent(load)
  useEffect(() => {
    if (active && enabled) start()
  }, [active, enabled])
}
