import { dashboardDataRows, dashboardLinePlot } from '@dovo/studio-core'

export function DataView({ value, chart }: { value: unknown; chart: 'line' | 'table' | 'number' }) {
  if (chart === 'number')
    return (
      <output className="text-2xl tabular-nums">
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
          className="h-32 w-full text-primary"
          preserveAspectRatio="none"
        >
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
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
              <th key={column} className="border-b p-1">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, position) => (
                <td key={columns[position]} className="max-w-64 break-words border-b p-1">
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
