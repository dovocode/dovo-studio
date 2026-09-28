import { Schema } from 'effect'
import {
  forgeIssueDetailSchema,
  mutableStruct,
  forgePipelineDetailSchema,
  forgeWorkOptionsSchema,
  type RuntimeReadCache,
  type Repository,
  type JiraSource,
} from '@dovo/protocol'

const cachedIssueSchema = mutableStruct({
  ...forgeIssueDetailSchema.fields,
  loadedPages: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 500))),
})
const cachedPipelineSchema = mutableStruct({
  ...forgePipelineDetailSchema.fields,
  loadedPages: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.between(1, 500))),
})

export function workDetailCacheKeys(
  source: { repository?: Repository; jira?: JiraSource },
  mode: 'issues' | 'pipelines',
  id: string,
) {
  const identity = source.jira
    ? ['jira', source.jira]
    : ['repository', source.repository?.id, source.repository?.path, source.repository?.forge]
  return {
    options: JSON.stringify(['work-detail', identity, mode, 'options']),
    detail: JSON.stringify(['work-detail', identity, mode, id]),
  }
}

export async function readWorkDetailCache(
  cache: RuntimeReadCache,
  keys: ReturnType<typeof workDetailCacheKeys>,
  mode: 'issues' | 'pipelines',
  expectedURL?: string,
) {
  if (mode === 'issues') {
    const [options, detail] = await Promise.all([
      cache.read(keys.options, forgeWorkOptionsSchema),
      cache.read(keys.detail, cachedIssueSchema),
    ])
    // An old numeric ID can identify an unrelated issue after a source moves.
    if (detail && expectedURL && detail.value.issue.url !== expectedURL)
      throw new Error('This issue source changed. Open the original source below.')
    return { options: options?.value, issue: detail?.value, pipeline: undefined }
  }
  const [options, detail] = await Promise.all([
    cache.read(keys.options, forgeWorkOptionsSchema),
    cache.read(keys.detail, cachedPipelineSchema),
  ])
  if (detail && expectedURL && detail.value.run.url !== expectedURL)
    throw new Error('This pipeline source changed. Open the original source below.')
  return { options: options?.value, pipeline: detail?.value, issue: undefined }
}
