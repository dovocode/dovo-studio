import type { StudioDataPanel } from '@dovo/protocol'
import { dashboardDataRows, dashboardLinePlot, dashboardPanelValue } from '@dovo/studio-core'

export function DataView({
  value,
  chart,
  panels,
  compact,
}: {
  value: unknown
  chart: StudioDataPanel['chart']
  panels?: readonly StudioDataPanel[]
  compact?: boolean
}) {
  if (panels) return <DataGrid value={value} panels={panels} />
  if (chart === 'number')
    return (
      <output className="text-3xl font-semibold tracking-tight tabular-nums">
        {typeof value === 'number' ? value : 'Select a numeric field'}
      </output>
    )
  if (chart === 'line') {
    const plot = dashboardLinePlot(value)
    if (!plot)
      return <p>Select an array with at least two numbers or objects with a numeric value.</p>
    const { min, max, latest, points } = plot
    return (
      <figure className="text-xs text-muted-foreground">
        <svg
          role="img"
          aria-label={`Line graph, range ${min} to ${max}`}
          viewBox="0 0 320 120"
          className={`w-full text-primary ${compact ? 'h-[72px]' : 'h-32'}`}
          preserveAspectRatio="none"
        >
          <path
            d="M5 115H315 M5 60H315 M5 5H315"
            fill="none"
            className="stroke-border"
            vectorEffect="non-scaling-stroke"
          />
          <polygon points={`5,115 ${points} 315,115`} fill="currentColor" opacity={0.08} />
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <figcaption>
          Latest {latest} · Range {min} to {max}
        </figcaption>
      </figure>
    )
  }
  const { columns, rows } = dashboardDataRows(value)
  return (
    <div className="overflow-auto">
      <table className="w-full text-left text-xs">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} className="border-b px-2 py-1.5 text-muted-foreground">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="odd:bg-muted/35">
              {row.map((cell, position) => (
                <td key={columns[position]} className="max-w-64 break-words border-b px-2 py-1.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function DataGrid({
  value,
  panels,
}: {
  value: unknown
  panels: readonly StudioDataPanel[]
}) {
  if (value === undefined)
    return <p className="text-sm text-muted-foreground">Refresh data to see these displays.</p>
  return (
    <div
      className="grid items-start gap-3"
      style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 12rem), 1fr))' }}
    >
      {panels.map((panel, index) => {
        const selected = dashboardPanelValue(value, panel.pointer)
        return (
          <section
            key={index}
            aria-label={panel.title}
            className="min-w-0 space-y-2 rounded-xl border bg-muted/25 p-3"
          >
            <h3 className="break-words text-xs font-medium text-muted-foreground">{panel.title}</h3>
            {selected === undefined ? (
              <p className="text-sm text-muted-foreground">Field unavailable</p>
            ) : (
              <DataView value={selected} chart={panel.chart} compact />
            )}
          </section>
        )
      })}
    </div>
  )
}
