import { useEffect, useRef, useState } from 'react'
import {
  codexSessionListSchema,
  codexSessionPreviewSchema,
  codexSessionImportResultSchema,
  type CodexSessionCandidate,
  type CodexSessionPreview,
} from '@dovo/protocol'
import type { WorkspaceRequest } from './workspace/context'

/** Shared picker state; all discovery/import authority stays on the paired runtime. */
export function useCodexSessionImport(
  request: WorkspaceRequest,
  repositoryId: string,
  open: boolean,
) {
  const [agentId, setAgentId] = useState('')
  const [selected, setSelected] = useState('')
  const [revision, setRevision] = useState(0)
  const [listing, setListing] = useState<{
    owner: string
    sessions: CodexSessionCandidate[]
    notice?: string
    error?: string
  }>()
  const [detail, setDetail] = useState<{
    owner: string
    preview?: CodexSessionPreview
    error?: string
  }>()
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState('')
  const owner = JSON.stringify([repositoryId, agentId, revision])
  const detailOwner = JSON.stringify([owner, selected])
  const currentOwner = useRef(detailOwner)
  const mounted = useRef(false)
  const generation = useRef(0)
  currentOwner.current = detailOwner
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    return () => {
      generation.current += 1
    }
  }, [open, request])
  const current = listing?.owner === owner ? listing : undefined
  const preview = detail?.owner === detailOwner ? detail.preview : undefined
  const error = importError || (detail?.owner === detailOwner ? detail.error : '') || current?.error
  useEffect(() => {
    if (!open) return
    let active = true
    void request(
      '/api/tasks/codex-sessions/list',
      { repositoryId, agentId },
      codexSessionListSchema,
    ).then(
      (result) => {
        if (active) setListing({ ...result, owner })
      },
      (error: unknown) => {
        if (active)
          setListing({
            owner,
            sessions: [],
            error: error instanceof Error ? error.message : String(error),
          })
      },
    )
    return () => {
      active = false
    }
  }, [request, repositoryId, agentId, open, owner])
  useEffect(() => {
    if (!open || !selected) return
    let active = true
    void request(
      '/api/tasks/codex-sessions/preview',
      { repositoryId, agentId, key: selected },
      codexSessionPreviewSchema,
    ).then(
      (preview) => {
        if (active) setDetail({ owner: detailOwner, preview })
      },
      (error: unknown) => {
        if (active)
          setDetail({
            owner: detailOwner,
            error: error instanceof Error ? error.message : String(error),
          })
      },
    )
    return () => {
      active = false
    }
  }, [request, repositoryId, agentId, selected, open, detailOwner])
  return {
    agentId,
    setAgentId: (id: string) => {
      setAgentId(id)
      setSelected('')
      setImportError('')
    },
    selected,
    select: (key: string) => {
      setSelected(key)
      setImportError('')
    },
    refresh: () => {
      setRevision((value) => value + 1)
      setImportError('')
    },
    sessions: current?.sessions,
    notice: current?.notice,
    preview,
    error,
    importing,
    importSession: async () => {
      if (!open || !preview || preview.status !== 'available' || importing) return undefined
      const startedGeneration = generation.current
      setImporting(true)
      setImportError('')
      try {
        const result = await request(
          '/api/tasks/codex-sessions/import',
          {
            repositoryId,
            agentId,
            key: selected,
            revision: preview.revision,
          },
          codexSessionImportResultSchema,
        )
        return mounted.current &&
          generation.current === startedGeneration &&
          currentOwner.current === detailOwner
          ? result
          : undefined
      } catch (error) {
        if (
          mounted.current &&
          generation.current === startedGeneration &&
          currentOwner.current === detailOwner
        )
          setImportError(error instanceof Error ? error.message : String(error))
        return undefined
      } finally {
        if (mounted.current) setImporting(false)
      }
    },
  }
}
