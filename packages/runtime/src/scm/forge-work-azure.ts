import { z } from 'zod'
import TurndownService from 'turndown'
import { pipelineActionAllowed } from '@dovo/protocol'
import type {
  ForgeIssue,
  ForgeIssueCreate,
  ForgeIssueAction,
  ForgePipeline,
  ForgePipelineAction,
  ForgeWorkOptions,
} from '@dovo/protocol'
import type { ForgeWorkProvider } from './forge-work-types.js'
import type { ForgeHttp } from './forge-http.js'
import { HttpError } from '../errors.js'
import { pipelineErrors, pipelineTime } from './forge-work-details.js'
const person = z.object({ displayName: z.string(), uniqueName: z.string().optional() })
const item = z.object({
  id: z.number(),
  rev: z.number(),
  fields: z.object({
    'System.Title': z.string(),
    'System.TeamProject': z.string(),
    'System.State': z.string(),
    'System.WorkItemType': z.string(),
    'System.Description': z.string().optional(),
    'System.AssignedTo': person.optional(),
    'System.CreatedBy': person.optional(),
    'System.ChangedDate': z.string(),
    'System.Tags': z.string().optional(),
  }),
  multilineFieldsFormat: z.record(z.string(), z.string()).optional(),
})
const build = z.object({
  id: z.number(),
  buildNumber: z.string(),
  status: z.string(),
  result: z.string().optional(),
  sourceBranch: z.string().optional(),
  sourceVersion: z.string().optional(),
  queueTime: z.string(),
  startTime: z.string().nullish(),
  finishTime: z.string().nullish(),
  reason: z.string().nullish(),
  requestedFor: person.optional(),
  definition: z.object({ id: z.number(), name: z.string() }),
})
const markdown = new TurndownService({ codeBlockStyle: 'fenced' })
export class AzureForgeWork implements ForgeWorkProvider {
  private project: string
  private projectName: string
  private root: string
  constructor(
    private http: Pick<ForgeHttp, 'json' | 'jsonResponse' | 'connection'>,
    repository: string,
  ) {
    this.projectName = repository.split('/')[0]!
    this.project = encodeURIComponent(this.projectName)
    this.root = `${http.connection.baseUrl}/${this.project}`
  }
  private get(path: string, options?: Parameters<ForgeHttp['json']>[1], version = '7.1') {
    return this.http.json(
      `${this.project}/_apis/${path}${path.includes('?') ? '&' : '?'}api-version=${version}`,
      options,
    )
  }
  async options(type?: string, area?: string): Promise<ForgeWorkOptions> {
    const types =
      area === 'pipelines'
        ? []
        : z
            .object({
              value: z.array(z.object({ name: z.string(), isDisabled: z.boolean().optional() })),
            })
            .parse(await this.get('wit/workitemtypes'))
            .value.filter((v) => !v.isDisabled)
            .map((v) => v.name)
    let states: string[] = []
    if (type) {
      if (!types.includes(type))
        throw new HttpError(400, 'Select a work item type available in this project')
      states = z
        .object({ value: z.array(z.object({ name: z.string() })) })
        .parse(await this.get(`wit/workitemtypes/${encodeURIComponent(type)}/states`))
        .value.map((v) => v.name)
    }
    return {
      provider: 'azure-devops',
      issues: true,
      issueNotice:
        'Azure work items and build pipelines belong to the project, not only this Git repository.',
      issueTypes: types,
      issueStates: states,
      issueSearch: true,
      assignees: true,
      labels: true,
      pipelines: true,
      pipelineActions: ['run', 'rerun', 'cancel'],
    }
  }
  private normalize(value: z.infer<typeof item>): ForgeIssue {
    if (
      value.fields['System.TeamProject'].toLocaleLowerCase() !==
      this.projectName.toLocaleLowerCase()
    )
      throw new HttpError(400, 'This work item belongs to another project')
    const fields = value.fields,
      body = fields['System.Description'] ?? '',
      format =
        value.multilineFieldsFormat?.['System.Description']?.toLowerCase() === 'markdown'
          ? 'markdown'
          : 'html'
    return {
      id: String(value.id),
      title: fields['System.Title'],
      body,
      preview: format === 'html' ? markdown.turndown(body) : body,
      bodyFormat: format,
      state: fields['System.State'],
      type: fields['System.WorkItemType'],
      url: `${this.root}/_workitems/edit/${value.id}`,
      author: fields['System.CreatedBy']?.displayName ?? '',
      assignees: fields['System.AssignedTo']
        ? [fields['System.AssignedTo'].uniqueName ?? fields['System.AssignedTo'].displayName]
        : [],
      assigneeNames: fields['System.AssignedTo'] ? [fields['System.AssignedTo'].displayName] : [],
      labels: (fields['System.Tags'] ?? '')
        .split(';')
        .map((v) => v.trim())
        .filter(Boolean),
      updatedAt: fields['System.ChangedDate'],
      revision: String(value.rev),
    }
  }
  async issues(state: string, cursor?: string, query?: string) {
    const before = cursor ? z.coerce.number().int().positive().parse(cursor) : undefined
    // Project/state values are WIQL literals, never fragments of query syntax.
    const quote = (v: string) => `'${v.replaceAll("'", "''")}'`
    const filter = state === 'all' ? '' : ` AND [System.State] = ${quote(state)}`
    const text = query?.trim()
    const search = !text
      ? ''
      : /^#?\d+$/.test(text)
        ? ` AND [System.Id] = ${Number(text.replace(/^#/, ''))}`
        : ` AND ([System.Title] CONTAINS ${quote(text)} OR [System.Description] CONTAINS ${quote(text)})`
    const data = z.object({ workItems: z.array(z.object({ id: z.number() })) }).parse(
      await this.get('wit/wiql?$top=31', {
        method: 'POST',
        body: {
          query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = ${quote(this.projectName)}${filter}${search}${before ? ` AND [System.Id] < ${before}` : ''} ORDER BY [System.Id] DESC`,
        },
      }),
    )
    const ids = data.workItems.slice(0, 30).map((v) => v.id)
    const values = ids.length
      ? z
          .object({ value: z.array(item) })
          .parse(await this.get(`wit/workitems?ids=${ids.join(',')}`)).value
      : []
    const byId = new Map(values.map((value) => [value.id, value]))
    return {
      // The batch endpoint does not promise to preserve the WIQL result order.
      items: ids.flatMap((id) => {
        const value = byId.get(id)
        return value ? [this.normalize(value)] : []
      }),
      next: data.workItems.length > 30 ? String(ids.at(-1)) : undefined,
    }
  }
  async issue(id: string, cursor?: string) {
    const n = z.coerce.number().int().positive().parse(id)
    const raw = item.parse(await this.get(`wit/workitems/${n}`)),
      current = this.normalize(raw)
    const comments = z
      .object({
        comments: z.array(
          z.object({
            id: z.number(),
            text: z.string(),
            createdBy: person,
            createdDate: z.string(),
            format: z.union([z.string(), z.number()]).optional(),
          }),
        ),
        continuationToken: z.string().nullish(),
      })
      .parse(
        await this.get(
          `wit/workItems/${n}/comments?$top=50${cursor ? `&continuationToken=${encodeURIComponent(cursor)}` : ''}`,
          undefined,
          '7.1-preview.4',
        ),
      )
    return {
      issue: current,
      comments: comments.comments.map((v) => ({
        id: String(v.id),
        body: v.format === 0 || v.format === 'markdown' ? v.text : markdown.turndown(v.text),
        author: v.createdBy.displayName,
        createdAt: v.createdDate,
        bodyFormat: 'markdown' as const,
        url: current.url,
      })),
      next: comments.continuationToken || undefined,
    }
  }
  async createIssue(input: ForgeIssueCreate) {
    const options = await this.options(input.type)
    if (!options.issueTypes.includes(input.type))
      throw new HttpError(400, 'Select an available work item type')
    if (input.assignees.length > 1)
      throw new HttpError(400, 'Azure work items support one assignee')
    const fields: Record<string, unknown> = {
      'System.Title': input.title,
      'System.Description': input.body,
      'System.Tags': input.labels.join('; '),
      ...(input.assignees[0] ? { 'System.AssignedTo': input.assignees[0] } : {}),
    }
    const result = item.parse(
      await this.get(`wit/workitems/$${encodeURIComponent(input.type)}`, {
        method: 'POST',
        contentType: 'application/json-patch+json',
        body: [
          ...Object.entries(fields).map(([name, value]) => ({
            op: 'add',
            path: `/fields/${name}`,
            value,
          })),
          { op: 'add', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' },
        ],
      }),
    )
    return { id: String(result.id), url: this.normalize(result).url, message: 'Work item created' }
  }
  async actOnIssue(input: ForgeIssueAction) {
    const id = z.coerce.number().int().positive().parse(input.id),
      raw = item.parse(await this.get(`wit/workitems/${id}`)),
      current = this.normalize(raw)
    if (current.revision !== input.revision)
      throw new HttpError(409, 'This work item changed. Refresh before submitting.')
    if (input.action === 'comment')
      await this.get(
        `wit/workItems/${id}/comments?format=markdown`,
        { method: 'POST', body: { text: input.body } },
        '7.1-preview.4',
      )
    else {
      if (input.assignees && input.assignees.length > 1)
        throw new HttpError(400, 'Azure work items support one assignee')
      if (input.state && !(await this.options(current.type)).issueStates.includes(input.state))
        throw new HttpError(400, 'This state is unavailable for this work item type')
      const fields: Record<string, unknown> = {
        ...(input.title === undefined ? {} : { 'System.Title': input.title }),
        ...(input.body === undefined ? {} : { 'System.Description': input.body }),
        ...(input.state === undefined ? {} : { 'System.State': input.state }),
        ...(input.assignees === undefined ? {} : { 'System.AssignedTo': input.assignees[0] ?? '' }),
        ...(input.labels === undefined ? {} : { 'System.Tags': input.labels.join('; ') }),
      }
      await this.get(`wit/workitems/${id}`, {
        method: 'PATCH',
        contentType: 'application/json-patch+json',
        body: [
          { op: 'test', path: '/rev', value: raw.rev },
          ...Object.entries(fields).map(([key, value]) => ({
            op: 'add',
            path: `/fields/${key}`,
            value,
          })),
        ],
      })
    }
    return {
      id: String(id),
      url: current.url,
      message: input.action === 'comment' ? 'Comment posted' : 'Work item updated',
    }
  }
  private normalizeRun(value: z.infer<typeof build>): ForgePipeline {
    return {
      id: String(value.id),
      title: `${value.definition.name} · ${value.buildNumber}`,
      definition: String(value.definition.id),
      url: `${this.root}/_build/results?buildId=${value.id}`,
      ref: value.sourceBranch ?? '',
      sha: value.sourceVersion ?? '',
      actor: value.requestedFor?.displayName ?? '',
      status: value.result || value.status,
      createdAt: value.queueTime,
      updatedAt: value.finishTime ?? value.queueTime,
      number: value.buildNumber,
      workflow: value.definition.name,
      event: value.reason || undefined,
      startedAt: pipelineTime(value.startTime),
      completedAt: pipelineTime(value.finishTime),
    }
  }
  private async page(path: string, cursor?: string) {
    const response = await this.http.jsonResponse(
      `${this.project}/_apis/build/${path}?$top=30&api-version=7.1${cursor ? `&continuationToken=${encodeURIComponent(cursor)}` : ''}`,
    )
    return {
      data: response.data,
      next: response.headers.get('x-ms-continuationtoken') || undefined,
    }
  }
  async definitions(cursor?: string) {
    const { data, next } = await this.page('definitions', cursor)
    return {
      items: z
        .object({
          value: z.array(
            z.object({ id: z.number(), name: z.string(), queueStatus: z.string().optional() }),
          ),
        })
        .parse(data)
        .value.map((v) => ({ id: String(v.id), name: v.name, state: v.queueStatus })),
      next,
      manual: false,
    }
  }
  async pipelines(cursor?: string) {
    const { data, next } = await this.page('builds', cursor)
    return {
      items: z
        .object({ value: z.array(build) })
        .parse(data)
        .value.map((v) => this.normalizeRun(v)),
      next,
    }
  }
  async pipeline(id: string) {
    const n = z.coerce.number().int().positive().parse(id),
      current = build.parse(await this.get(`build/builds/${n}`))
    const timeline = z
      .object({
        records: z.array(
          z.object({
            id: z.string(),
            name: z.string().nullish(),
            type: z.string(),
            state: z.string(),
            result: z.string().nullish(),
            parentId: z.string().nullish(),
            order: z.number().int().nonnegative().nullish(),
            startTime: z.string().nullish(),
            finishTime: z.string().nullish(),
            workerName: z.string().nullish(),
            issues: z.array(z.object({ type: z.string(), message: z.string() })).nullish(),
          }),
        ),
      })
      .parse(await this.get(`build/builds/${n}/timeline`))
    const run = this.normalizeRun(current)
    return {
      run,
      jobs: timeline.records
        .filter((v) => v.type === 'Job')
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((v) => ({
          id: v.id,
          name: v.name || v.id,
          status: v.result || v.state,
          url: `${run.url}&view=logs&j=${encodeURIComponent(v.id)}`,
          runner: v.workerName || undefined,
          startedAt: pipelineTime(v.startTime),
          completedAt: pipelineTime(v.finishTime),
          errors: pipelineErrors(
            v.issues
              ?.filter((issue) => issue.type.toLowerCase() === 'error')
              .map((issue) => issue.message),
          ),
          steps: timeline.records
            .filter((record) => record.type === 'Task' && record.parentId === v.id)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
            .map((record) => ({
              id: record.id,
              name: record.name || record.id,
              status: record.result || record.state,
              number: record.order ?? undefined,
              startedAt: pipelineTime(record.startTime),
              completedAt: pipelineTime(record.finishTime),
              url: `${run.url}&view=logs&j=${encodeURIComponent(v.id)}&t=${encodeURIComponent(record.id)}`,
              errors: pipelineErrors(
                record.issues
                  ?.filter((issue) => issue.type.toLowerCase() === 'error')
                  .map((issue) => issue.message),
              ),
            })),
        })),
    }
  }
  async actOnPipeline(input: ForgePipelineAction) {
    if (input.action === 'run') {
      const id = z.coerce.number().int().positive().parse(input.definition)
      const value = build.parse(
        await this.get('build/builds', {
          method: 'POST',
          body: {
            definition: { id },
            sourceBranch: input.ref.startsWith('refs/') ? input.ref : `refs/heads/${input.ref}`,
            templateParameters: input.inputs,
          },
        }),
      )
      return { id: String(value.id), url: this.normalizeRun(value).url, message: 'Build queued' }
    }
    if (input.action === 'enable' || input.action === 'disable')
      throw new HttpError(400, 'Manage Azure pipeline definitions on the server')
    const id = z.coerce.number().int().positive().parse(input.id)
    const current = build.parse(await this.get(`build/builds/${id}`))
    if (!pipelineActionAllowed(input.action, current.status))
      throw new HttpError(
        409,
        'This build cannot be changed in its current state. Refresh its status.',
      )
    await this.get(`build/builds/${id}${input.action === 'rerun' ? '?retry=true' : ''}`, {
      method: 'PATCH',
      body: input.action === 'cancel' ? { status: 'cancelling' } : {},
    })
    return {
      id: String(id),
      url: this.normalizeRun(current).url,
      message: input.action === 'cancel' ? 'Cancellation requested' : 'Retry requested',
    }
  }
}
