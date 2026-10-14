import { Schema } from 'effect'
import {
  decode,
  mutableStruct,
  mutableArray,
  pipelineActionAllowed,
  type ForgeIssue,
  type ForgeIssueCreate,
  type ForgeIssueAction,
  type ForgePipeline,
  type ForgePipelineAction,
  type ForgeWorkOptions,
} from '@dovo/protocol'
import { HttpError } from '../../errors.js'
import type { ForgeWorkProvider, WorkHttp } from './forge-work-types.js'
import { workPage } from './forge-work-git.js'
import { gitlabProjectPath } from '../forges/providers/forge-gitlab.js'
import { gitlabUser, gitlabPipeline } from '../forges/providers/forge-gitlab-schemas.js'
import { pipelineErrors, pipelineTime } from './forge-work-details.js'

const issueSchema = mutableStruct({
  iid: Schema.Number,
  title: Schema.String,
  description: Schema.NullOr(Schema.String),
  state: Schema.String,
  web_url: Schema.String,
  author: Schema.NullOr(gitlabUser),
  assignees: mutableArray(gitlabUser),
  labels: mutableArray(Schema.String),
  updated_at: Schema.String,
})
const noteSchema = mutableStruct({
  id: Schema.Number,
  body: Schema.String,
  author: Schema.NullOr(gitlabUser),
  created_at: Schema.String,
  system: Schema.optional(Schema.Boolean),
})
const jobSchema = mutableStruct({
  id: Schema.Number,
  name: Schema.String,
  status: Schema.String,
  stage: Schema.String,
  web_url: Schema.String,
  started_at: Schema.NullOr(Schema.String),
  finished_at: Schema.NullOr(Schema.String),
  failure_reason: Schema.optional(Schema.NullOr(Schema.String)),
  runner: Schema.optional(
    Schema.NullOr(mutableStruct({ description: Schema.optional(Schema.NullOr(Schema.String)) })),
  ),
})
const SIZE = 50
export class GitLabForgeWork implements ForgeWorkProvider {
  private readonly path: string
  constructor(
    private readonly http: WorkHttp,
    repository: string,
  ) {
    this.path = gitlabProjectPath(repository)
  }
  private get(path: string, options?: Parameters<WorkHttp['json']>[1]) {
    return this.http.json(`${this.path}/${path}`, options)
  }
  private id(id: string) {
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)))
      throw new HttpError(400, 'Choose a valid GitLab item.')
    return id
  }
  async options(): Promise<ForgeWorkOptions> {
    return {
      provider: 'gitlab',
      issues: true,
      issueTypes: ['Issue'],
      issueStates: ['opened', 'closed'],
      issueSearch: true,
      assignees: true,
      labels: true,
      pipelines: true,
      pipelineActions: ['run', 'rerun', 'cancel'],
      pipelineNotice:
        'GitLab uses the selected ref’s .gitlab-ci.yml. Child pipeline jobs remain available on GitLab.',
    }
  }
  private normalizeIssue(value: typeof issueSchema.Type): ForgeIssue {
    return {
      id: String(value.iid),
      title: value.title,
      body: value.description ?? '',
      state: value.state,
      type: 'Issue',
      url: value.web_url,
      author: value.author?.username ?? 'Deleted user',
      assignees: value.assignees.map((user) => user.username),
      labels: value.labels,
      updatedAt: value.updated_at,
      revision: value.updated_at,
      bodyFormat: 'markdown',
    }
  }
  async issues(state: string, cursor?: string, query?: string) {
    const page = workPage(cursor)
    const selected = state === 'open' ? 'opened' : state
    if (!['opened', 'closed', 'all'].includes(selected))
      throw new HttpError(400, 'Choose a valid GitLab issue state.')
    const rows = decode(
      mutableArray(issueSchema),
      await this.get(
        `issues?state=${selected}&order_by=updated_at&sort=desc&per_page=${SIZE}&page=${page}${query ? `&search=${encodeURIComponent(query)}` : ''}`,
      ),
    )
    return {
      items: rows.map((issue) => this.normalizeIssue(issue)),
      next: rows.length === SIZE ? String(page + 1) : undefined,
    }
  }
  async issue(id: string, cursor?: string) {
    const selected = this.id(id),
      page = workPage(cursor)
    const [value, notes] = await Promise.all([
      this.get(`issues/${selected}`).then((value) => decode(issueSchema, value)),
      this.get(
        `issues/${selected}/notes?sort=asc&order_by=created_at&per_page=${SIZE}&page=${page}`,
      ).then((value) => decode(mutableArray(noteSchema), value)),
    ])
    return {
      issue: this.normalizeIssue(value),
      comments: notes
        .filter((note) => !note.system)
        .map((note) => ({
          id: String(note.id),
          body: note.body,
          author: note.author?.username ?? 'Deleted user',
          createdAt: note.created_at,
          url: `${value.web_url}#note_${note.id}`,
          bodyFormat: 'markdown' as const,
        })),
      next: notes.length === SIZE ? String(page + 1) : undefined,
    }
  }
  private async assigneeIds(names: readonly string[]) {
    const ids: number[] = []
    for (const name of names) {
      const users = decode(
        mutableArray(gitlabUser),
        await this.http.json(`/api/v4/users?username=${encodeURIComponent(name)}&per_page=50`),
      )
      const user = users.find(
        (candidate) => candidate.username.toLowerCase() === name.toLowerCase(),
      )
      if (!user) throw new HttpError(400, `GitLab user “${name}” was not found.`)
      ids.push(user.id)
    }
    return ids
  }
  async createIssue(input: ForgeIssueCreate) {
    if (input.type !== 'Issue') throw new HttpError(400, 'GitLab issue creation supports Issue.')
    const assignees = await this.assigneeIds(input.assignees)
    const value = decode(
      issueSchema,
      await this.get('issues', {
        method: 'POST',
        body: {
          title: input.title,
          description: input.body,
          assignee_ids: assignees,
          labels: input.labels.join(','),
        },
      }),
    )
    return { id: String(value.iid), url: value.web_url, message: 'Issue created' }
  }
  async actOnIssue(input: ForgeIssueAction) {
    const path = `issues/${this.id(input.id)}`
    const assignees =
      input.action === 'edit' && input.assignees !== undefined
        ? await this.assigneeIds(input.assignees)
        : undefined
    const current = decode(issueSchema, await this.get(path))
    if (current.updated_at !== input.revision)
      throw new HttpError(409, 'This issue changed. Refresh before saving.')
    if (input.action === 'comment')
      await this.get(`${path}/notes`, { method: 'POST', body: { body: input.body } })
    else {
      if (input.state !== undefined && !['opened', 'open', 'closed'].includes(input.state))
        throw new HttpError(400, 'Choose an opened or closed issue state.')
      await this.get(path, {
        method: 'PUT',
        body: {
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.body === undefined ? {} : { description: input.body }),
          ...(input.state === undefined
            ? {}
            : { state_event: input.state === 'closed' ? 'close' : 'reopen' }),
          ...(assignees === undefined ? {} : { assignee_ids: assignees.length ? assignees : [0] }),
          ...(input.labels === undefined ? {} : { labels: input.labels.join(',') }),
        },
      })
    }
    return {
      id: input.id,
      url: current.web_url,
      message: input.action === 'comment' ? 'Comment submitted' : 'Issue updated',
    }
  }
  private normalizePipeline(value: typeof gitlabPipeline.Type): ForgePipeline {
    return {
      id: String(value.id),
      title: value.name || `#${value.iid ?? value.id} · ${value.ref}`,
      number: String(value.iid ?? value.id),
      url: value.web_url,
      ref: value.ref,
      sha: value.sha,
      actor: value.user?.username ?? '',
      status: value.status,
      createdAt: value.created_at,
      updatedAt: value.updated_at,
      workflow: value.name ?? undefined,
      event: value.source,
      startedAt: pipelineTime(value.started_at),
      completedAt: pipelineTime(value.finished_at),
    }
  }
  async definitions() {
    return {
      items: [{ id: '.gitlab-ci.yml', name: 'Project pipeline' }],
      manual: false,
      hint: 'Uses .gitlab-ci.yml from the selected ref. Inputs are passed as pipeline variables.',
    }
  }
  async pipelines(cursor?: string) {
    const page = workPage(cursor)
    const rows = decode(
      mutableArray(gitlabPipeline),
      await this.get(`pipelines?order_by=updated_at&sort=desc&per_page=${SIZE}&page=${page}`),
    )
    return {
      items: rows.map((run) => this.normalizePipeline(run)),
      next: rows.length === SIZE ? String(page + 1) : undefined,
    }
  }
  async pipeline(id: string, cursor?: string) {
    const selected = this.id(id),
      page = workPage(cursor)
    const [run, jobs] = await Promise.all([
      this.get(`pipelines/${selected}`).then((value) => decode(gitlabPipeline, value)),
      this.get(
        `pipelines/${selected}/jobs?include_retried=false&per_page=${SIZE}&page=${page}`,
      ).then((value) => decode(mutableArray(jobSchema), value)),
    ])
    // Stages alone do not imply `needs`: keep the graph honest instead of inventing dependencies.
    return {
      run: this.normalizePipeline(run),
      jobs: jobs.map((job) => ({
        id: String(job.id),
        name: `${job.stage} · ${job.name}`,
        status: job.status,
        url: job.web_url,
        runner: job.runner?.description ?? undefined,
        startedAt: pipelineTime(job.started_at),
        completedAt: pipelineTime(job.finished_at),
        errors: pipelineErrors(
          job.failure_reason ? [job.failure_reason.replace(/_/g, ' ')] : undefined,
        ),
      })),
      next: jobs.length === SIZE ? String(page + 1) : undefined,
      graphNotice: 'GitLab job dependencies and child pipelines are available on GitLab.',
    }
  }
  async actOnPipeline(input: ForgePipelineAction) {
    if (input.action === 'run') {
      if (input.definition !== '.gitlab-ci.yml')
        throw new HttpError(400, 'Choose the project pipeline.')
      const value = decode(
        gitlabPipeline,
        await this.get('pipeline', {
          method: 'POST',
          body: {
            ref: input.ref,
            variables: Object.entries(input.inputs).map(([key, value]) => ({
              key,
              value,
              variable_type: 'env_var',
            })),
          },
        }),
      )
      return { id: String(value.id), url: value.web_url, message: 'Pipeline queued' }
    }
    if (input.action !== 'rerun' && input.action !== 'cancel')
      throw new HttpError(400, 'Use GitLab for this pipeline action.')
    const selected = this.id(input.id),
      current = decode(gitlabPipeline, await this.get(`pipelines/${selected}`))
    if (!pipelineActionAllowed(input.action, current.status))
      throw new HttpError(
        409,
        'This pipeline action is unavailable in its current state. Refresh its status.',
      )
    const value = decode(
      gitlabPipeline,
      await this.get(`pipelines/${selected}/${input.action === 'rerun' ? 'retry' : 'cancel'}`, {
        method: 'POST',
      }),
    )
    return {
      id: String(value.id),
      url: value.web_url,
      message: input.action === 'rerun' ? 'Failed jobs queued again' : 'Cancellation requested',
    }
  }
}
