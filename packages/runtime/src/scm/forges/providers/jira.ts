import { jiraRead } from '../../../retrieval/request.js'
import { retrievalContext, type RetrievalHook } from '../../../retrieval/context.js'
import { createHash } from 'node:crypto'
import { captureJiraContext, type JiraCliContext } from './jira-context.js'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { markdownToAdf } from 'marklassian'
import { mutableStruct, mutableArray, CoercedNumber } from '@dovo/protocol'
import { urlSchema, decodeResult, decode, minValue, maxValue } from '@dovo/protocol'
import { Schema } from 'effect'
import { createRequire } from 'node:module'
import Ajv from 'ajv-draft-04'
import { fromADF } from 'mdast-util-from-adf'
import { toMarkdown } from 'mdast-util-to-markdown'
import { gfmToMarkdown } from 'mdast-util-gfm'
import type {
  JiraBinding,
  JiraIssueFilters,
  ForgeIssue,
  ForgeIssueSection,
  ForgeIssueDetail,
  ForgeIssueCreate,
  ForgeIssueAction,
  ForgeWorkOptions,
  ForgePipelineAction,
} from '@dovo/protocol'
import {
  jiraBindingSchema,
  jiraProjectsSchema,
  jiraIssueFiltersSchema,
  jiraBoardsSchema,
  jiraSprintsSchema,
  jiraNumericId,
} from '@dovo/protocol'
import type { ForgeWorkProvider } from '../../work/forge-work-types.js'
import { runForgeCli } from '../integration/forge-cli.js'
import { HttpError } from '../../../errors.js'
const require = createRequire(import.meta.url)
const adfRequire = createRequire(require.resolve('mdast-util-from-adf'))
const validateADF = new Ajv({
  strict: false,
}).compile<Parameters<typeof fromADF>[0]>(
  adfRequire('@atlaskit/adf-schema/json-schema/v1/full.json'),
)
export function jiraMarkdown(value: unknown) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (!validateADF(value))
    throw new HttpError(502, 'Jira returned an invalid rich-text document. Open this item in Jira.')
  try {
    return toMarkdown(fromADF(value), {
      extensions: [gfmToMarkdown()],
    })
  } catch {
    throw new HttpError(
      502,
      'This Jira document contains unsupported rich content. Open this item in Jira.',
    )
  }
}
const person = mutableStruct({
  displayName: Schema.String,
  accountId: Schema.optional(Schema.String),
})
const projectSchema = mutableStruct({
  key: Schema.String,
  self: urlSchema(),
  issueTypes: Schema.optional(
    Schema.NullOr(
      mutableArray(
        mutableStruct({
          name: Schema.String,
          subtask: Schema.optional(Schema.Boolean),
        }),
      ),
    ),
  ),
})
function jiraAccountSite(status: string) {
  const site = /^\s*Site:\s*(\S+)\s*$/m.exec(status)?.[1]
  const parsed = decodeResult(
    jiraBindingSchema.fields.site,
    site?.startsWith('https://') ? site : site ? `https://${site}` : undefined,
  )
  if (!parsed.success)
    throw new HttpError(
      502,
      'Could not identify the signed-in Jira site. Run acli jira auth login on this runtime, then try again.',
    )
  return new URL(parsed.data).origin
}
export async function listJiraProjects(
  executable: string,
  cwd?: string,
  run: typeof runForgeCli = runForgeCli,
) {
  const context = await captureJiraContext(executable, run, cwd)
  try {
    const status = await run(executable, ['jira', 'auth', 'status'], undefined, cwd, context.env)
    const site = jiraAccountSite(status)
    const email = /^\s*Email:\s*(\S+)\s*$/m.exec(status)?.[1]
    if (!email)
      throw new HttpError(
        409,
        'Could not verify the signed-in Jira account. Refresh the runtime login before browsing projects.',
      )
    await context.accountId(site, email)
    const projects = decode(
      mutableArray(
        mutableStruct({
          key: Schema.String,
          name: Schema.String,
        }),
      ),
      JSON.parse(
        await run(
          executable,
          ['jira', 'project', 'list', '--limit', '201', '--json'],
          undefined,
          cwd,
          context.env,
        ),
      ),
    )
    return decode(jiraProjectsSchema, {
      site,
      projects: projects.slice(0, 200),
      truncated: projects.length > 200,
    })
  } finally {
    await context.close()
  }
}

// ADF extensions are common (status pills, media, app blocks). Retain readable text
// when the Markdown converter cannot represent them; never hide the whole issue.
function jiraText(value: unknown): string {
  if (typeof value === 'string') return value
  const node = decodeResult(
    mutableStruct({
      type: Schema.optional(Schema.String),
      text: Schema.optional(Schema.String),
      attrs: Schema.optional(
        mutableStruct({
          text: Schema.optional(Schema.String),
          title: Schema.optional(Schema.String),
          url: Schema.optional(Schema.String),
        }),
      ),
      content: Schema.optional(mutableArray(Schema.Unknown)),
    }),
    value,
  )
  if (!node.success) return ''
  const data = node.data
  const text = data.text ?? data.attrs?.text ?? data.attrs?.title ?? data.attrs?.url
  if (text) return text
  if (data.type === 'hardBreak') return '\n'
  const content = (data.content ?? []).map(jiraText).join('')
  return (
    content +
    (['paragraph', 'heading', 'listItem', 'codeBlock', 'tableRow'].includes(data.type ?? '')
      ? '\n'
      : '')
  )
}
function renderJiraBody(value: unknown) {
  try {
    return {
      body: jiraMarkdown(value),
    }
  } catch (error) {
    if (!(error instanceof HttpError)) throw error
    return {
      body: jiraText(value)
        .trim()
        .replace(/[\\`*_{}[\]<>#|]/g, '\\$&'),
      bodyNotice:
        'Some rich content is shown as text. Open in Jira to see attachments and app content. Editing the description replaces that rich content.',
    }
  }
}
const rawComment = mutableStruct({
  id: Schema.String,
  body: Schema.Unknown,
  author: Schema.optional(Schema.NullOr(person)),
  created: Schema.String,
})
function normalizeComment(c: typeof rawComment.Type) {
  const rendered = renderJiraBody(c.body)
  return {
    id: c.id,
    body:
      rendered.body +
      (rendered.bodyNotice
        ? '\n\n_Some rich content is shown as text. Open in Jira for the original comment._'
        : ''),
    author: c.author?.displayName ?? 'Deleted user',
    createdAt: c.created,
    bodyFormat: 'markdown' as const,
  }
}
const rawIssue = mutableStruct({
  id: Schema.String,
  key: Schema.String,
  self: urlSchema(),
  fields: mutableStruct({
    summary: Schema.String,
    description: Schema.optional(Schema.Unknown),
    status: mutableStruct({
      name: Schema.String,
    }),
    issuetype: mutableStruct({
      name: Schema.String,
    }),
    priority: Schema.optional(Schema.NullOr(mutableStruct({ name: Schema.String }))),
    creator: Schema.optional(Schema.NullOr(person)),
    assignee: Schema.optional(Schema.NullOr(person)),
    labels: Schema.optional(mutableArray(Schema.String)),
    updated: Schema.optional(Schema.String),
    comment: Schema.optional(
      Schema.NullOr(
        mutableStruct({
          comments: mutableArray(rawComment),
          total: Schema.Number.pipe(Schema.check(Schema.isFinite())),
        }),
      ),
    ),
  }),
})

export function jiraOffset(cursor?: string) {
  return decode(
    maxValue(
      minValue(
        CoercedNumber.pipe(
          Schema.check(Schema.isInt()),
          Schema.check(
            Schema.isBetween({
              minimum: Number.MIN_SAFE_INTEGER,
              maximum: Number.MAX_SAFE_INTEGER,
            }),
          ),
        ),
        0,
      ),
      9990,
    ),
    cursor ?? '0',
  )
}
export function jiraIssuePage<T>(rows: readonly T[], offset: number) {
  return {
    items: rows.slice(offset, offset + 30),
    next: rows.length > offset + 30 && offset + 30 <= 9990 ? String(offset + 30) : undefined,
  }
}
export class JiraWork implements ForgeWorkProvider {
  retrieval?: RetrievalHook
  async retrievalReader() {
    return createHash('sha256')
      .update(JSON.stringify(['jira', new URL(this.binding.site).origin, await this.identity()]))
      .digest('hex')
  }
  async sharedRead(args: string[]) {
    if (!jiraRead(args)) throw new HttpError(400, 'Only Jira reads may be shared')
    return this.execute(args)
  }
  private context?: Promise<JiraCliContext>
  private closeRequested = false
  private leases = 1
  private account?: Promise<string>
  private verified?: Promise<Schema.Schema.Type<typeof projectSchema>>
  constructor(
    private executable: string,
    readonly binding: JiraBinding,
    private run: typeof runForgeCli = runForgeCli,
    private cwd?: string,
    private validateSource?: () => void,
  ) {
    this.binding = decode(jiraBindingSchema, binding)
  }
  private async execute(args: string[]) {
    if (this.leases === 0)
      throw new HttpError(409, 'The Jira operation ended. Refresh before continuing.')
    this.validateSource?.()
    const context = await (this.context ??= captureJiraContext(this.executable, this.run, this.cwd))
    this.validateSource?.()
    const dataCommand =
      args[0] === 'jira' && ['workitem', 'board', 'sprint'].includes(args[1] ?? '')
    if (dataCommand) await this.assertAccount()
    const load = () => this.run(this.executable, args, undefined, this.cwd, context.env)
    let result: string
    if (this.retrieval?.active() && dataCommand && !retrievalContext()?.local) {
      const reader = await this.retrievalReader()
      const instance = new URL(this.binding.site).origin
      if (jiraRead(args))
        result = await this.retrieval.read(
          { provider: 'jira', instance, project: this.binding.project, reader, args },
          load,
        )
      else {
        await this.retrieval.invalidate('jira', instance, reader)
        try {
          result = await load()
        } finally {
          await this.retrieval.invalidate('jira', instance, reader)
        }
      }
    } else result = await load()
    if (dataCommand) await this.assertAccount()
    this.validateSource?.()
    return result
  }
  /** Background cache refreshes retain their captured configuration until the load settles. */
  retain() {
    if (this.leases === 0)
      throw new HttpError(409, 'The Jira operation ended. Refresh before continuing.')
    this.leases++
    let released = false
    return async () => {
      if (released) return
      released = true
      await this.release()
    }
  }
  private async release() {
    this.leases--
    if (this.leases === 0 && this.context) {
      // A failed capture cleans itself up. Do not mask the original verification error.
      const context = await this.context.catch(() => undefined)
      await context?.close()
    }
  }
  async close() {
    if (this.closeRequested) return
    this.closeRequested = true
    await this.release()
  }
  private async json(args: string[]) {
    return JSON.parse(await this.execute(['jira', ...args, '--json'])) as unknown
  }
  async verify() {
    return (this.verified ??= this.verifyProject())
  }
  private async verifyProject() {
    this.account ??= this.execute(['jira', 'auth', 'status'])
    if (jiraAccountSite(await this.account) !== new URL(this.binding.site).origin)
      throw new HttpError(
        409,
        'The active acli account points to another Jira site. Switch the CLI account on the runtime, then refresh.',
      )
    // The context already loaded renewal state before this first authenticated status.
    // Verify the returned site/email against the exact captured account before API reads.
    await this.accountIdentity(await this.account)
    const project = decode(
      projectSchema,
      await this.json(['project', 'view', '--key', this.binding.project]),
    )
    if (project.key !== this.binding.project)
      throw new HttpError(409, 'Jira returned a different project. Refresh before continuing.')
    // OAuth responses use Atlassian's gateway in `self`, not the customer's site.
    // The authenticated account above is the authority; `self` is never requested.
    return project
  }
  async identity() {
    await this.verify()
    return this.accountIdentity(await this.account!)
  }
  private async accountIdentity(status: string) {
    const email = /^\s*Email:\s*(\S+)\s*$/m.exec(status)?.[1]?.toLowerCase()
    if (!email)
      throw new HttpError(
        409,
        'Could not verify the signed-in Jira account. Check acli jira auth status on the runtime and refresh.',
      )
    const context = await this.context
    if (!context)
      throw new HttpError(
        409,
        'The Jira account configuration is unavailable. Refresh before continuing.',
      )
    return JSON.stringify([
      jiraAccountSite(status),
      await context.accountId(jiraAccountSite(status), email),
    ])
  }
  async assertAccount() {
    await this.verify()
    const current = await this.execute(['jira', 'auth', 'status'])
    if (
      (await this.accountIdentity(current)) !== (await this.accountIdentity(await this.account!))
    ) {
      this.account = undefined
      this.verified = undefined
      throw new HttpError(
        409,
        'The active Jira site or account changed. Refresh before continuing.',
      )
    }
  }
  private async requirePinnedWrite() {
    // A previous detail verification never authorizes a write. Recheck the same captured
    // context freshly, then leave all mutation commands pinned to it.
    this.account = undefined
    this.verified = undefined
    await this.verify()
    await this.identity()
  }
  async revision() {
    await this.identity()
    const context = await this.context
    return context?.revision?.() ?? ''
  }
  async options(): Promise<ForgeWorkOptions> {
    const project = await this.verify()
    return {
      provider: 'jira',
      issues: true,
      issueNotice:
        'Jira Cloud · ' +
        this.binding.project +
        '. Uses the configured Jira account on this runtime. Rich text is preserved unless you edit the description.',
      issueTypes: (project.issueTypes ?? []).filter((v) => !v.subtask).map((v) => v.name),
      issueStates: [],
      issueSearch: true,
      assignees: true,
      labels: true,
      pipelines: false,
      pipelineActions: [],
    }
  }
  private check(raw: Pick<typeof rawIssue.Type, 'key'>) {
    if (!raw.key.startsWith(this.binding.project + '-'))
      throw new HttpError(409, 'Jira returned an item outside the selected project')
  }
  private key(value: string) {
    const key = decode(
      Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Z][A-Z0-9_]*-\d+$/))),
      value,
    )
    if (!key.startsWith(this.binding.project + '-'))
      throw new HttpError(400, 'The Jira issue belongs to another project')
    return key
  }
  private normalize(raw: Pick<typeof rawIssue.Type, 'key' | 'fields'>): ForgeIssue {
    this.check(raw)
    return {
      id: raw.key,
      title: raw.fields.summary,
      ...renderJiraBody(raw.fields.description),
      state: raw.fields.status.name,
      type: raw.fields.issuetype.name,
      ...(raw.fields.priority ? { priority: raw.fields.priority.name } : {}),
      url: new URL('/browse/' + raw.key, this.binding.site).href,
      author: raw.fields.creator?.displayName ?? '',
      assignees: raw.fields.assignee
        ? [raw.fields.assignee.accountId ?? raw.fields.assignee.displayName]
        : [],
      assigneeNames: raw.fields.assignee ? [raw.fields.assignee.displayName] : [],
      labels: raw.fields.labels ?? [],
      // ACLI search cannot request `updated`; detail reads provide the real revision.
      updatedAt: raw.fields.updated ?? '',
      revision: raw.fields.updated ?? '',
      bodyFormat: 'markdown',
    }
  }
  async issues(state: string, cursor?: string, query?: string, jiraFilters?: JiraIssueFilters) {
    const offset = jiraOffset(cursor)
    const rows = await this.issueRows(state, query, offset + 31, jiraFilters)
    return jiraIssuePage(rows, offset)
  }
  async boards() {
    await this.verify()
    const page = decode(
      mutableStruct({
        values: mutableArray(
          mutableStruct({
            id: Schema.Number,
            name: Schema.String,
            type: Schema.Literals(['scrum', 'kanban', 'simple']),
          }),
        ),
        isLast: Schema.Boolean,
      }),
      await this.json([
        'board',
        'search',
        '--project',
        this.binding.project,
        '--limit',
        '201',
        '--order-by',
        'name',
      ]),
    )
    return decode(jiraBoardsSchema, {
      boards: page.values.slice(0, 200).map((board) => ({ ...board, id: String(board.id) })),
      truncated: !page.isLast || page.values.length > 200,
    })
  }
  async sprints(boardId: string, closed = false) {
    const board = decode(jiraNumericId, boardId)
    const boards = await this.boards()
    const selected = boards.boards.find((value) => value.id === board)
    if (!selected) throw new HttpError(400, 'Choose a board from this Jira project.')
    if (selected.type === 'kanban')
      return decode(jiraSprintsSchema, { board, sprints: [], truncated: false })
    const page = decode(
      mutableStruct({
        sprints: mutableArray(
          mutableStruct({
            id: Schema.Number,
            name: Schema.String,
            state: Schema.Literals(['active', 'future', 'closed']),
            startDate: Schema.optional(Schema.String),
            endDate: Schema.optional(Schema.String),
            goal: Schema.optional(Schema.String),
          }),
        ),
        isLast: Schema.Boolean,
      }),
      await this.json([
        'board',
        'list-sprints',
        '--id',
        board,
        '--state',
        closed ? 'closed' : 'active,future',
        '--limit',
        '101',
      ]),
    )
    return decode(jiraSprintsSchema, {
      board,
      sprints: page.sprints.slice(0, 100).map((sprint) => ({ ...sprint, id: String(sprint.id) })),
      truncated: !page.isLast || page.sprints.length > 100,
    })
  }
  /** The newest `limit` matching issues in the server's order. ACLI exposes a result limit but
   * no page token, so pages are slices of one prefix read. */
  async issueRows(state: string, query?: string, limit = 31, jiraFilters?: JiraIssueFilters) {
    const filters = decode(jiraIssueFiltersSchema, jiraFilters ?? {})
    await this.verify()
    const status =
      state === 'all'
        ? ''
        : state === 'open'
          ? ' AND statusCategory != Done'
          : state === 'closed'
            ? ' AND statusCategory = Done'
            : ` AND status = ${JSON.stringify(state)}`
    const text = query?.trim()
    const clauses: string[] = []
    if (filters.assignee === 'mine') clauses.push('assignee = currentUser()')
    if (filters.assignee === 'unassigned') clauses.push('assignee IS EMPTY')
    for (const [field, value] of [
      ['priority', filters.priority],
      ['issuetype', filters.type],
      ['labels', filters.label],
      ['"Team"', filters.team],
      ['component', filters.component],
      ['fixVersion', filters.release],
    ]) {
      if (value !== undefined) clauses.push(`${field} = ${JSON.stringify(value)}`)
    }
    if (filters.sprint === 'active') clauses.push('sprint IN openSprints()')
    else if (filters.sprint === 'future') clauses.push('sprint IN futureSprints()')
    else if (filters.sprint === 'none') clauses.push('sprint IS EMPTY')
    else if (filters.sprint) clauses.push(`sprint = ${filters.sprint}`)
    if (filters.statusCategory) {
      const category = { todo: 'To Do', 'in-progress': 'In Progress', done: 'Done' }[
        filters.statusCategory
      ]
      clauses.push(`statusCategory = ${JSON.stringify(category)}`)
    }
    const structured = clauses.map((clause) => ` AND ${clause}`).join('')
    const search = !text
      ? ''
      : /^[A-Z][A-Z0-9_]*-\d+$/i.test(text)
        ? ` AND key = ${JSON.stringify(text.toUpperCase())}`
        : ` AND text ~ ${JSON.stringify('"' + text.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&') + '"')}`
    const jql = `project = ${this.binding.project}${status}${search}${structured} ORDER BY updated DESC, key DESC`
    const fields = 'key,summary,description,status,issuetype,priority,creator,assignee,labels'
    // The CLI has no board issue endpoint or saved-filter/configuration read. Only its
    // sprint endpoint can enforce a saved board's filter; never invent `board = id` JQL.
    if (filters.board && filters.sprint && /^\d+$/.test(filters.sprint)) {
      const page = decode(
        mutableStruct({
          // ACLI's sprint projection omits the REST issue id/self envelope.
          issues: mutableArray(
            mutableStruct({ key: rawIssue.fields.key, fields: rawIssue.fields.fields }),
          ),
          startAt: Schema.Number,
        }),
        await this.json([
          'sprint',
          'list-workitems',
          '--paginate',
          '--board',
          filters.board,
          '--sprint',
          filters.sprint,
          '--jql',
          jql,
          '--limit',
          String(Math.min(limit, 10021)),
          '--fields',
          fields,
        ]),
      )
      if (page.startAt !== 0) throw new HttpError(502, 'Jira returned an unexpected sprint page')
      return page.issues.map((value) => this.normalize(value))
    }
    const result = await this.json([
      'workitem',
      'search',
      '--jql',
      jql,
      '--limit',
      String(Math.min(limit, 10021)),
      '--fields',
      fields,
    ])
    return decode(mutableArray(rawIssue), result).map((v) => this.normalize(v))
  }
  private async raw(id: string, comments = true) {
    await this.verify()
    const value = decode(
      rawIssue,
      await this.json([
        'workitem',
        'view',
        this.key(id),
        '--fields',
        'key,summary,description,status,issuetype,priority,creator,assignee,labels,updated' +
          (comments ? ',comment' : ''),
      ]),
    )
    this.check(value)
    if (!value.fields.updated)
      throw new HttpError(
        502,
        'Jira did not return the issue revision. Refresh before making changes.',
      )
    return value
  }
  async issue(id: string, cursor?: string, section?: ForgeIssueSection): Promise<ForgeIssueDetail> {
    const raw = await this.raw(id, section === undefined)
    const issue = this.normalize(raw)
    if (section === 'overview') return { issue, comments: [] }
    if (section === 'discussion') {
      const offset = jiraOffset(cursor)
      // ACLI has no offset flag. Read a bounded prefix and slice it; never fetch all comments.
      const page = decode(
        mutableStruct({
          comments: mutableArray(rawComment),
          total: Schema.Number.pipe(
            Schema.check(Schema.isInt()),
            Schema.check(Schema.isGreaterThanOrEqualTo(0)),
          ),
          startAt: Schema.Number,
        }),
        await this.json([
          'workitem',
          'comment',
          'list',
          '--key',
          this.key(id),
          '--limit',
          String(offset + 31),
          '--order',
          '+created',
        ]),
      )
      if (page.startAt !== 0)
        throw new HttpError(502, 'Jira returned an unexpected discussion page')
      const latest = await this.raw(id, false)
      if (latest.fields.updated !== raw.fields.updated)
        throw new HttpError(
          409,
          'This issue changed while discussion was loading. Refresh the issue.',
        )
      const end = offset + 30
      const hasMore = page.total > end && page.comments.length > end
      return {
        issue,
        comments: page.comments.slice(offset, end).map(normalizeComment),
        next: hasMore && end <= 9990 ? String(end) : undefined,
        ...(page.total > Math.min(end, page.comments.length) && (!hasMore || end > 9990)
          ? {
              discussionNotice:
                'More comments are available in Jira. Open on server to view the full discussion.',
            }
          : {}),
      }
    }
    // Preserve the response contract for older clients and mutation callers.
    return {
      issue,
      comments: (raw.fields.comment?.comments ?? []).map(normalizeComment),
      ...(raw.fields.comment && raw.fields.comment.total > raw.fields.comment.comments.length
        ? {
            discussionNotice:
              'More comments are available in Jira. Open on server to view the full discussion.',
          }
        : {}),
    }
  }
  private async withText(value: string, run: (file: string) => Promise<void>) {
    const directory = await mkdtemp(path.join(tmpdir(), 'dovo-jira-'))
    try {
      const file = path.join(directory, 'content.json')
      await writeFile(file, JSON.stringify(markdownToAdf(value)), {
        mode: 0o600,
      })
      await run(file)
    } finally {
      await rm(directory, {
        recursive: true,
        force: true,
      })
    }
  }
  async createIssue(input: ForgeIssueCreate) {
    await this.requirePinnedWrite()
    const project = await this.verify()
    if (input.assignees.length > 1) throw new HttpError(400, 'Jira supports one assignee')
    if (
      project.issueTypes?.length &&
      !project.issueTypes.some((t) => t.name === input.type && !t.subtask)
    )
      throw new HttpError(
        400,
        'Select a standard issue type available in Jira; subtasks need a parent',
      )
    let result: unknown
    await this.withText(input.body, async (file) => {
      result = await this.json([
        'workitem',
        'create',
        '--project',
        this.binding.project,
        '--type',
        input.type,
        '--summary',
        input.title,
        '--description-file',
        file,
        ...(input.assignees[0] ? ['--assignee', input.assignees[0]] : []),
        ...(input.labels.length ? ['--label', input.labels.join(',')] : []),
      ])
    })
    const created = decode(
      mutableStruct({
        key: Schema.String,
      }),
      result,
    )
    const key = this.key(created.key)
    return {
      id: key,
      url: new URL('/browse/' + key, this.binding.site).href,
      message: 'Jira issue created',
    }
  }
  async actOnIssue(input: ForgeIssueAction) {
    await this.requirePinnedWrite()
    const raw = await this.raw(input.id),
      current = this.normalize(raw)
    if (current.revision !== input.revision)
      throw new HttpError(409, 'This Jira issue changed. Refresh before submitting.')
    if (input.action === 'comment')
      await this.withText(input.body, async (file) => {
        await this.execute([
          'jira',
          'workitem',
          'comment',
          'create',
          '--key',
          current.id,
          '--body-file',
          file,
          '--json',
        ])
      })
    else {
      if (
        input.title === undefined &&
        input.body === undefined &&
        input.state === undefined &&
        input.assignees === undefined &&
        input.labels === undefined
      )
        return {
          id: current.id,
          url: current.url,
          message: 'No changes to save',
        }
      if (input.state !== undefined) {
        if (
          input.title !== undefined ||
          input.body !== undefined ||
          input.assignees !== undefined ||
          input.labels !== undefined
        )
          throw new HttpError(400, 'Change Jira status separately from editing fields')
        await this.execute([
          'jira',
          'workitem',
          'transition',
          '--key',
          current.id,
          '--status',
          input.state,
          '--yes',
          '--json',
        ])
        return {
          id: current.id,
          url: current.url,
          message: 'Jira status updated',
        }
      }
      if ((input.assignees?.length ?? 0) > 1) throw new HttpError(400, 'Jira supports one assignee')
      const args = [
        'jira',
        'workitem',
        'edit',
        '--key',
        current.id,
        '--yes',
        '--json',
        ...(input.title !== undefined ? ['--summary', input.title] : []),
      ]
      if (input.assignees !== undefined)
        args.push(
          ...(input.assignees[0] ? ['--assignee', input.assignees[0]] : ['--remove-assignee']),
        )
      if (input.labels !== undefined) {
        const removed = current.labels.filter((v) => !input.labels!.includes(v))
        if (removed.length) args.push('--remove-labels', removed.join(','))
        if (input.labels.length) args.push('--labels', input.labels.join(','))
      }
      // Do not round-trip untouched ADF through Markdown: mentions, media and extensions survive.
      if (input.body !== undefined && input.body !== current.body)
        await this.withText(input.body, async (file) => {
          await this.execute([...args, '--description-file', file])
        })
      else await this.execute(args)
    }
    return {
      id: current.id,
      url: current.url,
      message: input.action === 'comment' ? 'Jira comment posted' : 'Jira issue updated',
    }
  }
  async definitions(): Promise<never> {
    throw new HttpError(400, 'Pipelines belong to the repository provider')
  }
  async pipelines(): Promise<never> {
    throw new HttpError(400, 'Pipelines belong to the repository provider')
  }
  async pipeline(_id: string): Promise<never> {
    throw new HttpError(400, 'Pipelines belong to the repository provider')
  }
  async actOnPipeline(_input: ForgePipelineAction): Promise<never> {
    throw new HttpError(400, 'Pipelines belong to the repository provider')
  }
}
