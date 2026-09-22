import { z } from 'zod'
import { pipelineActionAllowed } from '@dovo/protocol'
import type {
  ForgeIssueCreate,
  ForgeIssueAction,
  ForgePipeline,
  ForgePipelineAction,
  ForgeWorkOptions,
} from '@dovo/protocol'
import type { ForgeWorkProvider, WorkHttp } from './forge-work-types.js'
import { HttpError } from '../errors.js'
import { workPage } from './forge-work-git.js'
import { pipelineErrors, pipelineTime } from './forge-work-details.js'
const state = z.object({
  name: z.string(),
  result: z
    .object({
      name: z.string(),
      error: z.object({ message: z.string().nullish() }).nullish(),
    })
    .optional(),
})
const pipeline = z.object({
  uuid: z.string(),
  build_number: z.number(),
  created_on: z.string(),
  completed_on: z.string().nullish(),
  trigger: z.object({ type: z.string().nullish(), name: z.string().nullish() }).nullish(),
  state,
  creator: z.object({ display_name: z.string() }).optional(),
  target: z.object({
    ref_name: z.string().optional(),
    commit: z.object({ hash: z.string(), message: z.string().nullish() }).nullish(),
    selector: z.object({ pattern: z.string().nullish() }).nullish(),
  }),
})
export class BitbucketForgeWork implements ForgeWorkProvider {
  private path: string
  private web: string
  constructor(
    private http: WorkHttp,
    repository: string,
  ) {
    this.path = `repositories/${repository.split('/').map(encodeURIComponent).join('/')}`
    this.web = `https://bitbucket.org/${repository.split('/').map(encodeURIComponent).join('/')}`
  }
  private get(path: string, options?: Parameters<WorkHttp['json']>[1]) {
    return this.http.json(`${this.path}/${path}`, options)
  }
  async options(): Promise<ForgeWorkOptions> {
    return {
      provider: 'bitbucket',
      issues: false,
      issueNotice:
        'Bitbucket Cloud retired its native issue tracker in August 2026. Use your linked Jira or external issue tracker.',
      issueTypes: [],
      issueStates: [],
      assignees: false,
      labels: false,
      pipelines: true,
      pipelineActions: ['run', 'cancel'],
      pipelineNotice:
        'Rerun existing builds on Bitbucket to preserve secured variables and the original pipeline configuration.',
    }
  }
  private unavailable(): never {
    throw new HttpError(
      400,
      'Bitbucket Cloud no longer supports native issues. Open the project issue tracker.',
    )
  }
  async issues(_state: string, _cursor?: string): ReturnType<ForgeWorkProvider['issues']> {
    return this.unavailable()
  }
  async issue(_id: string, _cursor?: string): ReturnType<ForgeWorkProvider['issue']> {
    return this.unavailable()
  }
  async createIssue(_input: ForgeIssueCreate): ReturnType<ForgeWorkProvider['createIssue']> {
    return this.unavailable()
  }
  async actOnIssue(_input: ForgeIssueAction): ReturnType<ForgeWorkProvider['actOnIssue']> {
    return this.unavailable()
  }
  private normalize(value: z.infer<typeof pipeline>): ForgePipeline {
    return {
      id: value.uuid,
      title: `#${value.build_number} · ${value.target.selector?.pattern ?? value.target.ref_name ?? 'Pipeline'}`,
      url: `${this.web}/pipelines/results/${value.build_number}`,
      ref: value.target.ref_name ?? '',
      sha: value.target.commit?.hash ?? '',
      actor: value.creator?.display_name ?? '',
      status: value.state.result?.name ?? value.state.name,
      createdAt: value.created_on,
      updatedAt: value.completed_on ?? value.created_on,
      number: String(value.build_number),
      workflow: value.target.selector?.pattern || undefined,
      event: value.trigger?.name || value.trigger?.type?.replace(/^pipeline_trigger_/, ''),
      commitMessage: value.target.commit?.message || undefined,
      completedAt: pipelineTime(value.completed_on),
      errors: pipelineErrors(
        value.state.result?.error?.message ? [value.state.result.error.message] : undefined,
      ),
    }
  }
  async definitions() {
    return {
      items: [],
      manual: true,
      hint: 'Enter a custom pipeline name from bitbucket-pipelines.yml, or “default” to use the branch pipeline.',
    }
  }
  async pipelines(cursor?: string) {
    const page = workPage(cursor)
    const result = z
      .object({ values: z.array(pipeline), next: z.string().optional() })
      .parse(await this.get(`pipelines/?pagelen=30&page=${page}&sort=-created_on`))
    return {
      items: result.values.map((v) => this.normalize(v)),
      next: result.next ? String(page + 1) : undefined,
    }
  }
  async pipeline(id: string, cursor?: string) {
    const selected = encodeURIComponent(id),
      page = workPage(cursor)
    const value = pipeline.parse(await this.get(`pipelines/${selected}`)),
      run = this.normalize(value)
    const steps = z
      .object({
        values: z.array(
          z.object({
            uuid: z.string(),
            name: z.string().optional(),
            state,
            started_on: z.string().nullish(),
            completed_on: z.string().nullish(),
          }),
        ),
        next: z.string().optional(),
      })
      .parse(await this.get(`pipelines/${selected}/steps/?pagelen=50&page=${page}`))
    return {
      run,
      jobs: steps.values.map((v) => ({
        id: v.uuid,
        name: v.name ?? v.uuid,
        status: v.state.result?.name ?? v.state.name,
        url: `${run.url}/steps/${encodeURIComponent(v.uuid)}`,
        startedAt: pipelineTime(v.started_on),
        completedAt: pipelineTime(v.completed_on),
        errors: pipelineErrors(
          v.state.result?.error?.message ? [v.state.result.error.message] : undefined,
        ),
      })),
      next: steps.next ? String(page + 1) : undefined,
    }
  }
  async actOnPipeline(input: ForgePipelineAction) {
    if (input.action === 'run') {
      const value = pipeline.parse(
        await this.get('pipelines/', {
          method: 'POST',
          body: {
            target: {
              type: 'pipeline_ref_target',
              ref_type: 'branch',
              ref_name: input.ref,
              ...(input.definition === 'default'
                ? {}
                : { selector: { type: 'custom', pattern: input.definition } }),
            },
            variables: Object.entries(input.inputs).map(([key, value]) => ({
              key,
              value,
              secured: false,
            })),
          },
        }),
      )
      return { id: value.uuid, url: this.normalize(value).url, message: 'Pipeline queued' }
    }
    if (input.action !== 'cancel')
      throw new HttpError(400, 'Use Bitbucket for this pipeline action')
    const current = pipeline.parse(await this.get(`pipelines/${encodeURIComponent(input.id)}`))
    if (!pipelineActionAllowed(input.action, current.state.name))
      throw new HttpError(
        409,
        'This pipeline cannot be cancelled in its current state. Refresh its status.',
      )
    await this.get(`pipelines/${encodeURIComponent(input.id)}/stopPipeline`, { method: 'POST' })
    return { id: current.uuid, url: this.normalize(current).url, message: 'Cancellation requested' }
  }
}
