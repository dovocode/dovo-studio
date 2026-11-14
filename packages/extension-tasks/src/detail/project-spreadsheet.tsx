import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useEffect, useState } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import { spreadsheetPreviewSchema, type SpreadsheetPreview } from '@dovo/protocol'
import { Button } from '@dovo/studio-ui'

export function ProjectSpreadsheet({
  taskId,
  checkoutId,
  path,
  revision,
}: {
  taskId: string
  checkoutId?: string
  path: string
  revision: number
}) {
  const uiText = useInterfaceText()

  const { request, activeRuntimeId, connection } = useWorkspace()
  const [sheet, setSheet] = useState('')
  const [retry, setRetry] = useState(0)
  const identity = JSON.stringify([
    activeRuntimeId,
    connection?.address,
    connection?.token,
    taskId,
    checkoutId,
    path,
    sheet,
    revision,
    retry,
  ])
  const [result, setResult] = useState<{
    identity: string
    value?: SpreadsheetPreview
    error?: string
  }>()
  const [widths, setWidths] = useState<Record<number, number>>({})
  const [heights, setHeights] = useState<Record<number, number>>({})
  const current = result?.identity === identity ? result : undefined
  useEffect(() => {
    let active = true
    void request(
      '/api/tasks/files/spreadsheet',
      { id: taskId, checkoutId, path, sheet: sheet || undefined },
      spreadsheetPreviewSchema,
    ).then(
      (value) => {
        if (active) setResult({ identity, value })
      },
      (error: unknown) => {
        if (active)
          setResult({ identity, error: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      active = false
    }
  }, [request, identity, taskId, checkoutId, path, sheet])
  const resize = (
    event: React.PointerEvent<HTMLButtonElement>,
    index: number,
    axis: 'column' | 'row',
  ) => {
    event.preventDefault()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const start = axis === 'column' ? event.clientX : event.clientY
    const size = axis === 'column' ? (widths[index] ?? 160) : (heights[index] ?? 36)
    const move = (move: PointerEvent) => {
      const next = Math.round(
        Math.max(
          axis === 'column' ? 64 : 28,
          Math.min(600, size + (axis === 'column' ? move.clientX : move.clientY) - start),
        ),
      )
      if (axis === 'column') setWidths((value) => ({ ...value, [index]: next }))
      else setHeights((value) => ({ ...value, [index]: next }))
    }
    const end = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('lostpointercapture', end)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('lostpointercapture', end)
  }
  const preview = current?.value
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Spreadsheet preview">
      <div className="flex flex-wrap items-center gap-3 border-b p-3 text-xs">
        <span>Read-only spreadsheet</span>
        {preview && (
          <label>
            Sheet{' '}
            <select
              aria-label="Worksheet"
              className="rounded border bg-background px-2 py-1"
              value={preview.sheet}
              onChange={(event) => {
                setSheet(event.target.value)
                setWidths({})
                setHeights({})
              }}
            >
              {preview.sheets.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setWidths({})
            setHeights({})
          }}
        >
          Reset sizes
        </Button>
        <span className="text-muted-foreground">
          Drag row or column edges, or use arrow keys on a resize control.
        </span>
      </div>
      {!current && (
        <p className="p-4 text-sm" role="status">
          Loading spreadsheet…
        </p>
      )}
      {current?.error && (
        <div role="alert" className="p-4 text-sm">
          <p>{current.error}</p>
          <Button onClick={() => setRetry((value) => value + 1)}>{uiText('Retry')}</Button>
        </div>
      )}
      {preview && (
        <>
          {preview.truncated && (
            <p className="p-2 text-xs text-muted-foreground">
              Preview limited to 200 rows, 50 columns, and bounded cell text.
            </p>
          )}
          <div className="min-h-0 overflow-auto">
            <table className="table-fixed border-collapse text-xs" aria-label={preview.sheet}>
              <colgroup>
                <col style={{ width: 48 }} />
                {Array.from(
                  { length: Math.max(0, ...preview.rows.map((row) => row.length)) },
                  (_, i) => (
                    <col key={i} style={{ width: widths[i] ?? 160 }} />
                  ),
                )}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  <th className="border p-2">#</th>
                  {preview.rows[0]?.map((_, i) => (
                    <th
                      key={i}
                      className="relative border p-2"
                      style={{ minWidth: widths[i] ?? 160 }}
                    >
                      {columnName(i)}
                      <button
                        aria-label={`Resize column ${columnName(i)}`}
                        className="absolute inset-y-0 right-0 w-3 cursor-col-resize touch-none"
                        onPointerDown={(event) => resize(event, i, 'column')}
                        onKeyDown={(event) => {
                          if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                            event.preventDefault()
                            setWidths((value) => ({
                              ...value,
                              [i]: Math.max(
                                64,
                                Math.min(
                                  600,
                                  (value[i] ?? 160) + (event.key === 'ArrowRight' ? 16 : -16),
                                ),
                              ),
                            }))
                          }
                        }}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row, r) => (
                  <tr key={r} style={{ height: heights[r] ?? 36 }}>
                    <th className="relative border bg-muted px-2 font-normal">
                      {r + 1}
                      <button
                        aria-label={`Resize row ${r + 1}`}
                        className="absolute inset-x-0 bottom-0 h-3 cursor-row-resize touch-none"
                        onPointerDown={(event) => resize(event, r, 'row')}
                        onKeyDown={(event) => {
                          if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
                            event.preventDefault()
                            setHeights((value) => ({
                              ...value,
                              [r]: Math.max(
                                28,
                                Math.min(
                                  600,
                                  (value[r] ?? 36) + (event.key === 'ArrowDown' ? 8 : -8),
                                ),
                              ),
                            }))
                          }
                        }}
                      />
                    </th>
                    {row.map((cell, c) => (
                      <td key={c} className="border p-0 align-top">
                        <div
                          className="overflow-hidden whitespace-pre-wrap break-words px-2 py-1"
                          style={{ width: widths[c] ?? 160, maxHeight: heights[r] ?? 36 }}
                          title={cell}
                        >
                          {cell}
                        </div>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
function columnName(index: number) {
  let label = ''
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26))
    label = String.fromCharCode(65 + ((value - 1) % 26)) + label
  return label
}
