import { z } from 'zod'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import Ajv from 'ajv-draft-04'
import { fromADF } from 'mdast-util-from-adf'
import { toMarkdown } from 'mdast-util-to-markdown'
import { gfmToMarkdown } from 'mdast-util-gfm'
import { markdownToAdf } from 'marklassian'
import type {
  JiraBinding,
  ForgeIssue,
  ForgeIssueCreate,
  ForgeIssueAction,
  ForgeWorkOptions,
  ForgePipelineAction,
} from '@dovo/protocol'
import { jiraBindingSchema, jiraProjectsSchema } from '@dovo/protocol'
import type { ForgeWorkProvider } from './forge-work-types.js'
import { runForgeCli } from './forge-cli.js'
import { HttpError } from '../errors.js'

const require = createRequire(import.meta.url)
const adfRequire = createRequire(require.resolve('mdast-util-from-adf'))
const validateADF = new Ajv({ strict: false }).compile<Parameters<typeof fromADF>[0]>(
  adfRequire('@atlaskit/adf-schema/json-schema/v1/full.json'),
)
export function jiraMarkdown(value: unknown) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (!validateADF(value))
    throw new HttpError(502, 'Jira returned an invalid rich-text document. Open this item in Jira.')
  try {
    return toMarkdown(fromADF(value), { extensions: [gfmToMarkdown()] })
  } catch {
    throw new HttpError(
      502,
      'This Jira document contains unsupported rich content. Open this item in Jira.',
    )
  }
}
const person = z.object({ displayName: z.string(), accountId: z.string().optional() })
const projectSchema = z.object({
  key: z.string(),
  self: z.url(),
  issueTypes: z.array(z.object({ name: z.string(), subtask: z.boolean().optional() })).nullish(),
})
export function jiraAccountSite(status: string) {
  const site = /^\s*Site:\s*(\S+)\s*$/m.exec(status)?.[1]
  const parsed = jiraBindingSchema.shape.site.safeParse(
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
  const site = jiraAccountSite(await run(executable, ['jira', 'auth', 'status'], undefined, cwd))
  const projects = z
    .array(z.object({ key: z.string(), name: z.string() }))
    .parse(
      JSON.parse(
        await run(
          executable,
          ['jira', 'project', 'list', '--limit', '201', '--json'],
          undefined,
          cwd,
        ),
      ),
    )
  return jiraProjectsSchema.parse({
    site,
    projects: projects.slice(0, 200),
    truncated: projects.length > 200,
  })
}

// ADF extensions are common (status pills, media, app blocks). Retain readable text
// when the Markdown converter cannot represent them; never hide the whole issue.
function jiraText(value: unknown): string {
  if (typeof value === 'string') return value
  const node = z
    .object({
      type: z.string().optional(),
      text: z.string().optional(),
      attrs: z
        .object({
          text: z.string().optional(),
          title: z.string().optional(),
          url: z.string().optional(),
        })
        .optional(),
      content: z.array(z.unknown()).optional(),
    })
    .safeParse(value)
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
    return { body: jiraMarkdown(value) }
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
const rawIssue = z.object({
  id: z.string(),
  key: z.string(),
  self: z.url(),
  fields: z.object({
    summary: z.string(),
    description: z.unknown().optional(),
    status: z.object({ name: z.string() }),
    issuetype: z.object({ name: z.string() }),
    creator: person.nullish(),
    assignee: person.nullish(),
    labels: z.array(z.string()).optional(),
    updated: z.string().optional(),
    comment: z
      .object({
        comments: z.array(
          z.object({
            id: z.string(),
            body: z.unknown(),
            author: person.nullish(),
            created: z.string(),
          }),
        ),
        total: z.number(),
      })
      .nullish(),
  }),
})
export class JiraWork implements ForgeWorkProvider {
  private account?: Promise<string>
  private verified?: Promise<z.infer<typeof projectSchema>>
  constructor(
    private executable: string,
    readonly binding: JiraBinding,
    private run: typeof runForgeCli = runForgeCli,
    private cwd?: string,
    private validateSource?: () => void,
  ) {
    this.binding = jiraBindingSchema.parse(binding)
  }
  private execute(args: string[]) {
    this.validateSource?.()
    return this.run(this.executable, args, undefined, this.cwd)
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
    const project = projectSchema.parse(
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
    // Account status is hashed privately, never copied into client data or activity.
    return createHash('sha256')
      .update(await this.account!)
      .digest('hex')
  }
  async options(): Promise<ForgeWorkOptions> {
    const project = await this.verify()
    return {
      provider: 'jira',
      issues: true,
      issueNotice:
        'Jira Cloud · ' +
        this.binding.project +
        '. Uses the active acli account on this runtime. Rich text is preserved unless you edit the description.',
      issueTypes: (project.issueTypes ?? []).filter((v) => !v.subtask).map((v) => v.name),
      issueStates: [],
      issueSearch: true,
      assignees: true,
      labels: true,
      pipelines: false,
      pipelineActions: [],
    }
  }
  private check(raw: z.infer<typeof rawIssue>) {
    if (!raw.key.startsWith(this.binding.project + '-'))
      throw new HttpError(409, 'Jira returned an item outside the selected project')
  }
  private key(value: string) {
    const key = z
      .string()
      .regex(/^[A-Z][A-Z0-9_]*-\d+$/)
      .parse(value)
    if (!key.startsWith(this.binding.project + '-'))
      throw new HttpError(400, 'The Jira issue belongs to another project')
    return key
  }
  private normalize(raw: z.infer<typeof rawIssue>): ForgeIssue {
    this.check(raw)
    return {
      id: raw.key,
      title: raw.fields.summary,
      ...renderJiraBody(raw.fields.description),
      state: raw.fields.status.name,
      type: raw.fields.issuetype.name,
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
  async issues(state: string, cursor?: string, query?: string) {
    await this.verify()
    // ACLI exposes a result limit but no page token. Read a bounded prefix in the
    // server's updated order; slicing preserves that order across pages.
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(9990)
      .parse(cursor ?? '0')
    const status =
      state === 'all'
        ? ''
        : state === 'open'
          ? ' AND statusCategory != Done'
          : state === 'closed'
            ? ' AND statusCategory = Done'
            : ` AND status = ${JSON.stringify(state)}`
    const text = query?.trim()
    const search = !text
      ? ''
      : /^[A-Z][A-Z0-9_]*-\d+$/i.test(text)
        ? ` AND key = ${JSON.stringify(text.toUpperCase())}`
        : ` AND text ~ ${JSON.stringify('"' + text.replace(/[+\-&|!(){}[\]^"~*?:\\/]/g, '\\$&') + '"')}`
    const result = await this.json([
      'workitem',
      'search',
      '--jql',
      `project = ${this.binding.project}${status}${search} ORDER BY updated DESC, key DESC`,
      '--limit',
      String(offset + 31),
      '--fields',
      'key,summary,description,status,issuetype,creator,assignee,labels',
    ])
    const rows = z.array(rawIssue).parse(result)
    return {
      items: rows.slice(offset, offset + 30).map((v) => this.normalize(v)),
      next: rows.length > offset + 30 && offset + 30 <= 9990 ? String(offset + 30) : undefined,
    }
  }
  private async raw(id: string) {
    await this.verify()
    const value = rawIssue.parse(
      await this.json([
        'workitem',
        'view',
        this.key(id),
        '--fields',
        'key,summary,description,status,issuetype,creator,assignee,labels,updated,comment',
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
  async issue(id: string) {
    const raw = await this.raw(id)
    return {
      issue: this.normalize(raw),
      comments: (raw.fields.comment?.comments ?? []).map((c) => {
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
      }),
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
      await writeFile(file, JSON.stringify(markdownToAdf(value)), { mode: 0o600 })
      await run(file)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  async createIssue(input: ForgeIssueCreate) {
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
    const created = z.object({ key: z.string() }).parse(result)
    const key = this.key(created.key)
    return {
      id: key,
      url: new URL('/browse/' + key, this.binding.site).href,
      message: 'Jira issue created',
    }
  }
  async actOnIssue(input: ForgeIssueAction) {
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
        return { id: current.id, url: current.url, message: 'No changes to save' }
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
        return { id: current.id, url: current.url, message: 'Jira status updated' }
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
