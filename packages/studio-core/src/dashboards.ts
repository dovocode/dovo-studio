import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  dashboardDeleteResultSchema,
  dashboardReadResultSchema,
  dashboardRunResultSchema,
  dashboardSessionResultSchema,
  responses,
  forgePipelinePageSchema,
  dashboardListResultSchema,
  dashboardSaveResultSchema,
  dashboardSchema,
  decode,
  artifactFeedSelect,
  randomUUID,
  SCRATCH_PROJECT_ID,
  type Dashboard,
  type DashboardTile,
  type Repository,
  type RuntimeReadCache,
} from '@dovo/protocol'
import type { WorkspaceRequest } from './workspace/context'

export const dashboardTileLabels = {
  api: 'HTTP data',
  cli: 'CLI data',
  mcp: 'MCP data',
  command: 'Command',
  tui: 'TUI',
  terminal: 'Terminal',
  iframe: 'Iframe',
  browser: 'Studio Browser',
  gui: 'Remote desktop',
  app: 'MCP App / A2UI card',
  extension: 'Studio extension',
  pipelines: 'Pipelines',
  threads: 'Threads',
  jobs: 'Automations',
} satisfies Record<DashboardTile['kind'], string>

export const dashboardTileGroups = [
  { label: 'Data sources', kinds: ['api', 'cli', 'mcp'] },
  { label: 'Project activity', kinds: ['pipelines', 'threads', 'jobs'] },
  {
    label: 'Interactive tiles',
    kinds: ['command', 'tui', 'terminal', 'iframe', 'browser', 'gui', 'app', 'extension'],
  },
] satisfies { label: string; kinds: DashboardTile['kind'][] }[]

export const dashboardDisplayLabels = {
  table: 'Table',
  number: 'Metric',
  line: 'Line graph',
} as const

export function isDashboardDisplay(value: string): value is keyof typeof dashboardDisplayLabels {
  return Object.hasOwn(dashboardDisplayLabels, value)
}

export function newDashboardTile(kind: DashboardTile['kind']): DashboardTile {
  const base = { id: randomUUID(), title: dashboardTileLabels[kind], span: 2, height: 2 }
  switch (kind) {
    case 'api':
      return { ...base, kind, url: '', pointer: '', chart: 'table' }
    case 'cli':
      return { ...base, kind, repositoryId: '', command: '', pointer: '', chart: 'table' }
    case 'mcp':
      return {
        ...base,
        kind,
        taskId: '',
        server: '',
        tool: '',
        arguments: '{}',
        pointer: '',
        chart: 'table',
      }
    case 'command':
      return { ...base, kind, repositoryId: '', command: '' }
    case 'tui':
      return { ...base, kind, span: 4, height: 3, repositoryId: SCRATCH_PROJECT_ID, command: '' }
    case 'iframe':
    case 'browser':
      return { ...base, kind, url: '' }
    case 'pipelines':
      return { ...base, kind, repositoryId: '' }
    case 'app':
      return { ...base, kind, taskId: '', appId: '' }
    case 'extension':
      return { ...base, kind, extensionId: '', contributionId: '' }
    case 'terminal':
      return { ...base, kind, terminalId: '' }
    default:
      return { ...base, kind }
  }
}

export function dashboardTileFields(
  tile: DashboardTile,
): readonly (readonly [string, string, string])[] {
  switch (tile.kind) {
    case 'api':
      return [
        ['url', 'URL', tile.url],
        ['pointer', 'JSON pointer', tile.pointer],
      ]
    case 'cli':
      return [
        ['repositoryId', 'Project', tile.repositoryId],
        ['command', 'Command', tile.command],
        ['pointer', 'JSON pointer', tile.pointer],
      ]
    case 'mcp':
      return [
        ['taskId', 'Source thread', tile.taskId],
        ['server', 'MCP server', tile.server],
        ['tool', 'Tool', tile.tool],
        ['arguments', 'Arguments (JSON)', tile.arguments],
        ['pointer', 'JSON pointer', tile.pointer],
      ]
    case 'command':
      return [
        ['repositoryId', 'Project', tile.repositoryId],
        ['command', 'Command', tile.command],
      ]
    case 'tui':
      return [
        ['repositoryId', 'Start in', tile.repositoryId],
        ['command', 'Startup command', tile.command],
      ]
    case 'pipelines':
      return [['repositoryId', 'Project', tile.repositoryId]]
    case 'iframe':
    case 'browser':
      return [['url', 'URL', tile.url]]
    case 'app':
      return [['taskId', 'Source thread', tile.taskId]]
    case 'extension':
      return [
        ['extensionId', 'Extension ID', tile.extensionId],
        ['contributionId', 'Contribution ID', tile.contributionId],
      ]
    case 'terminal':
      return [['terminalId', 'Terminal', tile.terminalId]]
    default:
      return []
  }
}

export function dashboardProjectOptions(
  kind: DashboardTile['kind'],
  projects: readonly Pick<Repository, 'id' | 'name'>[],
) {
  if (kind === 'tui' || kind === 'command')
    return [
      { id: SCRATCH_PROJECT_ID, name: 'Home folder' },
      ...projects.filter((project) => project.id !== SCRATCH_PROJECT_ID),
    ]
  if (kind === 'cli' && !projects.some((project) => project.id === SCRATCH_PROJECT_ID))
    return [...projects, { id: SCRATCH_PROJECT_ID, name: 'No Project' }]
  return projects
}

export function moveDashboardTile(tiles: DashboardTile[], index: number, offset: number) {
  const destination = index + offset
  if (destination < 0 || destination >= tiles.length) return tiles
  const next = [...tiles]
  const [tile] = next.splice(index, 1)
  if (!tile) return tiles
  next.splice(destination, 0, tile)
  return next
}

export function dashboardPanelValue(value: unknown, pointer: string) {
  try {
    return artifactFeedSelect(value, pointer)
  } catch {
    return undefined
  }
}

export function dashboardDataRows(data: unknown) {
  const entries = Array.isArray(data) ? data : [data]
  const rows = entries
    .slice(0, 50)
    .map((entry: unknown) =>
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? Object.entries(entry)
        : [['Value', entry]],
    )
  const columns = [...new Set(rows.flatMap((row) => row.map(([key]) => String(key))))].slice(0, 12)
  return {
    columns,
    rows: rows.map((row) =>
      columns.map((column) => {
        const value = row.find(([key]) => key === column)?.[1]
        return typeof value === 'string' ? value : (JSON.stringify(value) ?? '').slice(0, 1024)
      }),
    ),
  }
}

export function dashboardGraph(data: unknown) {
  if (!Array.isArray(data)) return []
  return data
    .flatMap((entry: unknown) => {
      const value =
        typeof entry === 'object' && entry !== null && 'value' in entry ? entry.value : entry
      return typeof value === 'number' && Number.isFinite(value) ? [value] : []
    })
    .slice(-200)
}

export function useDashboards(
  request: WorkspaceRequest,
  connected: boolean,
  readCache: RuntimeReadCache | null,
  focused = true,
  dataSources = false,
  saveReceipts = false,
) {
  const [dashboards, setDashboards] = useState<Dashboard[]>([])
  const [selection, select] = useState('')
  const [draft, edit] = useState<Dashboard>()
  const [draftBase, setDraftBase] = useState<Dashboard>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [cacheError, setCacheError] = useState('')
  const busy = useRef(false)
  const saveAttempt = useRef<{ key: string; requestId: string } | undefined>(undefined)
  const generation = useRef(0)
  const loaded = useRef(false)
  const dashboard = dashboards.find((entry) => entry.id === selection)

  function publish(next: Dashboard[]) {
    loaded.current = true
    setDashboards(next)
    select((id) => (next.some((entry) => entry.id === id) ? id : (next[0]?.id ?? '')))
  }

  async function cache(next: Dashboard[]) {
    if (!readCache) return
    try {
      await readCache.write('dashboards:list', { dashboards: next })
      setCacheError('')
    } catch {
      setCacheError('The dashboard list could not be saved for offline use.')
    }
  }

  const restore = useEffectEvent(async (cache: RuntimeReadCache, active: () => boolean) => {
    try {
      const saved = await cache.read('dashboards:list', dashboardListResultSchema)
      if (saved && active() && !loaded.current && !busy.current) publish(saved.value.dashboards)
    } catch {
      if (active() && !loaded.current)
        setCacheError('The saved dashboard list could not be opened.')
    }
  })
  useEffect(() => {
    if (!readCache || !focused) return
    let active = true
    void restore(readCache, () => active)
    return () => {
      active = false
    }
  }, [readCache, focused])

  async function perform(operation: () => Promise<void>) {
    if (busy.current || !connected) return
    busy.current = true
    generation.current++
    setPending(true)
    setError('')
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      busy.current = false
      setPending(false)
    }
  }

  async function load() {
    if (!connected || busy.current) return
    const current = ++generation.current
    setError('')
    try {
      const result = await request(
        '/api/dashboards/list',
        dataSources ? { dataSources: true } : {},
        dashboardListResultSchema,
      )
      if (current !== generation.current) return
      publish(result.dashboards)
      await cache(result.dashboards)
    } catch (cause) {
      if (current === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  const loadOnConnect = useEffectEvent(load)
  useEffect(() => {
    if (connected && focused) void loadOnConnect()
    return () => {
      generation.current++
    }
  }, [connected, focused, dataSources])

  return {
    dashboards,
    dashboard,
    select,
    draft,
    dirty: !!draft && JSON.stringify(draft) !== JSON.stringify(draftBase),
    edit,
    beginEdit: (next: Dashboard) => {
      setDraftBase(next.revision ? next : undefined)
      edit(next)
    },
    pending,
    error,
    cacheError,
    load,
    create: () => {
      const next = { id: randomUUID(), title: 'New dashboard', revision: 0, tiles: [] }
      setDraftBase(next)
      edit(next)
    },
    copyDraft: () => {
      if (draft) edit({ ...draft, id: randomUUID(), revision: 0 })
    },
    save: () =>
      perform(async () => {
        if (!draft) return
        const dashboard = decode(dashboardSchema, draft)
        const key = JSON.stringify(dashboard)
        if (saveAttempt.current?.key !== key) saveAttempt.current = { key, requestId: randomUUID() }
        const result = await request(
          '/api/dashboards/save',
          {
            dashboard,
            expectedRevision: draft.revision,
            ...(saveReceipts ? { requestId: saveAttempt.current.requestId } : {}),
          },
          dashboardSaveResultSchema,
        )
        saveAttempt.current = undefined
        const next = dashboards.some((entry) => entry.id === result.dashboard.id)
          ? dashboards.map((entry) =>
              entry.id === result.dashboard.id && result.dashboard.revision >= entry.revision
                ? result.dashboard
                : entry,
            )
          : [...dashboards, result.dashboard]
        publish(next)
        select(result.dashboard.id)
        edit(undefined)
        await cache(next)
      }),
    remove: () =>
      perform(async () => {
        if (!dashboard) return
        await request(
          '/api/dashboards/delete',
          { id: dashboard.id, expectedRevision: dashboard.revision },
          dashboardDeleteResultSchema,
        )
        const next = dashboards.filter((entry) => entry.id !== dashboard.id)
        publish(next)
        await cache(next)
      }),
  }
}

export const maxDashboardTemplateBytes = 1024 * 1024
export const dashboardTemplateMime = 'application/json'

function portableDashboard(dashboard: Dashboard): Dashboard {
  return {
    ...dashboard,
    revision: 0,
    tiles: dashboard.tiles.map((tile) => {
      if (tile.kind === 'terminal') return { ...tile, terminalId: '' }
      if (
        tile.kind === 'command' ||
        tile.kind === 'tui' ||
        tile.kind === 'pipelines' ||
        tile.kind === 'cli'
      )
        return {
          ...tile,
          repositoryId:
            tile.kind !== 'pipelines' && tile.repositoryId === SCRATCH_PROJECT_ID
              ? SCRATCH_PROJECT_ID
              : '',
        }
      if (tile.kind === 'mcp') return { ...tile, taskId: '' }
      if (tile.kind === 'app') return { ...tile, taskId: '', appId: '' }
      return tile
    }),
  }
}

export function dashboardTemplate(dashboard: Dashboard) {
  const template = portableDashboard(dashboard)
  const formatted = JSON.stringify(template, null, 2) + '\n'
  return new TextEncoder().encode(formatted).byteLength <= maxDashboardTemplateBytes
    ? formatted
    : JSON.stringify(template)
}

export function dashboardTemplateFilename(title: string) {
  const name = title
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 80)
    .replace(/^-+|-+$/g, '')
  const stem = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(name) ? `dashboard-${name}` : name
  return `${stem || 'dashboard'}.dovo-dashboard.json`
}

export function importDashboardTemplate(source: string): Dashboard {
  if (
    source.length > maxDashboardTemplateBytes ||
    new TextEncoder().encode(source).byteLength > maxDashboardTemplateBytes
  )
    throw new Error('Choose a dashboard file of 1 MB or less.')
  let template: unknown
  try {
    template = JSON.parse(source.replace(/^\uFEFF/, ''))
  } catch {
    throw new Error('This file does not contain valid dashboard JSON.')
  }
  const dashboard = portableDashboard(decode(dashboardSchema, template))
  return {
    ...dashboard,
    id: randomUUID(),
    tiles: dashboard.tiles.map((tile) => ({ ...tile, id: randomUUID() })),
  }
}

export function dashboardLinePlot(data: unknown) {
  const values = dashboardGraph(data)
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const scale = Math.max(Math.abs(min), Math.abs(max), 1)
  const range = max / scale - min / scale
  const points = values
    .map((value, index) => {
      const x = 5 + (index * 310) / (values.length - 1)
      const y = range === 0 ? 60 : 115 - ((value / scale - min / scale) * 110) / range
      return `${x},${y}`
    })
    .join(' ')
  return { min, max, latest: values.at(-1), points }
}

export function readDashboardDataSource(
  request: WorkspaceRequest,
  dashboard: Dashboard,
  tile: Extract<DashboardTile, { kind: 'api' | 'cli' | 'mcp' }>,
  automatic = false,
) {
  return request(
    tile.kind === 'cli' ? '/api/dashboards/command-data' : '/api/dashboards/read',
    {
      id: dashboard.id,
      tileId: tile.id,
      expectedRevision: dashboard.revision,
      ...(automatic ? { automatic } : {}),
    },
    dashboardReadResultSchema,
  )
}

export function useDashboardTile(
  request: WorkspaceRequest,
  dashboard: Dashboard,
  tile: DashboardTile,
  connected: boolean,
  visible = true,
) {
  const [pipelines, setPipelines] = useState<typeof forgePipelinePageSchema.Type>()
  const [terminalId, setTerminalId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sessionError, setSessionError] = useState('')
  const [sessionLoading, setSessionLoading] = useState(true)
  const retryId = useRef<string | undefined>(undefined)
  const pending = useRef(false)
  const generation = useRef(0)
  const id = dashboard.id
  const tileId = tile.id
  const expectedRevision = dashboard.revision
  const runnable = tile.kind === 'command' || tile.kind === 'tui'

  async function perform(operation: () => Promise<void>) {
    if (!connected || pending.current) return
    pending.current = true
    generation.current++
    setBusy(true)
    setError('')
    try {
      await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    if (!runnable || !connected || !visible || pending.current) return
    const current = ++generation.current
    setSessionError('')
    setSessionLoading(true)
    void request(
      '/api/dashboards/session',
      { id, tileId, expectedRevision },
      dashboardSessionResultSchema,
    )
      .then((result) => {
        if (current === generation.current) setTerminalId(result.terminalId ?? '')
      })
      .catch((cause: unknown) => {
        if (current === generation.current)
          setSessionError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (current === generation.current) setSessionLoading(false)
      })
    return () => {
      generation.current++
    }
  }, [request, id, tileId, expectedRevision, runnable, connected, visible])

  return {
    pipelines,
    terminalId,
    busy,
    sessionLoading,
    error: error || sessionError,
    recovering: !!retryId.current,
    refreshPipelines: () =>
      perform(async () => {
        if (tile.kind !== 'pipelines') return
        setPipelines(
          await request(
            '/api/scm/work/pipelines/list',
            { repositoryId: tile.repositoryId, refresh: true },
            forgePipelinePageSchema,
          ),
        )
      }),
    run: (onSuccess?: () => void) =>
      perform(async () => {
        retryId.current ??= randomUUID()
        const result = await request(
          '/api/dashboards/run',
          {
            id,
            tileId,
            expectedRevision,
            requestId: retryId.current,
          },
          dashboardRunResultSchema,
        )
        setTerminalId(result.terminalId)
        retryId.current = undefined
        setSessionError('')
        onSuccess?.()
      }),
    close: () =>
      perform(async () => {
        if (!terminalId) return
        await request('/api/terminals/close', { id: terminalId }, responses.ok)
        setTerminalId('')
      }),
  }
}
