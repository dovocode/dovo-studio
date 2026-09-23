import { mutableStruct, mutableArray, CoercedNumber } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { Schema } from 'effect'
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
const person = mutableStruct({
  displayName: Schema.String,
  uniqueName: Schema.optional(Schema.String),
})
const item = mutableStruct({
  id: Schema.Number.pipe(Schema.finite()),
  rev: Schema.Number.pipe(Schema.finite()),
  fields: mutableStruct({
    'System.Title': Schema.String,
    'System.TeamProject': Schema.String,
    'System.State': Schema.String,
    'System.WorkItemType': Schema.String,
    'System.Description': Schema.optional(Schema.String),
    'System.AssignedTo': Schema.optional(person),
    'System.CreatedBy': Schema.optional(person),
    'System.ChangedDate': Schema.String,
    'System.Tags': Schema.optional(Schema.String),
  }),
  multilineFieldsFormat: Schema.optional(
    Schema.mutable(
      Schema.Record({
        key: Schema.String,
        value: Schema.String,
      }),
    ),
  ),
})
const build = mutableStruct({
  id: Schema.Number.pipe(Schema.finite()),
  buildNumber: Schema.String,
  status: Schema.String,
  result: Schema.optional(Schema.String),
  sourceBranch: Schema.optional(Schema.String),
  sourceVersion: Schema.optional(Schema.String),
  queueTime: Schema.String,
  startTime: Schema.optional(Schema.NullOr(Schema.String)),
  finishTime: Schema.optional(Schema.NullOr(Schema.String)),
  reason: Schema.optional(Schema.NullOr(Schema.String)),
  requestedFor: Schema.optional(person),
  definition: mutableStruct({
    id: Schema.Number.pipe(Schema.finite()),
    name: Schema.String,
  }),
})
const markdown = new TurndownService({
  codeBlockStyle: 'fenced',
})
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
        : decode(
            mutableStruct({
              value: mutableArray(
                mutableStruct({
                  name: Schema.String,
                  isDisabled: Schema.optional(Schema.Boolean),
                }),
              ),
            }),
            await this.get('wit/workitemtypes'),
          )
            .value.filter((v) => !v.isDisabled)
            .map((v) => v.name)
    let states: string[] = []
    if (type) {
      if (!types.includes(type))
        throw new HttpError(400, 'Select a work item type available in this project')
      states = decode(
        mutableStruct({
          value: mutableArray(
            mutableStruct({
              name: Schema.String,
            }),
          ),
        }),
        await this.get(`wit/workitemtypes/${encodeURIComponent(type)}/states`),
      ).value.map((v) => v.name)
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
  private normalize(value: Schema.Schema.Type<typeof item>): ForgeIssue {
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
    const before = cursor
      ? decode(
          CoercedNumber.pipe(
            Schema.int(),
            Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
          ).pipe(Schema.positive()),
          cursor,
        )
      : undefined
    // Project/state values are WIQL literals, never fragments of query syntax.
    const quote = (v: string) => `'${v.replaceAll("'", "''")}'`
    const filter = state === 'all' ? '' : ` AND [System.State] = ${quote(state)}`
    const text = query?.trim()
    const search = !text
      ? ''
      : /^#?\d+$/.test(text)
        ? ` AND [System.Id] = ${Number(text.replace(/^#/, ''))}`
        : ` AND ([System.Title] CONTAINS ${quote(text)} OR [System.Description] CONTAINS ${quote(text)})`
    const data = decode(
      mutableStruct({
        workItems: mutableArray(
          mutableStruct({
            id: Schema.Number.pipe(Schema.finite()),
          }),
        ),
      }),
      await this.get('wit/wiql?$top=31', {
        method: 'POST',
        body: {
          query: `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = ${quote(this.projectName)}${filter}${search}${before ? ` AND [System.Id] < ${before}` : ''} ORDER BY [System.Id] DESC`,
        },
      }),
    )
    const ids = data.workItems.slice(0, 30).map((v) => v.id)
    const values = ids.length
      ? decode(
          mutableStruct({
            value: mutableArray(item),
          }),
          await this.get(`wit/workitems?ids=${ids.join(',')}`),
        ).value
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
    const n = decode(
      CoercedNumber.pipe(
        Schema.int(),
        Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      ).pipe(Schema.positive()),
      id,
    )
    const raw = decode(item, await this.get(`wit/workitems/${n}`)),
      current = this.normalize(raw)
    const comments = decode(
      mutableStruct({
        comments: mutableArray(
          mutableStruct({
            id: Schema.Number.pipe(Schema.finite()),
            text: Schema.String,
            createdBy: person,
            createdDate: Schema.String,
            format: Schema.optional(
              Schema.Union(Schema.String, Schema.Number.pipe(Schema.finite())),
            ),
          }),
        ),
        continuationToken: Schema.optional(Schema.NullOr(Schema.String)),
      }),
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
      ...(input.assignees[0]
        ? {
            'System.AssignedTo': input.assignees[0],
          }
        : {}),
    }
    const result = decode(
      item,
      await this.get(`wit/workitems/$${encodeURIComponent(input.type)}`, {
        method: 'POST',
        contentType: 'application/json-patch+json',
        body: [
          ...Object.entries(fields).map(([name, value]) => ({
            op: 'add',
            path: `/fields/${name}`,
            value,
          })),
          {
            op: 'add',
            path: '/multilineFieldsFormat/System.Description',
            value: 'Markdown',
          },
        ],
      }),
    )
    return {
      id: String(result.id),
      url: this.normalize(result).url,
      message: 'Work item created',
    }
  }
  async actOnIssue(input: ForgeIssueAction) {
    const id = decode(
        CoercedNumber.pipe(
          Schema.int(),
          Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        ).pipe(Schema.positive()),
        input.id,
      ),
      raw = decode(item, await this.get(`wit/workitems/${id}`)),
      current = this.normalize(raw)
    if (current.revision !== input.revision)
      throw new HttpError(409, 'This work item changed. Refresh before submitting.')
    if (input.action === 'comment')
      await this.get(
        `wit/workItems/${id}/comments?format=markdown`,
        {
          method: 'POST',
          body: {
            text: input.body,
          },
        },
        '7.1-preview.4',
      )
    else {
      if (input.assignees && input.assignees.length > 1)
        throw new HttpError(400, 'Azure work items support one assignee')
      if (input.state && !(await this.options(current.type)).issueStates.includes(input.state))
        throw new HttpError(400, 'This state is unavailable for this work item type')
      const fields: Record<string, unknown> = {
        ...(input.title === undefined
          ? {}
          : {
              'System.Title': input.title,
            }),
        ...(input.body === undefined
          ? {}
          : {
              'System.Description': input.body,
            }),
        ...(input.state === undefined
          ? {}
          : {
              'System.State': input.state,
            }),
        ...(input.assignees === undefined
          ? {}
          : {
              'System.AssignedTo': input.assignees[0] ?? '',
            }),
        ...(input.labels === undefined
          ? {}
          : {
              'System.Tags': input.labels.join('; '),
            }),
      }
      await this.get(`wit/workitems/${id}`, {
        method: 'PATCH',
        contentType: 'application/json-patch+json',
        body: [
          {
            op: 'test',
            path: '/rev',
            value: raw.rev,
          },
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
  private normalizeRun(value: Schema.Schema.Type<typeof build>): ForgePipeline {
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
      items: decode(
        mutableStruct({
          value: mutableArray(
            mutableStruct({
              id: Schema.Number.pipe(Schema.finite()),
              name: Schema.String,
              queueStatus: Schema.optional(Schema.String),
            }),
          ),
        }),
        data,
      ).value.map((v) => ({
        id: String(v.id),
        name: v.name,
        state: v.queueStatus,
      })),
      next,
      manual: false,
    }
  }
  async pipelines(cursor?: string) {
    const { data, next } = await this.page('builds', cursor)
    return {
      items: decode(
        mutableStruct({
          value: mutableArray(build),
        }),
        data,
      ).value.map((v) => this.normalizeRun(v)),
      next,
    }
  }
  async pipeline(id: string) {
    const n = decode(
        CoercedNumber.pipe(
          Schema.int(),
          Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        ).pipe(Schema.positive()),
        id,
      ),
      current = decode(build, await this.get(`build/builds/${n}`))
    const timeline = decode(
      mutableStruct({
        records: mutableArray(
          mutableStruct({
            id: Schema.String,
            name: Schema.optional(Schema.NullOr(Schema.String)),
            type: Schema.String,
            state: Schema.String,
            result: Schema.optional(Schema.NullOr(Schema.String)),
            parentId: Schema.optional(Schema.NullOr(Schema.String)),
            order: Schema.optional(
              Schema.NullOr(
                Schema.Number.pipe(Schema.finite())
                  .pipe(
                    Schema.int(),
                    Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
                  )
                  .pipe(Schema.nonNegative()),
              ),
            ),
            startTime: Schema.optional(Schema.NullOr(Schema.String)),
            finishTime: Schema.optional(Schema.NullOr(Schema.String)),
            workerName: Schema.optional(Schema.NullOr(Schema.String)),
            issues: Schema.optional(
              Schema.NullOr(
                mutableArray(
                  mutableStruct({
                    type: Schema.String,
                    message: Schema.String,
                  }),
                ),
              ),
            ),
          }),
        ),
      }),
      await this.get(`build/builds/${n}/timeline`),
    )
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
      const id = decode(
        CoercedNumber.pipe(
          Schema.int(),
          Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        ).pipe(Schema.positive()),
        input.definition,
      )
      const value = decode(
        build,
        await this.get('build/builds', {
          method: 'POST',
          body: {
            definition: {
              id,
            },
            sourceBranch: input.ref.startsWith('refs/') ? input.ref : `refs/heads/${input.ref}`,
            templateParameters: input.inputs,
          },
        }),
      )
      return {
        id: String(value.id),
        url: this.normalizeRun(value).url,
        message: 'Build queued',
      }
    }
    if (input.action === 'enable' || input.action === 'disable')
      throw new HttpError(400, 'Manage Azure pipeline definitions on the server')
    const id = decode(
      CoercedNumber.pipe(
        Schema.int(),
        Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      ).pipe(Schema.positive()),
      input.id,
    )
    const current = decode(build, await this.get(`build/builds/${id}`))
    if (!pipelineActionAllowed(input.action, current.status))
      throw new HttpError(
        409,
        'This build cannot be changed in its current state. Refresh its status.',
      )
    await this.get(`build/builds/${id}${input.action === 'rerun' ? '?retry=true' : ''}`, {
      method: 'PATCH',
      body:
        input.action === 'cancel'
          ? {
              status: 'cancelling',
            }
          : {},
    })
    return {
      id: String(id),
      url: this.normalizeRun(current).url,
      message: input.action === 'cancel' ? 'Cancellation requested' : 'Retry requested',
    }
  }
}
