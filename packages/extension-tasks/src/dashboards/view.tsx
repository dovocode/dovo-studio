import { Button, DropdownMenu } from '@dovo/studio-ui'
import {
  LayoutGrid,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Pencil,
  Server,
  Plus,
} from 'lucide-react'
import { DataSource } from './data-source'
import { LayoutEditor, grid, tileCell, tileIcons, tileLayout } from './layout'
import { lazy, Suspense, useId, useRef, useState } from 'react'
import {
  STUDIO_BROWSER_SCOPE,
  runtimeComputerName,
  isStudioDataSource,
  needsStudioDataSources,
  studioDataPanelLimit,
  type StudioDataPanel,
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
  dashboardProjectOptions,
  dashboardDisplayLabels,
  isDashboardDisplay,
  readDashboardDataSource,
  dashboardTileLabels,
  dashboardTileGroups,
  moveDashboardTile,
  newDashboardTile,
  useDashboardTile,
  useDashboards,
  useMarketplaceSources,
  useSettingsDraft,
  useConfirmSettingsNavigation,
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

const menu =
  'z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-44 overflow-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg'
const menuItem =
  'cursor-pointer rounded-md px-2.5 py-1.5 text-sm outline-none focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50'
const button = 'rounded-md border px-2.5 py-1.5 text-sm hover:bg-muted disabled:opacity-50'
const field = 'min-w-0 rounded-md border bg-background px-2 py-1.5 text-sm'
export default function DashboardsView() {
  const { runtimes, activeRuntimeId } = useWorkspace()
  const [owner, setOwner] = useState(activeRuntimeId ?? '')
  const computers = runtimes.filter((entry) => entry.snapshot?.dashboardsSupported)
  const selected =
    computers.find((entry) => entry.profile.id === owner) ??
    computers.find((entry) => entry.profile.id === activeRuntimeId) ??
    computers[0]
  return (
    <main className="@container h-full overflow-auto bg-muted/15 p-4 md:p-6">
      <header className="mb-4 flex items-center gap-2.5">
        <LayoutGrid className="size-5 text-primary" aria-hidden="true" />
        <h1 className="text-xl font-semibold tracking-tight">Dashboards</h1>
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
  const dataSources = snapshot?.studioDataSourcesSupported === true
  const state = useDashboards(
    request,
    connected,
    readCache,
    true,
    dataSources,
    snapshot?.dashboardSaveReceiptsSupported === true,
  )
  const { dashboard, draft } = state
  useSettingsDraft(state.dirty, !!draft && state.pending)
  const confirmNavigation = useConfirmSettingsNavigation()
  const supported = snapshot?.studioExtensionsSupported === true
  const extensions = useStudioExtensions(
    request,
    connected && supported && (draft?.tiles.some((tile) => tile.kind === 'extension') ?? false),
    null,
    snapshot?.studioExtensionsRevision,
    extensionComponentVersion(snapshot),
  )
  const extensionOptions = extensionTileOptions(extensions.entries)
  const tileGroups = dashboardTileGroups.map(({ label, kinds }) => ({
    label,
    kinds: kinds.filter(
      (kind) => (kind !== 'extension' || supported) && (kind !== 'cli' || dataSources),
    ),
  }))
  const needsUpdate = !!draft && !dataSources && needsStudioDataSources(draft)

  const [editingTile, setEditingTile] = useState<string>()
  const [template, setTemplate] = useState<string>()
  const [templateError, setTemplateError] = useState('')
  const [importedId, setImportedId] = useState('')
  const [expandedTile, setExpandedTile] = useState('')
  const [readingFile, setReadingFile] = useState(false)
  const picker = useRef<HTMLInputElement>(null)
  const inspector = useRef<HTMLElement>(null)
  const selectedIndex = draft?.tiles.findIndex((tile) => tile.id === editingTile) ?? -1
  const selectedTile = draft?.tiles[selectedIndex]

  function selectTile(id: string) {
    setEditingTile(id)
    requestAnimationFrame(() => {
      const panel = inspector.current
      const layout = panel?.parentElement?.firstElementChild
      if (
        !panel ||
        !layout ||
        panel.getBoundingClientRect().top <= layout.getBoundingClientRect().top + 1
      )
        return
      panel.scrollIntoView({ block: 'nearest' })
    })
  }

  function editBoard() {
    if (!dashboard) return
    setEditingTile(dashboard.tiles[0]?.id)
    state.beginEdit(dashboard)
  }

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
    state.beginEdit(imported)
    setEditingTile(imported.tiles[0]?.id)
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
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-2xl border bg-card p-3 sm:p-4">
        {!draft ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {computers.length === 1 && (
              <span className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/35 px-2.5 py-1.5 text-xs text-muted-foreground">
                <Server className="size-3.5 shrink-0" aria-hidden="true" /> {computers[0].name}
              </span>
            )}
            {computers.length > 1 && (
              <select
                aria-label="Computer"
                className={field}
                disabled={state.pending || readingFile}
                value={owner}
                onChange={(event) => setOwner(event.target.value)}
              >
                {computers.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}
                  </option>
                ))}
              </select>
            )}
            {state.dashboards.length > 0 && (
              <select
                aria-label="Dashboard"
                className={`${field} max-w-full font-medium`}
                disabled={state.pending || readingFile}
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
          </div>
        ) : (
          <label className="grid max-w-md grow gap-1 text-xs text-muted-foreground">
            Dashboard title
            <input
              className={`${field} text-base font-medium text-foreground`}
              maxLength={100}
              value={draft.title}
              disabled={state.pending}
              onChange={(event) => state.edit({ ...draft, title: event.target.value })}
            />
          </label>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {draft ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={state.pending}
                onClick={async () => {
                  if (await confirmNavigation()) state.edit(undefined)
                }}
              >
                Cancel edits
              </Button>
              {draft.revision > 0 && state.error && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={state.pending}
                  onClick={state.copyDraft}
                >
                  Keep as new dashboard
                </Button>
              )}
              <Button
                size="sm"
                disabled={!connected || state.pending || needsUpdate}
                onClick={() => void state.save()}
              >
                Save dashboard
              </Button>
            </>
          ) : (
            <>
              <Button
                size="sm"
                variant={dashboard ? 'outline' : 'default'}
                disabled={state.pending || readingFile}
                onClick={() => {
                  setEditingTile(undefined)
                  state.create()
                }}
              >
                <Plus size={16} /> New dashboard
              </Button>
              {dashboard && (
                <Button size="sm" disabled={state.pending || readingFile} onClick={editBoard}>
                  <Pencil size={15} /> Edit dashboard
                </Button>
              )}
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Dashboard actions"
                    disabled={state.pending || readingFile}
                  >
                    <MoreHorizontal size={18} />
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className={menu} align="end" sideOffset={6}>
                    <DropdownMenu.Item
                      className={menuItem}
                      onSelect={() => picker.current?.click()}
                    >
                      Import dashboard
                    </DropdownMenu.Item>
                    <DropdownMenu.Item
                      className={menuItem}
                      onSelect={() => {
                        setTemplate('')
                        setTemplateError('')
                      }}
                    >
                      Paste template
                    </DropdownMenu.Item>
                    {dashboard && (
                      <>
                        <DropdownMenu.Item
                          className={menuItem}
                          onSelect={() => exportFile(dashboard)}
                        >
                          Export dashboard
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          className={menuItem}
                          onSelect={() => {
                            setTemplate(dashboardTemplate(dashboard))
                            setTemplateError('')
                          }}
                        >
                          View template
                        </DropdownMenu.Item>
                      </>
                    )}
                    <DropdownMenu.Item
                      className={menuItem}
                      disabled={!connected}
                      onSelect={() => void state.load()}
                    >
                      Reload
                    </DropdownMenu.Item>
                    {dashboard && (
                      <>
                        <DropdownMenu.Separator className="my-1 h-px bg-border" />
                        <DropdownMenu.Item
                          className={`${menuItem} text-destructive`}
                          disabled={!connected}
                          onSelect={() => {
                            if (window.confirm(`Delete "${dashboard.title}"?`)) void state.remove()
                          }}
                        >
                          Delete dashboard
                        </DropdownMenu.Item>
                      </>
                    )}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </>
          )}
        </div>
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
      {needsUpdate && (
        <p role="alert" className="mb-3 text-sm">
          Update the paired computer to use these data displays.
        </p>
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
        <fieldset data-dashboard-editing disabled={state.pending} className="min-w-0">
          <LayoutEditor
            tiles={draft.tiles}
            selected={editingTile}
            select={selectTile}
            reorder={(tiles) => state.edit({ ...draft, tiles })}
            addTile={
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    disabled={state.pending || draft.tiles.length >= 32}
                  >
                    <Plus size={16} /> Add tile
                  </Button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className={menu} align="end" sideOffset={6}>
                    {tileGroups.map(({ label, kinds }) => (
                      <DropdownMenu.Group key={label}>
                        <DropdownMenu.Label className="px-2.5 pb-1 pt-2 text-xs font-semibold text-muted-foreground">
                          {label}
                        </DropdownMenu.Label>
                        {kinds.map((kind) => {
                          const Icon = tileIcons[kind]
                          return (
                            <DropdownMenu.Item
                              key={kind}
                              className={`${menuItem} flex items-center gap-2`}
                              onSelect={() => {
                                const tile = newDashboardTile(kind)
                                state.edit({ ...draft, tiles: [...draft.tiles, tile] })
                                selectTile(tile.id)
                              }}
                            >
                              <Icon
                                size={16}
                                className="text-muted-foreground"
                                aria-hidden="true"
                              />
                              {dashboardTileLabels[kind]}
                            </DropdownMenu.Item>
                          )
                        })}
                      </DropdownMenu.Group>
                    ))}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            }
            settings={
              selectedTile && (
                <aside
                  ref={inspector}
                  aria-label="Tile settings"
                  className="min-w-0 rounded-2xl border bg-card @min-[64rem]:sticky @min-[64rem]:top-0 @min-[64rem]:max-h-[calc(100dvh-8rem)] @min-[64rem]:overflow-auto"
                >
                  <div className="border-b px-4 py-3">
                    <h2 className="text-sm font-medium">Tile settings</h2>
                    <p className="text-xs text-muted-foreground">
                      {dashboardTileLabels[selectedTile.kind]}
                    </p>
                  </div>
                  <TileEditor
                    key={selectedTile.id}
                    extensionOptions={extensionOptions}
                    tile={selectedTile}
                    change={(tile) =>
                      state.edit({
                        ...draft,
                        tiles: draft.tiles.map((entry) => (entry.id === tile.id ? tile : entry)),
                      })
                    }
                    move={(offset) =>
                      state.edit({
                        ...draft,
                        tiles: moveDashboardTile(draft.tiles, selectedIndex, offset),
                      })
                    }
                    first={selectedIndex === 0}
                    last={selectedIndex === draft.tiles.length - 1}
                    remove={() => {
                      const remaining = draft.tiles.filter((entry) => entry.id !== selectedTile.id)
                      state.edit({ ...draft, tiles: remaining })
                      setEditingTile(remaining[Math.min(selectedIndex, remaining.length - 1)]?.id)
                    }}
                  />
                </aside>
              )
            }
          />
        </fieldset>
      ) : dashboard?.tiles.length ? (
        <div className={grid} aria-label={dashboard.title} role="group">
          {dashboard.tiles.map((tile) => (
            <BoardTile
              key={`${dashboard.id}:${tile.id}:${dashboard.revision}`}
              dashboard={dashboard}
              tile={tile}
              expanded={expandedTile === tile.id}
              toggle={() => setExpandedTile((id) => (id === tile.id ? '' : tile.id))}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-56 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-card px-4 text-center">
          <span className="rounded-xl bg-primary/10 p-3 text-primary">
            <LayoutGrid size={24} aria-hidden="true" />
          </span>
          <p className="text-sm text-muted-foreground">
            {dashboard
              ? 'This dashboard has no tiles yet.'
              : 'Create a dashboard to add your first tile.'}
          </p>
          {dashboard && (
            <Button size="sm" onClick={editBoard}>
              <Plus size={16} /> Add tiles
            </Button>
          )}
        </div>
      )}
    </>
  )
}

function BoardTile({
  dashboard,
  tile,
  expanded,
  toggle,
}: {
  dashboard: Dashboard
  tile: DashboardTile
  expanded: boolean
  toggle: () => void
}) {
  const id = useId()
  const Icon = tileIcons[tile.kind]
  return (
    <section
      aria-labelledby={id}
      className={`${tileCell} flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm`}
      style={tileLayout(tile, expanded)}
    >
      <div className="flex items-center gap-2.5 border-b bg-muted/25 px-3 py-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Icon size={16} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={id} className="truncate text-sm font-medium" title={tile.title}>
            {tile.title}
          </h2>
          {tile.title !== dashboardTileLabels[tile.kind] && (
            <p className="truncate text-xs text-muted-foreground">
              {dashboardTileLabels[tile.kind]}
            </p>
          )}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${tile.title}`}
          aria-expanded={expanded}
          onClick={toggle}
        >
          {expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <Suspense fallback={<p className="p-3 text-sm">Loading tile…</p>}>
          <TileContent dashboard={dashboard} tile={tile} />
        </Suspense>
      </div>
    </section>
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
  const { workspace, snapshot, request, connected } = useWorkspace()
  const appSources = useMarketplaceSources(
    request,
    tile.kind === 'app' ? tile.taskId : undefined,
    connected && snapshot?.studioExtensionMarketplaceSupported === true,
  )
  const apps = appSources?.data?.apps ?? []
  return (
    <div className="grid min-w-0 gap-3 p-3">
      <label className="grid gap-1 text-sm">
        Tile title
        <input
          className={field}
          maxLength={100}
          value={tile.title}
          onChange={(event) => change({ ...tile, title: event.target.value })}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 border-b pb-3">
        {(['span', 'height'] as const).map((key) => (
          <label key={key} className="flex items-center gap-1 text-sm">
            {key === 'span' ? 'Width' : 'Height'}
            <select
              className={field}
              value={tile[key]}
              onChange={(event) => change({ ...tile, [key]: Number(event.target.value) })}
            >
              {[1, 2, 3, 4].map((size) => (
                <option key={size} value={size}>
                  {size}{' '}
                  {key === 'span'
                    ? size === 1
                      ? 'column'
                      : 'columns'
                    : size === 1
                      ? 'row'
                      : 'rows'}
                </option>
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
                aria-label={label}
                value={value}
                onChange={(event) => {
                  const value = event.target.value
                  change(
                    tile.kind === 'app' && key === 'taskId'
                      ? { ...tile, taskId: value, appId: '' }
                      : { ...tile, [key]: value },
                  )
                }}
              >
                <option value="">
                  {key === 'repositoryId' && tile.kind === 'tui'
                    ? 'Choose a folder'
                    : `Select ${label.toLowerCase()}`}
                </option>
                {(key === 'repositoryId'
                  ? dashboardProjectOptions(tile.kind, workspace.repositories).map((item) => [
                      item.id,
                      item.name,
                    ])
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
      {tile.kind === 'app' && (
        <div className="grid gap-2 text-sm">
          {!!apps.length && (
            <label className="grid gap-1">
              Saved app or A2UI card
              <select
                className={field}
                value={tile.appId}
                onChange={(event) => change({ ...tile, appId: event.target.value })}
              >
                <option value="">Choose a saved app</option>
                {tile.appId && !apps.some(({ id }) => id === tile.appId) && (
                  <option value={tile.appId}>{tile.appId}</option>
                )}
                {apps.map(({ id, title }) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <details open={apps.length ? undefined : true}>
            <summary className="cursor-pointer">Enter app ID</summary>
            <label className="grid gap-1">
              MCP App ID
              <input
                className={field}
                value={tile.appId}
                onChange={(event) => change({ ...tile, appId: event.target.value })}
              />
            </label>
          </details>
        </div>
      )}
      {isStudioDataSource(tile) && snapshot?.studioDataSourcesSupported && (
        <label className="grid gap-1 text-sm">
          Refresh interval in seconds
          <input
            className={field}
            type="number"
            min={30}
            max={86400}
            placeholder="Manual refresh"
            value={tile.refreshSeconds ?? ''}
            onChange={(event) => {
              const { refreshSeconds: _, ...manual } = tile
              const value = event.currentTarget.valueAsNumber
              change(Number.isFinite(value) ? { ...manual, refreshSeconds: value } : manual)
            }}
          />
        </label>
      )}
      {(isStudioDataSource(tile) || tile.kind === 'mcp') && (
        <DisplayEditor
          tile={tile}
          change={change}
          compound={snapshot?.studioDataSourcesSupported === true}
        />
      )}
    </div>
  )
}

function DisplayEditor({
  tile,
  change,
  compound,
}: {
  tile: Extract<DashboardTile, { kind: 'api' | 'cli' | 'mcp' }>
  change: (tile: DashboardTile) => void
  compound: boolean
}) {
  const panels = tile.panels ?? []
  const changePanels = (next: StudioDataPanel[]) => {
    const { panels: _, ...single } = tile
    change(next.length ? { ...single, panels: next } : single)
  }
  const display = (
    chart: StudioDataPanel['chart'],
    onChange: (chart: StudioDataPanel['chart']) => void,
  ) => (
    <label className="grid gap-1 text-sm">
      Display
      <select
        className={field}
        value={chart}
        onChange={(event) => {
          const value = event.currentTarget.value
          if (isDashboardDisplay(value)) onChange(value)
        }}
      >
        {Object.entries(dashboardDisplayLabels).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  )
  return (
    <div className="grid gap-2 ">
      {panels.length === 0 && (
        <div className="max-w-xs">{display(tile.chart, (chart) => change({ ...tile, chart }))}</div>
      )}
      {panels.map((panel, index) => {
        const update = (patch: Partial<StudioDataPanel>) =>
          changePanels(
            panels.map((item, position) => (position === index ? { ...item, ...patch } : item)),
          )
        return (
          <div key={index} className="grid gap-2 rounded-lg border bg-muted/20 p-2">
            <label className="grid gap-1 text-sm">
              Display title
              <input
                className={field}
                value={panel.title}
                maxLength={100}
                onChange={(event) => update({ title: event.currentTarget.value })}
              />
            </label>
            <label className="grid gap-1 text-sm">
              JSON pointer
              <input
                className={field}
                value={panel.pointer}
                onChange={(event) => update({ pointer: event.currentTarget.value })}
              />
            </label>
            {display(panel.chart, (chart) => update({ chart }))}
            <Button
              className="justify-self-start"
              variant="ghost"
              size="sm"
              onClick={() => changePanels(panels.filter((_, position) => position !== index))}
            >
              Remove display
            </Button>
          </div>
        )
      })}
      {compound && (
        <Button
          className="justify-self-start"
          variant="outline"
          size="sm"
          disabled={panels.length >= studioDataPanelLimit}
          onClick={() => {
            const chart = panels.length ? 'number' : tile.chart
            changePanels([...panels, { title: dashboardDisplayLabels[chart], chart, pointer: '' }])
          }}
        >
          <Plus size={16} /> Add display
        </Button>
      )}
    </div>
  )
}

function TileContent({ dashboard, tile }: { dashboard: Dashboard; tile: DashboardTile }) {
  const { request, connected, snapshot, workspace, activeRuntimeId, runtimes } = useWorkspace()
  const host = useStudioHost()
  const state = useDashboardTile(request, dashboard, tile, connected)
  const { terminalId, busy, error, pipelines } = state
  const [embedded, setEmbedded] = useState(false)
  const commandSession = snapshot?.terminals.find((entry) => entry.id === terminalId)
  const project =
    tile.kind === 'command' || tile.kind === 'tui'
      ? (dashboardProjectOptions(tile.kind, workspace.repositories).find(
          (entry) => entry.id === tile.repositoryId,
        )?.name ?? tile.repositoryId)
      : undefined
  const computer = runtimeComputerName({
    profile: runtimes.find((item) => item.profile.id === activeRuntimeId)?.profile,
    snapshot,
  })

  if (isStudioDataSource(tile) || tile.kind === 'mcp')
    return (
      <div className="p-3">
        <DataSource
          owner={['dashboard', dashboard.id]}
          revision={dashboard.revision}
          source={tile}
          read={(automatic) => readDashboardDataSource(request, dashboard, tile, automatic)}
        />
      </div>
    )
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
      {(tile.kind === 'command' || tile.kind === 'tui') && (
        <>
          <p className="text-xs text-muted-foreground">
            {tile.kind === 'tui' ? `${project} · ${computer}` : project}
          </p>
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
                    tile.kind === 'tui'
                      ? `Start this TUI in ${project} on ${computer}?\n\n${tile.command}`
                      : `Run this command in ${project} on the selected computer?\n\n${tile.command}`,
                  )
                )
                  void state.run()
              }}
            >
              {busy
                ? 'Working…'
                : state.recovering
                  ? 'Recover run'
                  : tile.kind === 'tui'
                    ? 'Start TUI'
                    : 'Run command'}
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
