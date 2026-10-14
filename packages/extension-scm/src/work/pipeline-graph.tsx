import { useLayoutEffect, useMemo, useRef, useState, useId } from 'react'
import { pipelineGraphColumns, pipelineDuration, type ForgePipelineDetail } from '@dovo/protocol'
import { PipelineState } from './pipeline-detail'

export function PipelineGraph({
  detail,
  now,
  onSelect,
}: {
  detail: ForgePipelineDetail
  now: number
  onSelect: (id: string) => void
}) {
  const columns = useMemo(
    () => pipelineGraphColumns(detail.graph, detail.jobs),
    [detail.graph, detail.jobs],
  )
  const surface = useRef<HTMLDivElement>(null)
  const marker = useId()
  const [edges, setEdges] = useState<{ path: string; key: string }[]>([])
  useLayoutEffect(() => {
    const element = surface.current
    if (!element) return
    const update = () => {
      const nodes = new Map(
        [...element.querySelectorAll<HTMLElement>('[data-graph-node]')].map((node) => [
          node.dataset.graphNode,
          node,
        ]),
      )
      const paths = columns.flat().flatMap((node) =>
        node.needs.flatMap((id) => {
          const from = nodes.get(id),
            to = nodes.get(node.id)
          if (!from || !to) return []
          const x1 = from.offsetLeft + from.offsetWidth,
            y1 = from.offsetTop + from.offsetHeight / 2
          const x2 = to.offsetLeft,
            y2 = to.offsetTop + to.offsetHeight / 2
          const middle = (x1 + x2) / 2
          return [
            {
              key: `${id}:${node.id}`,
              path: `M ${x1} ${y1} C ${middle} ${y1}, ${middle} ${y2}, ${x2} ${y2}`,
            },
          ]
        }),
      )
      setEdges(paths)
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    for (const node of element.querySelectorAll('[data-graph-node]')) observer.observe(node)
    return () => observer.disconnect()
  }, [columns])
  if (!columns.length) return null
  return (
    <section aria-label="Pipeline graph" className="space-y-3">
      <h3 className="text-sm font-medium">Workflow</h3>
      {detail.graphNotice && <p className="text-xs text-muted-foreground">{detail.graphNotice}</p>}
      {!detail.graph && (
        <p className="text-xs text-muted-foreground">Jobs · dependencies not provided</p>
      )}
      <div className="overflow-x-auto rounded-xl border bg-muted/10">
        <div ref={surface} className="relative flex w-max min-w-full items-start gap-10 p-4">
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-muted-foreground"
          >
            <defs>
              <marker id={marker} markerWidth="6" markerHeight="6" refX="6" refY="3" orient="auto">
                <path d="M 0 0 L 6 3 L 0 6 Z" fill="currentColor" />
              </marker>
            </defs>
            {edges.map((edge) => (
              <path
                key={edge.key}
                d={edge.path}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                markerEnd={`url(#${marker})`}
              />
            ))}
          </svg>
          {columns.map((column, index) => (
            <div key={index} className="w-56 shrink-0 space-y-3">
              {column.map((node) => (
                <div
                  key={node.id}
                  data-graph-node={node.id}
                  className="rounded-lg border bg-card p-3 space-y-2"
                >
                  <p className="text-sm font-medium break-words">{node.name}</p>
                  {!!node.needs.length && (
                    <p className="text-xs text-muted-foreground">After {node.needs.join(', ')}</p>
                  )}
                  {node.jobIds.map((id) => {
                    const job = detail.jobs.find((job) => job.id === id)
                    return (
                      job && (
                        <button
                          key={id}
                          type="button"
                          onClick={() => onSelect(id)}
                          aria-label={`View job ${job.name}`}
                          className="flex w-full items-center justify-between gap-2 rounded p-1 text-left hover:bg-muted"
                        >
                          <span className="min-w-0 text-xs">
                            <span className="block truncate">{job.name}</span>
                            <PipelineState status={job.status} />
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {pipelineDuration(job, now)}
                          </span>
                        </button>
                      )
                    )
                  })}
                  {!node.jobIds.length && (
                    <p className="text-xs text-muted-foreground">Not reported</p>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      {detail.next && (
        <p className="text-xs text-muted-foreground">
          Load more jobs to complete the live statuses.
        </p>
      )}
    </section>
  )
}
