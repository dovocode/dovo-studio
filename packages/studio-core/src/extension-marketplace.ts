import { useEffect, useState } from 'react'
import {
  dashboardListResultSchema,
  dashboardSaveResultSchema,
  marketplaceDetailSchema,
  marketplaceListSchema,
  marketplaceSourcesSchema,
  randomUUID,
  type MarketplaceBinding,
  type MarketplacePackage,
  type MarketplaceRelease,
  type StudioExtensionCommand,
  type StudioExtensionEntry,
} from '@dovo/protocol'
import type { WorkspaceRequest } from './workspace/context'

export function useExtensionMarketplace(
  request: WorkspaceRequest,
  connected: boolean,
  revision: number | undefined,
  entries: StudioExtensionEntry[],
) {
  const [packages, setPackages] = useState<MarketplacePackage[]>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [selection, select] = useState<MarketplacePackage>()
  const [query, setQuery] = useState('')
  const [bindings, setBindings] = useState<MarketplaceBinding[]>([])
  const [preview, setPreview] = useState<{ digest: string; release: MarketplaceRelease }>()
  const [previewError, setPreviewError] = useState('')

  const entryRevisions = entries.map(({ id, revision }) => `${id}:${revision}`).join(',')
  useEffect(() => {
    if (!connected) return
    let active = true
    request(
      '/api/studio-extensions',
      { action: 'marketplace', marketplace: { action: 'list' } },
      marketplaceListSchema,
    )
      .then((result) => {
        if (!active) return
        setPackages(result.packages)
        setError('')
      })
      .catch((cause: unknown) => {
        if (active) setError(issue(cause))
      })
    return () => {
      active = false
    }
  }, [request, connected, revision, entryRevisions, attempt])

  const id = selection?.id
  const digest = selection?.digest
  useEffect(() => {
    if (!connected || !id || !digest) return
    let active = true
    request(
      '/api/studio-extensions',
      { action: 'marketplace', marketplace: { action: 'read', id, digest } },
      marketplaceDetailSchema,
    )
      .then((result) => {
        if (active && result.digest === digest) setPreview({ digest, release: result.package })
      })
      .catch((cause: unknown) => {
        if (active) setPreviewError(issue(cause))
      })
    return () => {
      active = false
    }
  }, [request, connected, id, digest, attempt])

  const normalizedQuery = query.trim().toLowerCase()
  return {
    packages: packages?.filter((item) =>
      [item.name, item.publisher, item.description, item.id].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      ),
    ),
    search: { query, setQuery },
    selected: packages?.find((item) => item.digest === digest) ?? selection,
    release: preview?.digest === digest ? preview?.release : undefined,
    error: error || previewError,
    reload: () => {
      setError('')
      setPreviewError('')
      setAttempt((value) => value + 1)
    },
    open: (entry: MarketplacePackage | undefined) => {
      if (entry?.digest === digest) return
      setPreview(undefined)
      setPreviewError('')
      setBindings([])
      select(entry)
    },
    binding: (id: string) => bindings.find((value) => value.contributionId === id),
    bind: (binding: MarketplaceBinding) =>
      setBindings((previous) => [
        ...previous.filter((item) => item.contributionId !== binding.contributionId),
        binding,
      ]),
    stage: (installed: StudioExtensionEntry | undefined): StudioExtensionCommand | undefined => {
      if (!selection || preview?.digest !== selection.digest) return
      const required = preview.release.manifest.contributions.filter(
        (item) => item.kind === 'tool' || item.kind === 'app',
      )
      if (
        !required.every(({ id }) =>
          bindings.some((item) => item.contributionId === id && item.source),
        )
      )
        return
      return {
        action: 'marketplace',
        marketplace: {
          action: 'stage',
          id: selection.id,
          digest: selection.digest,
          expectedRevision: installed?.revision ?? 0,
          bindings,
        },
      }
    },
  }
}

export function useMarketplaceSources(
  request: WorkspaceRequest,
  taskId: string | undefined,
  connected: boolean,
) {
  const [loaded, setLoaded] = useState<{
    taskId: string
    data?: typeof marketplaceSourcesSchema.Type
    error?: string
  }>()
  useEffect(() => {
    if (!connected || !taskId) return
    let active = true
    request(
      '/api/studio-extensions',
      { action: 'marketplace', marketplace: { action: 'sources', taskId } },
      marketplaceSourcesSchema,
    )
      .then((data) => {
        if (active) setLoaded({ taskId, data })
      })
      .catch((cause: unknown) => {
        if (active) setLoaded({ taskId, error: issue(cause) })
      })
    return () => {
      active = false
    }
  }, [request, taskId, connected])
  return loaded?.taskId === taskId ? loaded : undefined
}

export function marketplaceContributionSource(
  value: Extract<MarketplaceRelease['manifest']['contributions'][number], { kind: 'tool' | 'app' }>,
) {
  return value.kind === 'tool' ? `MCP server with read-only tool ${value.tool}` : 'Saved MCP App'
}

export async function addMarketplaceDashboard(
  request: WorkspaceRequest,
  release: MarketplaceRelease,
) {
  const template = release.dashboard
  if (!template) return
  const hasDashboard = async () =>
    (await request('/api/dashboards/list', {}, dashboardListResultSchema)).dashboards.some(
      (dashboard) => dashboard.id === template.id,
    )
  if (await hasDashboard()) return
  try {
    await request(
      '/api/dashboards/save',
      {
        expectedRevision: 0,
        dashboard: {
          id: template.id,
          title: template.title,
          revision: 0,
          tiles: template.tiles.map((tile) => ({
            ...tile,
            id: randomUUID(),
            kind: 'extension',
            extensionId: release.manifest.id,
            span: 2,
            height: 2,
          })),
        },
      },
      dashboardSaveResultSchema,
    )
  } catch (cause) {
    if (!(await hasDashboard().catch(() => false))) throw cause
  }
}

function issue(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}
