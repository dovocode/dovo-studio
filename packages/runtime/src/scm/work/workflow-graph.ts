import { parseDocument } from 'yaml'
import { decode, mutableArray, mutableStruct, type ForgePipelineJob } from '@dovo/protocol'
import { Schema } from 'effect'

const definition = mutableStruct({
  jobs: Schema.Record(
    Schema.String,
    mutableStruct({
      name: Schema.optional(Schema.String),
      needs: Schema.optional(Schema.Union([Schema.String, mutableArray(Schema.String)])),
    }),
  ),
})

/** Match only unambiguous static names. Expression-based names remain separate live jobs. */
export function workflowGraph(source: string, jobs: ForgePipelineJob[]) {
  const document = parseDocument(source)
  if (document.errors.length) throw new Error('Workflow YAML could not be parsed')
  const workflow = decode(definition, document.toJS({ maxAliasCount: 0 }))
  const definitions = Object.entries(workflow.jobs)
  if (definitions.length > 500) throw new Error('Workflow contains too many jobs')
  const assigned = new Set<string>()
  const nodes = definitions.map(([id, job]) => {
    const name = job.name ?? id
    const jobIds = !name.includes('${{')
      ? jobs
          .filter(
            (live) =>
              (live.name === name || live.name.startsWith(`${name} (`)) &&
              definitions.filter(([key, value]) => {
                const candidate = value.name ?? key
                return (
                  !candidate.includes('${{') &&
                  (live.name === candidate || live.name.startsWith(`${candidate} (`))
                )
              }).length === 1,
          )
          .map((live) => live.id)
      : []
    for (const key of jobIds) assigned.add(key)
    return {
      id,
      name,
      needs: typeof job.needs === 'string' ? [job.needs] : (job.needs ?? []),
      jobIds,
    }
  })
  return [
    ...nodes,
    ...jobs
      .filter((job) => !assigned.has(job.id))
      .map((job) => ({
        id: `live:${job.id}`,
        name: job.name,
        needs: [],
        jobIds: [job.id],
      })),
  ]
}
