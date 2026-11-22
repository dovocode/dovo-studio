import { DataView } from './data-view'
import { lazy, Suspense, useRef, useState, type CSSProperties } from 'react'
import {
  STUDIO_BROWSER_SCOPE,
  runtimeComputerName,
  type Dashboard,
  type DashboardTile,
} from '@dovo/protocol'
import {
  encodeWorkTarget,
  clientScopeKey,
  dashboardTemplate,
  dashboardTemplateFilename,
  dashboardTemplateMime,
  maxDashboardTemplateBytes,
  importDashboardTemplate,
  dashboardTileFields,
  dashboardTileLabels,
  moveDashboardTile,
  newDashboardTile,
  useDashboardTile,
  useDashboards,
  extensionTileOptions,
  useStudioExtensions,
  extensionComponentVersion,
  useStudioHost,
  useWorkspace,
  WorkspaceScope,
} from '@dovo/studio-core'
const ExtensionTile = lazy(async () => ({
  default: (await import('../studio-extensions/view')).ExtensionTile,
}))
const TerminalSession = lazy(async () => ({
  default: (await import('../terminal/terminal-session')).TerminalSession,
}))
const McpAppView = lazy(async () => ({ default: (await import('../chat/mcp-app')).McpAppView }))
const BrowserPane = lazy(async () => ({
  default: (await import('../browser/browser-pane')).BrowserPane,
}))

const RemoteDesktopViewer = lazy(async () => ({
  default: (await import('@dovo/extension-runtime/remote-desktop-viewer')).RemoteDesktopViewer,
}))

const button = 'rounded-md border px-2.5 py-1.5 text-sm hover:bg-muted disabled:opacity-50'
type TileStyle = CSSProperties & { '--tile-span': number }
function tileLayout(tile: DashboardTile, expanded: boolean): TileStyle {
  return {
    '--tile-span': expanded ? 4 : tile.span,
    height: expanded ? 'min(75dvh, 880px)' : `${tile.height * 112 + 42}px`,
  }
}
const field = 'min-w-0 rounded-md border bg-background px-2 py-1.5 text-sm'
const tileKinds = Object.keys(dashboardTileLabels).filter(isTileKind)
function isTileKind(value: string): value is DashboardTile['kind'] {
  return Object.hasOwn(dashboardTileLabels, value)
}

export default function DashboardsView() {
  const { runtimes, activeRuntimeId } = useWorkspace()
  const [owner, setOwner] = useState(activeRuntimeId ?? '')
  const computers = runtimes.filter((entry) => entry.snapshot?.dashboardsSupported)
  const selected =
    computers.find((entry) => entry.profile.id === owner) ??
    computers.find((entry) => entry.profile.id === activeRuntimeId) ??
    computers[0]
  return (
    <main className="h-full overflow-auto p-4 md:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Dashboards</h1>
      </header>
      {selected ? (
        <WorkspaceScope
          key={clientScopeKey(selected.profile.connection)}
          profile={selected.profile}
        >
          <Board
            owner={selected.profile.id}
            computers={computers.map((entry) => ({
              id: entry.profile.id,
              name: runtimeComputerName(entry),
            }))}
            setOwner={setOwner}
          />
        </WorkspaceScope>
      ) : (
        <p className="text-sm text-muted-foreground">Connect a computer with dashboard support.</p>
      )}
    </main>
  )
}

function Board({
  owner,
  computers,
  setOwner,
}: {
  owner: string
  computers: { id: string; name: string }[]
  setOwner: (id: string) => void
}) {
  const { request, connected, readCache, snapshot } = useWorkspace()
  const state = useDashboards(request, connected, readCache)
  const { dashboard, draft } = state
  const supported = snapshot?.studioExtensionsSupported === true
  const extensions = useStudioExtensions(
    request,
    connected && supported && (draft?.tiles.some((tile) => tile.kind === 'extension') ?? false),
    null,
    snapshot?.studioExtensionsRevision,
    extensionComponentVersion(snapshot),
  )
  const extensionOptions = extensionTileOptions(extensions.entries)
  const availableKinds = tileKinds.filter((kind) => kind !== 'extension' || supported)

  const [kind, setKind] = useState<DashboardTile['kind']>('api')
  const [template, setTemplate] = useState<string>()
  const [templateError, setTemplateError] = useState('')
  const [importedId, setImportedId] = useState('')
  const [expandedTile, setExpandedTile] = useState('')
  const [readingFile, setReadingFile] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  async function importFile(file: File) {
    setReadingFile(true)
    setTemplateError('')
    try {
      if (file.size > maxDashboardTemplateBytes)
        throw new Error('Choose a dashboard file of 1 MB or less.')
      openTemplate(await file.text())
    } catch (cause) {
      setTemplateError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setReadingFile(false)
    }
  }

  function exportFile(dashboard: Dashboard) {
    const file = new Blob([dashboardTemplate(dashboard)], { type: dashboardTemplateMime })
    const url = URL.createObjectURL(file)
    const link = document.createElement('a')
    link.href = url
    link.download = dashboardTemplateFilename(dashboard.title)
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  function openTemplate(source: string) {
    const imported = importDashboardTemplate(source)
    state.edit(imported)
    setImportedId(imported.id)
    setTemplate(undefined)
    setTemplateError('')
  }

  function importTemplate() {
    if (template === undefined) return
    try {
      openTemplate(template)
    } catch (cause) {
      setTemplateError(cause instanceof Error ? cause.message : String(cause))
    }
  }
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-sm">
          Computer
          <select
            className={field}
            disabled={!!draft || state.pending || readingFile}
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
          >
            {computers.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        {state.dashboards.length > 0 && (
          <select
            aria-label="Dashboard"
            className={field}
            disabled={!!draft || state.pending || readingFile}
            value={dashboard?.id ?? ''}
            onChange={(event) => state.select(event.target.value)}
          >
            {state.dashboards.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.title}
              </option>
            ))}
          </select>
        )}
        {draft ? (
          <>
            <button
              className={button}
              disabled={!connected || state.pending}
              onClick={() => void state.save()}
            >
              Save dashboard
            </button>
            {draft.revision > 0 && state.error && (
              <button className={button} disabled={state.pending} onClick={state.copyDraft}>
                Keep as new dashboard
              </button>
            )}
            <button
              className={button}
              disabled={state.pending}
              onClick={() => state.edit(undefined)}
            >
              Cancel edits
            </button>
          </>
        ) : (
          <>
            <button
              className={button}
              disabled={state.pending || readingFile}
              onClick={state.create}
            >
              New dashboard
            </button>
            <button
              className={button}
              disabled={state.pending || readingFile}
              onClick={() => picker.current?.click()}
            >
              Import dashboard
            </button>
            <input
              ref={picker}
              aria-label="Dashboard file"
              hidden
              type="file"
              accept=".json,application/json"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ''
                if (file) void importFile(file)
              }}
            />
            <button
              className={button}
              disabled={state.pending || readingFile}
              onClick={() => {
                setTemplate('')
                setTemplateError('')
              }}
            >
              Paste template
            </button>
            {dashboard && (
              <>
                <button
                  className={button}
                  disabled={state.pending || readingFile}
                  onClick={() => state.edit(dashboard)}
                >
                  Edit dashboard
                </button>
                <button
                  className={button}
                  disabled={readingFile}
                  onClick={() => exportFile(dashboard)}
                >
                  Export dashboard
                </button>
                <button
                  className={button}
                  disabled={readingFile}
                  onClick={() => {
                    setTemplate(dashboardTemplate(dashboard))
                    setTemplateError('')
                  }}
                >
                  View template
                </button>
                <button
                  className={button}
                  disabled={!connected || state.pending || readingFile}
                  onClick={() => {
                    if (window.confirm(`Delete "${dashboard.title}"?`)) void state.remove()
                  }}
                >
                  Delete dashboard
                </button>
              </>
            )}
            <button
              className={button}
              disabled={!connected || state.pending}
              onClick={() => void state.load()}
            >
              Reload
            </button>
          </>
        )}
      </div>
      {!draft && template !== undefined && (
        <section className="mb-4 grid max-w-2xl gap-2">
          <label className="grid gap-1 text-sm">
            Dashboard template (JSON)
            <textarea
              className={field}
              rows={8}
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              className={button}
              disabled={!template.trim() || readingFile}
              onClick={importTemplate}
            >
              Open as draft
            </button>
            <button className={button} onClick={() => setTemplate(undefined)}>
              Close template
            </button>
          </div>
        </section>
      )}
      {templateError && (
        <p role="alert" className="text-sm text-destructive">
          {templateError}
        </p>
      )}
      {!connected && (
        <p role="status" className="mb-3 text-sm">
          Computer offline. Save your edits when it reconnects.
        </p>
      )}
      {state.cacheError && (
        <p role="status" className="mb-3 text-sm">
          {state.cacheError}
        </p>
      )}
      {state.error && (
        <p role="alert" className="mb-3 text-sm text-destructive">
          {state.error}
        </p>
      )}
      {draft && draft.id === importedId && (
        <p className="mb-3 text-sm">
          Review the imported tiles and bind sources on this computer before you save.
        </p>
      )}
      {draft ? (
        <fieldset data-dashboard-editing disabled={state.pending} className="space-y-4">
          <label className="grid max-w-md gap-1 text-sm">
            Dashboard title
            <input
              className={field}
              maxLength={100}
              value={draft.title}
              onChange={(event) => state.edit({ ...draft, title: event.target.value })}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <select
              aria-label="Tile type"
              className={field}
              value={kind}
              onChange={(event) => {
                if (isTileKind(event.target.value)) setKind(event.target.value)
              }}
            >
              {availableKinds.map((type) => (
                <option key={type} value={type}>
                  {dashboardTileLabels[type]}
                </option>
              ))}
            </select>
            <button
              className={button}
              disabled={draft.tiles.length >= 32}
              onClick={() =>
                state.edit({ ...draft, tiles: [...draft.tiles, newDashboardTile(kind)] })
              }
            >
              Add tile
            </button>
          </div>
          <div className="grid gap-3 xl:grid-cols-2">
            {draft.tiles.map((tile, index) => (
              <TileEditor
                key={tile.id}
                extensionOptions={extensionOptions}
                tile={tile}
                change={(updated) =>
                  state.edit({
                    ...draft,
                    tiles: draft.tiles.map((entry) => (entry.id === tile.id ? updated : entry)),
                  })
                }
                move={(offset) =>
                  state.edit({ ...draft, tiles: moveDashboardTile(draft.tiles, index, offset) })
                }
                first={index === 0}
                last={index === draft.tiles.length - 1}
                remove={() =>
                  state.edit({
                    ...draft,
                    tiles: draft.tiles.filter((entry) => entry.id !== tile.id),
                  })
                }
              />
            ))}
          </div>
        </fieldset>
      ) : dashboard ? (
        <div className="grid grid-cols-4 gap-3">
          {dashboard.tiles.map((tile) => (
            <section
              key={`${dashboard.id}:${tile.id}:${dashboard.revision}`}
              className="col-span-4 flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card text-card-foreground md:[grid-column:span_var(--tile-span)]"
              style={tileLayout(tile, expandedTile === tile.id)}
            >
              <div className="flex items-center justify-between gap-2 border-b px-3 py-1.5">
                <h2 className="min-w-0 truncate text-sm font-medium">{tile.title}</h2>
                <button
                  type="button"
                  className={button}
                  aria-label={`${expandedTile === tile.id ? 'Collapse' : 'Expand'} ${tile.title}`}
                  aria-expanded={expandedTile === tile.id}
                  onClick={() => setExpandedTile((id) => (id === tile.id ? '' : tile.id))}
                >
                  {expandedTile === tile.id ? 'Collapse' : 'Expand'}
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <Suspense fallback={<p className="p-3 text-sm">Loading tile…</p>}>
                  <TileContent dashboard={dashboard} tile={tile} />
                </Suspense>
              </div>
            </section>
          ))}
          {dashboard.tiles.length === 0 && (
            <p className="col-span-4 text-sm text-muted-foreground">
              Edit this dashboard to add tiles.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Create a dashboard to add your first tile.</p>
      )}
    </>
  )
}

function TileEditor({
  tile,
  extensionOptions,
  change,
  move,
  first,
  last,
  remove,
}: {
  tile: DashboardTile
  extensionOptions: ReturnType<typeof extensionTileOptions>
  change: (value: DashboardTile) => void
  move: (offset: number) => void
  first: boolean
  last: boolean
  remove: () => void
}) {
  const { workspace, snapshot } = useWorkspace()
  return (
    <section className="grid gap-3 rounded-lg border bg-card p-3">
      <h2 className="font-medium">{dashboardTileLabels[tile.kind]}</h2>
      <label className="grid gap-1 text-sm">
        Tile title
        <input
          className={field}
          maxLength={100}
          value={tile.title}
          onChange={(event) => change({ ...tile, title: event.target.value })}
        />
      </label>
      {tile.kind === 'extension' && (
        <label className="grid gap-1 text-sm">
          Extension contribution
          <select
            className={field}
            value={`${tile.extensionId}/${tile.contributionId}`}
            onChange={(event) => {
              const option = extensionOptions.find((item) => item.id === event.target.value)
              if (option)
                change({
                  ...tile,
                  extensionId: option.extensionId,
                  contributionId: option.contributionId,
                })
            }}
          >
            <option value={`${tile.extensionId}/${tile.contributionId}`}>
              {tile.extensionId
                ? `${tile.extensionId}/${tile.contributionId}`
                : 'Choose an installed contribution'}
            </option>
            {extensionOptions
              .filter((option) => option.id !== `${tile.extensionId}/${tile.contributionId}`)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
          </select>
        </label>
      )}
      {tile.kind !== 'extension' &&
        dashboardTileFields(tile).map(([key, label, value]) => (
          <label key={key} className="grid gap-1 text-sm">
            {label}
            {key === 'repositoryId' || key === 'terminalId' || key === 'taskId' ? (
              <select
                className={field}
                value={value}
                onChange={(event) => change({ ...tile, [key]: event.target.value })}
              >
                <option value="">Select {label.toLowerCase()}</option>
                {(key === 'repositoryId'
                  ? workspace.repositories.map((item) => [item.id, item.name])
                  : key === 'taskId'
                    ? workspace.tasks.map((item) => [item.id, item.title])
                    : (snapshot?.terminals ?? []).map((item) => [
                        item.id,
                        item.customTitle ?? item.title,
                      ])
                ).map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            ) : key === 'command' || key === 'arguments' ? (
              <textarea
                className={field}
                value={value}
                onChange={(event) => change({ ...tile, [key]: event.target.value })}
              />
            ) : (
              <input
                className={field}
                value={value}
                onChange={(event) => change({ ...tile, [key]: event.target.value })}
              />
            )}
          </label>
        ))}
      {tile.kind === 'api' || tile.kind === 'mcp' ? (
        <label className="grid gap-1 text-sm">
          Display
          <select
            className={field}
            value={tile.chart}
            onChange={(event) => {
              const chart = event.target.value
              if (chart === 'table' || chart === 'line' || chart === 'number')
                change({ ...tile, chart })
            }}
          >
            <option value="table">Table</option>
            <option value="number">Metric</option>
            <option value="line">Line graph</option>
          </select>
        </label>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {(['span', 'height'] as const).map((key) => (
          <label key={key} className="flex items-center gap-1 text-sm">
            {key === 'span' ? 'Width' : 'Height'}
            <select
              className={field}
              value={tile[key]}
              onChange={(event) => change({ ...tile, [key]: Number(event.target.value) })}
            >
              {[1, 2, 3, 4].map((size) => (
                <option key={size}>{size}</option>
              ))}
            </select>
          </label>
        ))}
        <button className={button} disabled={first} onClick={() => move(-1)}>
          Move earlier
        </button>
        <button className={button} disabled={last} onClick={() => move(1)}>
          Move later
        </button>
        <button className={button} onClick={remove}>
          Remove tile
        </button>
      </div>
    </section>
  )
}

function TileContent({ dashboard, tile }: { dashboard: Dashboard; tile: DashboardTile }) {
  const { request, connected, snapshot, workspace, activeRuntimeId } = useWorkspace()
  const host = useStudioHost()
  const state = useDashboardTile(request, dashboard, tile, connected)
  const { data, terminalId, busy, error, pipelines } = state
  const [embedded, setEmbedded] = useState(false)
  const commandSession = snapshot?.terminals.find((entry) => entry.id === terminalId)
  const project =
    tile.kind === 'command' || tile.kind === 'tui'
      ? (workspace.repositories.find((entry) => entry.id === tile.repositoryId)?.name ??
        tile.repositoryId)
      : undefined

  if (tile.kind === 'extension')
    return <ExtensionTile id={tile.extensionId} contributionId={tile.contributionId} />
  if (tile.kind === 'app' && embedded)
    return (
      <div className="space-y-2 p-3">
        <button className={button} onClick={() => setEmbedded(false)}>
          Close app
        </button>
        <McpAppView reference={{ id: tile.appId, taskId: tile.taskId, title: tile.title }} />
      </div>
    )
  if (tile.kind === 'browser' && embedded)
    return (
      <BrowserPane
        taskId={STUDIO_BROWSER_SCOPE}
        paneScope={`dashboard:${dashboard.id}:${tile.id}`}
        openLink={{
          id: `${tile.id}:${dashboard.revision}`,
          url: tile.url,
          remote: true,
          runtimeId: activeRuntimeId,
        }}
        onClose={() => setEmbedded(false)}
      />
    )
  if (tile.kind === 'gui' && embedded)
    return (
      <div className="space-y-2 p-3">
        <button className={button} onClick={() => setEmbedded(false)}>
          Close viewer
        </button>
        <RemoteDesktopViewer />
      </div>
    )
  if (tile.kind === 'terminal') return <TerminalSession id={tile.terminalId} active inset />
  if (tile.kind === 'iframe')
    return embedded ? (
      <div className="flex h-full flex-col">
        <div className="px-3 py-1">
          <button className={button} onClick={() => setEmbedded(false)}>
            Close iframe
          </button>
        </div>
        <iframe
          title={tile.title}
          src={tile.url}
          className="min-h-0 w-full flex-1 border-0"
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
        />
      </div>
    ) : (
      <div className="p-3">
        <button className={button} onClick={() => setEmbedded(true)}>
          Load iframe
        </button>{' '}
        <span className="break-all text-xs">{tile.url}</span>
      </div>
    )

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-3 text-sm">
      {(tile.kind === 'api' || tile.kind === 'mcp') && (
        <>
          <p className="break-all text-xs text-muted-foreground">
            {tile.kind === 'api' ? tile.url : `${tile.server} · ${tile.tool}`}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={button}
              disabled={!connected || busy}
              onClick={() => void state.refresh()}
            >
              {busy ? 'Reading…' : 'Refresh data'}
            </button>
            {data && (
              <time
                className="text-xs text-muted-foreground"
                dateTime={new Date(data.updatedAt).toISOString()}
              >
                Updated {new Date(data.updatedAt).toLocaleTimeString()}
              </time>
            )}
            {!connected && <span>Computer offline</span>}
          </div>
          {data && <DataView value={data.data} chart={tile.chart} />}
        </>
      )}
      {(tile.kind === 'command' || tile.kind === 'tui') && (
        <>
          <p className="text-xs text-muted-foreground">{project}</p>
          <code className="whitespace-pre-wrap break-all">{tile.command}</code>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className={button}
              disabled={
                !connected ||
                busy ||
                state.sessionLoading ||
                (!!terminalId && commandSession?.exited !== true)
              }
              onClick={() => {
                if (
                  state.recovering ||
                  window.confirm(
                    `Run this command in ${project} on the selected computer?\n\n${tile.command}`,
                  )
                )
                  void state.run()
              }}
            >
              {busy ? 'Working…' : state.recovering ? 'Recover run' : 'Run command'}
            </button>
            {terminalId && (
              <button
                className={button}
                disabled={!connected || busy}
                onClick={() => void state.close()}
              >
                Close session
              </button>
            )}
            {commandSession?.exited && (
              <span>
                Exited
                {commandSession.exitCode === undefined
                  ? ''
                  : ` with code ${commandSession.exitCode}`}
              </span>
            )}
          </div>
          {terminalId && (
            <div className="min-h-28 flex-1 overflow-hidden">
              <TerminalSession id={terminalId} active readOnly={tile.kind === 'command'} inset />
            </div>
          )}
        </>
      )}
      {tile.kind === 'browser' && (
        <>
          <span className="break-all">{tile.url}</span>
          <button className={button} disabled={!connected} onClick={() => setEmbedded(true)}>
            Open browser tile
          </button>
        </>
      )}
      {tile.kind === 'gui' && (
        <>
          <button
            className={button}
            disabled={!connected || !snapshot?.remoteDesktopEnabled}
            onClick={() => setEmbedded(true)}
          >
            Open remote desktop
          </button>
          {!snapshot?.remoteDesktopEnabled && (
            <p>Enable Remote desktop on this computer to use this tile.</p>
          )}
        </>
      )}
      {tile.kind === 'app' && (
        <button className={button} disabled={!connected} onClick={() => setEmbedded(true)}>
          Open MCP App
        </button>
      )}
      {tile.kind === 'pipelines' && (
        <>
          <button
            className={button}
            disabled={!connected || busy}
            onClick={() => void state.refreshPipelines()}
          >
            Refresh pipelines
          </button>
          {pipelines?.refreshError && <p role="status">{pipelines.refreshError}</p>}
          {pipelines?.items.slice(0, 8).map((run) => (
            <button
              key={run.id}
              className={button}
              onClick={() => {
                if (activeRuntimeId)
                  host.navigate({
                    viewId: 'pipelines',
                    entityId: encodeWorkTarget({
                      runtimeId: activeRuntimeId,
                      repositoryId: tile.repositoryId,
                      id: run.id,
                      url: run.url,
                    }),
                  })
              }}
            >
              {run.title} · {run.status}
            </button>
          ))}
          {pipelines?.items.length === 0 && <p>No pipelines found.</p>}
        </>
      )}
      {tile.kind === 'jobs' && (
        <>
          <button className={button} onClick={() => host.navigate({ viewId: 'jobs' })}>
            Open automations
          </button>
          {workspace.automations.slice(0, 8).map((entry) => (
            <button
              key={entry.id}
              className={button}
              onClick={() => {
                if (activeRuntimeId)
                  host.navigate({
                    viewId: 'jobs',
                    automationTarget: { runtimeId: activeRuntimeId, automationId: entry.id },
                  })
              }}
            >
              {entry.name}
            </button>
          ))}
        </>
      )}
      {tile.kind === 'threads' && (
        <>
          <button className={button} onClick={() => host.navigate({ viewId: 'tasks' })}>
            Open threads
          </button>
          {workspace.tasks.slice(0, 8).map((entry) => (
            <button
              key={entry.id}
              className={button}
              onClick={() =>
                host.openThread?.({
                  runtimeId: activeRuntimeId,
                  threadId: entry.id,
                  title: entry.title,
                })
              }
            >
              {entry.title}
            </button>
          ))}
        </>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
