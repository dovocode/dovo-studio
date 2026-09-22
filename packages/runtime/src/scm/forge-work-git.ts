import { z } from 'zod'
import { pipelineActionAllowed } from '@dovo/protocol'
import type {
  ForgeIssue,
  ForgeIssueCreate,
  ForgeIssueAction,
  ForgePipeline,
  ForgePipelineAction,
  ForgeWorkOptions,
} from '@dovo/protocol'
import type { ForgeWorkProvider, WorkHttp } from './forge-work-types.js'
import { HttpError } from '../errors.js'
import { pipelineTime } from './forge-work-details.js'
const user = z.object({ login: z.string() })
const issue = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string().nullish(),
  state: z.string(),
  html_url: z.string(),
  user: user.nullish(),
  assignees: z.array(user).nullish(),
  labels: z.array(z.object({ name: z.string() })).default([]),
  updated_at: z.string(),
  pull_request: z.unknown().optional(),
  content_version: z.number().optional(),
})
const comment = z.object({
  id: z.number(),
  body: z.string(),
  user: user.nullish(),
  created_at: z.string(),
  html_url: z.string().optional(),
})
const run = z.object({
  id: z.number(),
  name: z.string().nullish(),
  display_title: z.string().optional(),
  title: z.string().optional(),
  html_url: z.string(),
  head_branch: z.string().optional(),
  head_sha: z.string().optional(),
  prettyref: z.string().optional(),
  commit_sha: z.string().optional(),
  status: z.string(),
  conclusion: z.string().nullish(),
  actor: user.optional(),
  trigger_user: user.optional(),
  created_at: z.string().optional(),
  created: z.string().optional(),
  started_at: z.string().nullish(),
  completed_at: z.string().nullish(),
  updated_at: z.string().optional(),
  updated: z.string().optional(),
  path: z.string().nullish(),
  workflow_id: z.union([z.string(), z.number()]).nullish(),
  run_number: z.number().nullish(),
  index_in_repo: z.number().nullish(),
  run_attempt: z.number().nullish(),
  event: z.string().nullish(),
  trigger_event: z.string().nullish(),
  run_started_at: z.string().nullish(),
  started: z.string().nullish(),
  stopped: z.string().nullish(),
  head_commit: z.object({ message: z.string().nullish() }).nullish(),
})
const step = z.object({
  number: z.number().int().nonnegative(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullish(),
  started_at: z.string().nullish(),
  completed_at: z.string().nullish(),
})
const job = z.object({
  id: z.number(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullish(),
  html_url: z.string().optional(),
  runner_name: z.string().nullish(),
  started_at: z.string().nullish(),
  completed_at: z.string().nullish(),
  steps: z.array(step).nullish(),
})
export function workPage(cursor?: string) {
  return z.coerce
    .number()
    .int()
    .min(1)
    .max(10000)
    .parse(cursor ?? '1')
}
export class GitForgeWork implements ForgeWorkProvider {
  private path: string
  constructor(
    private http: WorkHttp,
    private provider: 'github' | 'gitea' | 'forgejo',
    private repository: string,
  ) {
    this.path = `${provider === 'github' ? '' : 'api/v1/'}repos/${repository.split('/').map(encodeURIComponent).join('/')}`
  }
  private get(path: string, options?: Parameters<WorkHttp['json']>[1]) {
    return this.http.json(`${this.path}/${path}`, options)
  }
  async options(): Promise<ForgeWorkOptions> {
    const actions: ForgeWorkOptions['pipelineActions'] = ['run', 'rerun']
    let pipelines = true
    let pipelineNotice: string | undefined
    if (this.provider === 'github') actions.push('cancel', 'enable', 'disable')
    else {
      const { version } = z
        .object({ version: z.string() })
        .parse(await this.http.json('api/v1/version'))
      const match = /^(\d+)\.(\d+)/.exec(version)
      const major = Number(match?.[1]),
        minor = Number(match?.[2])
      // Use only the Actions contracts inspected for these server releases.
      pipelines =
        this.provider === 'forgejo' ? major >= 16 : major > 1 || (major === 1 && minor >= 27)
      if (!pipelines)
        pipelineNotice = `Pipeline management requires ${this.provider === 'forgejo' ? 'Forgejo 16' : 'Gitea 1.27'} or newer. Open Actions on your server for older releases.`
      else if (this.provider === 'forgejo') actions.push('cancel')
      else actions.push('enable', 'disable')
    }
    return {
      provider: this.provider,
      issues: true,
      issueTypes: ['Issue'],
      issueStates: ['open', 'closed'],
      issueSearch: true,
      assignees: true,
      labels: this.provider === 'github',
      pipelines,
      pipelineNotice,
      pipelineActions: pipelines ? actions : [],
    }
  }
  private normalize(raw: z.infer<typeof issue>): ForgeIssue {
    return {
      id: String(raw.number),
      title: raw.title,
      body: raw.body ?? '',
      state: raw.state,
      type: 'Issue',
      url: raw.html_url,
      author: raw.user?.login ?? 'Deleted user',
      assignees: (raw.assignees ?? []).map((v) => v.login),
      labels: raw.labels.map((v) => v.name),
      updatedAt: raw.updated_at,
      revision: this.revision(raw),
      bodyFormat: 'markdown',
    }
  }
  private revision(raw: z.infer<typeof issue>) {
    return raw.content_version === undefined
      ? raw.updated_at
      : `${raw.updated_at}:${raw.content_version}`
  }
  async issues(state: string, cursor?: string, query?: string) {
    const selected = z.enum(['open', 'closed', 'all']).parse(state),
      page = workPage(cursor)
    if (query?.trim() && this.provider === 'github') {
      // Quote user words, so repository/state scope cannot be overridden by a
      // pasted GitHub search qualifier.
      const text = query
        .trim()
        .split(/\s+/)
        .map((word) => JSON.stringify(word))
        .join(' ')
      const search = `repo:${this.repository} is:issue${selected === 'all' ? '' : ` is:${selected}`} ${text}`
      const result = z
        .object({ items: z.array(issue), total_count: z.number() })
        .parse(
          await this.http.json(
            `search/issues?q=${encodeURIComponent(search)}&sort=updated&order=desc&per_page=30&page=${page}`,
          ),
        )
      return {
        items: result.items.filter((v) => !v.pull_request).map((v) => this.normalize(v)),
        next: page * 30 < Math.min(result.total_count, 1000) ? String(page + 1) : undefined,
      }
    }
    const values = z
      .array(issue)
      .parse(
        await this.get(
          `issues?state=${selected}&${this.provider === 'github' ? 'per_page' : 'limit'}=30&page=${page}${this.provider === 'github' ? '&sort=updated&direction=desc' : this.provider === 'forgejo' ? '&type=issues&sort=recentupdate' : '&type=issues'}${query?.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`,
        ),
      )
    return {
      items: values.filter((v) => !v.pull_request).map((v) => this.normalize(v)),
      next: values.length === 30 ? String(page + 1) : undefined,
    }
  }
  async issue(id: string, cursor?: string) {
    const n = z.coerce.number().int().positive().parse(id),
      page = workPage(cursor)
    const raw = issue.parse(await this.get(`issues/${n}`))
    if (raw.pull_request) throw new HttpError(400, 'This item is a pull request. Use the PR view.')
    const comments = z
      .array(comment)
      .parse(
        await this.get(
          `issues/${n}/comments?${this.provider === 'github' ? 'per_page' : 'limit'}=50&page=${page}`,
        ),
      )
    return {
      issue: this.normalize(raw),
      comments: comments.map((v) => ({
        id: String(v.id),
        body: v.body,
        author: v.user?.login ?? 'Deleted user',
        createdAt: v.created_at,
        url: v.html_url,
        bodyFormat: 'markdown' as const,
      })),
      next: comments.length === 50 ? String(page + 1) : undefined,
    }
  }
  async createIssue(input: ForgeIssueCreate) {
    if (input.labels.length && this.provider !== 'github')
      throw new HttpError(
        400,
        'Manage repository label IDs on the server; label names cannot be sent to this API.',
      )
    const value = issue.parse(
      await this.get('issues', {
        method: 'POST',
        body: {
          title: input.title,
          body: input.body,
          assignees: input.assignees,
          ...(this.provider === 'github' ? { labels: input.labels } : {}),
        },
      }),
    )
    return { id: String(value.number), url: value.html_url, message: 'Issue created' }
  }
  async actOnIssue(input: ForgeIssueAction) {
    const id = z.coerce.number().int().positive().parse(input.id)
    const current = issue.parse(await this.get(`issues/${id}`))
    if (current.pull_request) throw new HttpError(400, 'Use the PR view for this item')
    if (this.revision(current) !== input.revision)
      throw new HttpError(409, 'This issue changed. Refresh before submitting your changes.')
    if (input.action === 'comment')
      await this.get(`issues/${id}/comments`, { method: 'POST', body: { body: input.body } })
    else {
      if (input.state) z.enum(['open', 'closed']).parse(input.state)
      if (input.labels !== undefined && this.provider !== 'github')
        throw new HttpError(400, 'Editing label names is unavailable for this server')
      await this.get(`issues/${id}`, {
        method: 'PATCH',
        body: {
          title: input.title,
          body: input.body,
          state: input.state,
          assignees: input.assignees,
          labels: input.labels,
          ...(current.content_version === undefined
            ? {}
            : { content_version: current.content_version }),
        },
      })
    }
    return {
      id: String(id),
      url: current.html_url,
      message: input.action === 'comment' ? 'Comment posted' : 'Issue updated',
    }
  }
  private normalizeRun(value: z.infer<typeof run>): ForgePipeline {
    return {
      id: String(value.id),
      title: value.display_title || value.title || value.name || `Run ${value.id}`,
      url: value.html_url,
      ref: value.head_branch ?? value.prettyref ?? '',
      sha: value.head_sha ?? value.commit_sha ?? '',
      actor: value.actor?.login ?? value.trigger_user?.login ?? '',
      status: value.conclusion || value.status,
      createdAt: value.created_at ?? value.created ?? value.started_at ?? '',
      updatedAt:
        value.updated_at ??
        value.updated ??
        value.completed_at ??
        value.created_at ??
        value.created ??
        value.started_at ??
        '',
      definition:
        value.workflow_id == null ? value.path?.split('/').at(-1) : String(value.workflow_id),
      number:
        value.run_number == null && value.index_in_repo == null
          ? undefined
          : String(value.run_number ?? value.index_in_repo),
      attempt: value.run_attempt && value.run_attempt > 0 ? value.run_attempt : undefined,
      event: value.trigger_event || value.event || undefined,
      workflow:
        value.name ||
        value.path?.split('/').at(-1) ||
        (typeof value.workflow_id === 'string' ? value.workflow_id : undefined),
      commitMessage: value.head_commit?.message || undefined,
      startedAt: pipelineTime(value.run_started_at || value.started_at || value.started),
      completedAt: pipelineTime(value.completed_at || value.stopped),
    }
  }
  async definitions(cursor?: string) {
    if (this.provider === 'forgejo')
      return {
        items: [],
        manual: true,
        hint: 'Enter the workflow filename from .forgejo/workflows, for example ci.yaml. The workflow must declare workflow_dispatch.',
      }
    const page = workPage(cursor)
    const raw = z
      .object({
        workflows: z.array(
          z.object({
            id: z.union([z.string(), z.number()]),
            name: z.string(),
            state: z.string().optional(),
          }),
        ),
      })
      .parse(
        await this.get(
          `actions/workflows${this.provider === 'github' ? `?per_page=30&page=${page}` : ''}`,
        ),
      )
    return {
      items: raw.workflows.map((v) => ({ ...v, id: String(v.id) })),
      // Gitea returns all workflows; it has no page/limit contract for this endpoint.
      next:
        this.provider === 'github' && raw.workflows.length === 30 ? String(page + 1) : undefined,
      manual: false,
    }
  }
  async pipelines(cursor?: string) {
    const page = workPage(cursor)
    const data = await this.get(
      `actions/runs?${this.provider === 'github' ? 'per_page' : 'limit'}=30&page=${page}`,
    )
    const raw = z.object({ workflow_runs: z.array(run) }).parse(data).workflow_runs
    return {
      items: raw.map((v) => this.normalizeRun(v)),
      next: raw.length === 30 ? String(page + 1) : undefined,
    }
  }
  async pipeline(id: string, cursor?: string) {
    const n = z.coerce.number().int().positive().parse(id),
      page = workPage(cursor)
    const current = run.parse(await this.get(`actions/runs/${n}`))
    const data = await this.get(
      `actions/runs/${n}/jobs?${this.provider === 'github' ? 'per_page' : 'limit'}=50&page=${page}`,
    )
    const jobs =
      this.provider === 'forgejo'
        ? z.array(job).parse(data)
        : z.object({ jobs: z.array(job) }).parse(data).jobs
    return {
      run: this.normalizeRun(current),
      jobs: jobs.map((v) => ({
        id: String(v.id),
        name: v.name,
        status: v.conclusion || v.status,
        url: v.html_url || current.html_url,
        runner: v.runner_name || undefined,
        startedAt: pipelineTime(v.started_at),
        completedAt: pipelineTime(v.completed_at),
        steps: v.steps?.map((step) => ({
          id: String(step.number),
          number: step.number,
          name: step.name,
          status: step.conclusion || step.status,
          startedAt: pipelineTime(step.started_at),
          completedAt: pipelineTime(step.completed_at),
        })),
      })),
      next: jobs.length === 50 && this.provider !== 'forgejo' ? String(page + 1) : undefined,
    }
  }
  async actOnPipeline(input: ForgePipelineAction) {
    const capabilities = await this.options()
    if (!capabilities.pipelineActions.includes(input.action))
      throw new HttpError(
        400,
        capabilities.pipelineNotice ?? 'This pipeline action is unavailable on this provider',
      )
    if (input.action === 'run') {
      await this.get(`actions/workflows/${encodeURIComponent(input.definition)}/dispatches`, {
        method: 'POST',
        body: { ref: input.ref, inputs: input.inputs },
      })
      return { message: 'Workflow dispatch accepted. Refresh runs to see its status.' }
    }
    if (input.action === 'enable' || input.action === 'disable') {
      await this.get(`actions/workflows/${encodeURIComponent(input.id)}/${input.action}`, {
        method: 'PUT',
      })
      return { message: `Workflow ${input.action === 'enable' ? 'enabled' : 'disabled'}` }
    }
    const id = z.coerce.number().int().positive().parse(input.id)
    const current = run.parse(await this.get(`actions/runs/${id}`))
    if (!pipelineActionAllowed(input.action, current.status))
      throw new HttpError(
        409,
        'This run cannot be changed in its current state. Refresh its status.',
      )
    await this.get(`actions/runs/${id}/${input.action}`, { method: 'POST' })
    return {
      id: String(id),
      url: current.html_url,
      message: input.action === 'cancel' ? 'Cancellation requested' : 'Rerun requested',
    }
  }
}
