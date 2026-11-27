import {
  Activity,
  AppWindow,
  ChartNoAxesCombined,
  Clock3,
  Code2,
  Globe,
  GripVertical,
  LayoutGrid,
  MessageSquare,
  type LucideIcon,
  Monitor,
  PanelsTopLeft,
  Plug,
  Puzzle,
  Terminal,
} from 'lucide-react'
import { useState, type CSSProperties, type ReactNode } from 'react'
import type { DashboardTile } from '@dovo/protocol'
import { dashboardTileLabels, moveDashboardTile } from '@dovo/studio-core'
import { cn } from '@dovo/studio-ui'

export const tileIcons = {
  api: ChartNoAxesCombined,
  cli: Code2,
  mcp: Plug,
  command: Terminal,
  tui: Terminal,
  terminal: Terminal,
  iframe: PanelsTopLeft,
  browser: Globe,
  gui: Monitor,
  app: AppWindow,
  extension: Puzzle,
  pipelines: Activity,
  threads: MessageSquare,
  jobs: Clock3,
} satisfies Record<DashboardTile['kind'], LucideIcon>

export const grid =
  'grid grid-cols-1 auto-rows-[148px] gap-3 @min-[30rem]:grid-cols-2 @min-[44rem]:grid-cols-4'
export const tileCell =
  'col-span-1 [grid-row:span_var(--tile-height)] @min-[30rem]:[grid-column:span_var(--tile-half-span)] @min-[44rem]:[grid-column:span_var(--tile-span)]'

type TileStyle = CSSProperties & {
  '--tile-span': number
  '--tile-half-span': number
  '--tile-height': number
}

export function tileLayout(tile: DashboardTile, expanded = false): TileStyle {
  return {
    '--tile-span': expanded ? 4 : tile.span,
    '--tile-half-span': expanded ? 2 : Math.ceil(tile.span / 2),
    '--tile-height': expanded ? 4 : tile.height,
  }
}

export function LayoutEditor({
  tiles,
  selected,
  select,
  reorder,
  addTile,
  settings,
}: {
  tiles: DashboardTile[]
  selected: string | undefined
  select: (id: string) => void
  reorder: (tiles: DashboardTile[]) => void
  addTile: ReactNode
  settings: ReactNode
}) {
  const [dragged, setDragged] = useState('')
  const [hovered, setHovered] = useState('')
  const clearDrag = () => {
    setDragged('')
    setHovered('')
  }
  return (
    <div className="grid items-start gap-4 @min-[64rem]:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="@container min-w-0 overflow-hidden rounded-2xl border bg-muted/25">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-card px-4 py-3">
          <div className="flex items-center gap-2">
            <LayoutGrid size={16} aria-hidden="true" />
            <h2 className="text-sm font-medium">Layout</h2>
          </div>
          {addTile}
        </div>
        <div className="p-3">
          {tiles.length ? (
            <div aria-label="Dashboard layout" role="group" className={grid}>
              {tiles.map((tile, index) => {
                const Icon = tileIcons[tile.kind]
                const current = selected === tile.id
                const title = tile.title || dashboardTileLabels[tile.kind]
                return (
                  <div
                    key={tile.id}
                    data-layout-tile
                    style={tileLayout(tile)}
                    className={cn(
                      tileCell,
                      'relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card transition-colors',
                      current && 'border-primary ring-1 ring-primary',
                      dragged === tile.id && 'opacity-55',
                      hovered === tile.id && 'border-primary bg-accent',
                    )}
                    onDragOver={(event) => {
                      if (!dragged || dragged === tile.id) return
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                      setHovered(tile.id)
                    }}
                    onDragLeave={(event) => {
                      if (
                        event.relatedTarget instanceof Node &&
                        event.currentTarget.contains(event.relatedTarget)
                      )
                        return
                      setHovered((id) => (id === tile.id ? '' : id))
                    }}
                    onDrop={(event) => {
                      if (!dragged) return
                      event.preventDefault()
                      const from = tiles.findIndex(({ id }) => id === dragged)
                      if (from >= 0 && from !== index)
                        reorder(moveDashboardTile(tiles, from, index - from))
                      clearDrag()
                    }}
                  >
                    <button
                      type="button"
                      aria-pressed={current}
                      aria-label={title}
                      className="flex min-h-0 flex-1 flex-col items-start gap-2 rounded-xl p-3 pr-10 text-left hover:bg-muted/35 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                      onClick={() => select(tile.id)}
                    >
                      <Icon className="size-5 shrink-0 text-primary" aria-hidden="true" />
                      <span className="w-full break-words text-sm font-medium leading-snug [overflow-wrap:anywhere]">
                        {title}
                      </span>
                      {tile.title && tile.title !== dashboardTileLabels[tile.kind] && (
                        <span className="text-xs text-muted-foreground">
                          {dashboardTileLabels[tile.kind]}
                        </span>
                      )}
                      <span className="mt-auto whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                        {tile.span} × {tile.height}
                      </span>
                    </button>
                    {tiles.length > 1 && (
                      <span
                        aria-hidden="true"
                        title="Drag to reorder"
                        draggable
                        className="absolute right-2 top-2 cursor-grab rounded-md p-1.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData('text/plain', tile.id)
                          setDragged(tile.id)
                        }}
                        onDragEnd={clearDrag}
                      >
                        <GripVertical size={16} />
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="grid min-h-36 place-items-center rounded-xl border border-dashed px-4 text-center text-sm text-muted-foreground">
              Add a tile to start arranging this dashboard.
            </p>
          )}
        </div>
      </div>
      {settings}
    </div>
  )
}
