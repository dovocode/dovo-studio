import { pipelineSignal } from './work-presentation.js'
import type { ForgePipelineGraphNode, ForgePipelineJob } from '../forges/forge-work.js'

/** Resolve dependency columns with bounded traversal for incomplete or cyclic definitions. */
export function pipelineGraphColumns(
  graph: ForgePipelineGraphNode[] | undefined,
  jobs: ForgePipelineJob[],
) {
  const nodes =
    graph?.map((node) => ({
      ...node,
      jobIds: [
        ...new Set([
          ...node.jobIds,
          ...jobs
            .filter(
              (job) =>
                !node.id.startsWith('live:') &&
                !node.name.includes('${{') &&
                (job.name === node.name || job.name.startsWith(`${node.name} (`)) &&
                graph.filter(
                  (other) =>
                    !other.id.startsWith('live:') &&
                    !other.name.includes('${{') &&
                    (job.name === other.name || job.name.startsWith(`${other.name} (`)),
                ).length === 1,
            )
            .map((job) => job.id),
        ]),
      ],
    })) ?? jobs.map((job) => ({ id: job.id, name: job.name, needs: [], jobIds: [job.id] }))
  const assigned = new Set(nodes.flatMap((node) => node.jobIds))
  for (const job of jobs) {
    if (!assigned.has(job.id))
      nodes.push({ id: `live:${job.id}`, name: job.name, needs: [], jobIds: [job.id] })
  }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const levels = new Map<string, number>()
  const visit = (id: string, path: Set<string>): number => {
    if (levels.has(id)) return levels.get(id) ?? 0
    const node = byId.get(id)
    if (!node || path.has(id)) return 0
    const next = new Set(path).add(id)
    const level = node.needs.length
      ? Math.min(nodes.length, 1 + Math.max(...node.needs.map((key) => visit(key, next))))
      : 0
    levels.set(id, level)
    return level
  }
  for (const node of nodes) visit(node.id, new Set())
  const columns: ForgePipelineGraphNode[][] = []
  for (const node of nodes) (columns[levels.get(node.id) ?? 0] ??= []).push(node)
  return columns.filter(Boolean)
}

/** Dependency emphasis uses reported failures; it never assumes dependent jobs are blocked. */
export function pipelineFailureImpact(
  graph: ForgePipelineGraphNode[] | undefined,
  jobs: ForgePipelineJob[],
) {
  const nodes = pipelineGraphColumns(graph, jobs).flat()
  const failedJobs = new Set(
    jobs
      .filter((job) => pipelineSignal(job.status).tone === 'danger' || job.errors?.length)
      .map((job) => job.id),
  )
  const failed = new Set(
    nodes.filter((node) => node.jobIds.some((id) => failedJobs.has(id))).map((node) => node.id),
  )
  const affected = new Set(failed)
  for (let pass = 0; pass < nodes.length; pass++) {
    let changed = false
    for (const node of nodes) {
      if (!affected.has(node.id) && node.needs.some((id) => affected.has(id))) {
        affected.add(node.id)
        changed = true
      }
    }
    if (!changed) break
  }
  return { failed, affected }
}
