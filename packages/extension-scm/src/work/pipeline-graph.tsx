import { useLayoutEffect, useMemo, useRef, useState, useId } from 'react'
import {
  pipelineGraphColumns,
  pipelineFailureImpact,
  pipelineSignal,
  pipelineDuration,
  type ForgePipelineDetail,
} from '@dovo/protocol'
import { PipelineState } from './pipeline-state'

export function PipelineGraph({
  detail,
  now,
  onSelect,
  selectedJob,
}: {
  detail: ForgePipelineDetail
  now: number
  onSelect: (id: string) => void
  selectedJob?: string | null
}) {
  const columns = useMemo(
    () => pipelineGraphColumns(detail.graph, detail.jobs),
    [detail.graph, detail.jobs],
  )
  const impact = useMemo(
    () => pipelineFailureImpact(detail.graph, detail.jobs),
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
  if (!columns.length)
    return detail.graphNotice ? (
      <p className="text-xs text-muted-foreground">{detail.graphNotice}</p>
    ) : null
  return (
    <section aria-label="Pipeline graph" className="space-y-3">
      <h3 className="text-sm font-medium">Workflow</h3>
      {detail.graphNotice && <p className="text-xs text-muted-foreground">{detail.graphNotice}</p>}
      {!detail.graph && (
        <p className="text-xs text-muted-foreground">Jobs · dependencies not provided</p>
      )}
      <div className="overflow-x-auto rounded-xl border bg-muted/20">
        <div ref={surface} className="relative flex w-max min-w-full items-start gap-10 p-5">
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 h-full w-full overflow-visible text-muted-foreground/40"
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
              {columns.length > 1 && (
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Stage {index + 1}
                </p>
              )}
              {column.map((node) => (
                <div
                  key={node.id}
                  data-graph-node={node.id}
                  className={`relative space-y-3 rounded-xl border p-3 ${impact.failed.has(node.id) ? 'border-status-error/40 bg-status-error/5' : impact.affected.has(node.id) ? 'border-status-warning/40 bg-card' : 'border-border/50 bg-card'}`}
                >
                  <p className="text-sm font-medium break-words">{node.name}</p>
                  {impact.failed.has(node.id) ? (
                    <p className="text-xs text-status-error">Failed stage</p>
                  ) : impact.affected.has(node.id) ? (
                    <p className="text-xs text-status-warning">Depends on failed stage</p>
                  ) : null}
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
                          aria-pressed={selectedJob === id}
                          className={`flex w-full items-center justify-between gap-2 rounded-lg border p-2 text-left transition-colors hover:bg-muted ${selectedJob === id ? 'border-primary/50 bg-primary/5' : pipelineSignal(job.status).tone === 'danger' ? 'border-transparent bg-status-error/10' : pipelineSignal(job.status).tone === 'success' ? 'border-transparent bg-transparent' : 'border-transparent bg-muted/30'}`}
                        >
                          <span className="min-w-0 space-y-2 text-xs">
                            {job.name !== node.name && (
                              <span className="block break-words">{job.name}</span>
                            )}
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
