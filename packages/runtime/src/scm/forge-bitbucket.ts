import { z } from 'zod'
import type {
  ForgeCapabilities,
  ForgeRepository,
  PullAction,
  PullActionResult,
  PullComment,
  PullCreate,
  PullDetail,
  PullSummary,
  pullLineCommentSchema,
} from '@dovo/protocol'
import type { ForgeAdapter } from './forge-types.js'
import type { ForgeHttp } from './forge-http.js'
import { parseForgeDiff } from './forge-diff.js'
import { HttpError } from '../errors.js'

const link = z.object({ href: z.url() })
const user = z.object({
  uuid: z.string(),
  display_name: z.string().optional(),
  nickname: z.string().optional(),
})
const repository = z.object({
  uuid: z.string(),
  name: z.string(),
  full_name: z.string(),
  mainbranch: z.object({ name: z.string() }).nullish(),
  links: z.object({
    html: link,
    clone: z.array(z.object({ name: z.string(), href: z.string() })).optional(),
  }),
})
const branch = z.object({
  branch: z.object({ name: z.string() }),
  commit: z.object({ hash: z.string().regex(/^[a-f0-9]{40}$/) }),
  repository,
})
const participant = z.object({
  user,
  approved: z.boolean().default(false),
  state: z.string().optional(),
  participated_on: z.string().nullish(),
})
const pull = z.object({
  id: z.number().int().positive(),
  title: z.string(),
  description: z.string().default(''),
  state: z.enum(['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED']),
  draft: z.boolean().default(false),
  author: user,
  updated_on: z.string(),
  source: branch,
  destination: branch,
  reviewers: z.array(user).default([]),
  participants: z.array(participant).default([]),
  links: z.object({ html: link }),
})
const comment = z.object({
  id: z.number().int(),
  content: z.object({ raw: z.string().default('') }),
  user,
  created_on: z.string(),
  deleted: z.boolean().default(false),
  parent: z.object({ id: z.number().int() }).nullish(),
  inline: z
    .object({
      path: z.string(),
      from: z.number().nullish(),
      to: z.number().nullish(),
      outdated: z.boolean().optional(),
    })
    .nullish(),
  resolution: z.unknown().optional(),
  links: z.object({ html: link }).optional(),
})
const status = z.object({
  key: z.string(),
  name: z.string().optional(),
  state: z.string(),
  url: z.url().optional(),
})
const stat = z.object({
  status: z.string(),
  lines_added: z.number().int().nonnegative(),
  lines_removed: z.number().int().nonnegative(),
  old: z.object({ path: z.string() }).nullish(),
  new: z.object({ path: z.string() }).nullish(),
})
const capabilities: ForgeCapabilities = {
  actions: [
    'create',
    'edit',
    'comment',
    'inline-comment',
    'review',
    'reply',
    'resolve',
    'reviewers',
    'merge',
    'close',
  ],
  reviewDecisions: ['comment', 'approve', 'request-changes'],
  mergeMethods: ['merge', 'squash'],
}
const person = (value: z.infer<typeof user>) => value.display_name ?? value.nickname ?? value.uuid
const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason))
const encoded = (value: string) => encodeURIComponent(value)

export class BitbucketForge implements ForgeAdapter {
  private readonly path: string
  private readonly workspace: string
  constructor(
    private readonly http: ForgeHttp,
    name: string,
  ) {
    const parts = name.split('/')
    if (
      name &&
      (parts.length !== 2 || parts.some((part) => !part || part === '.' || part === '..'))
    )
      throw new HttpError(400, 'Use a Bitbucket repository in workspace/repository form')
    this.workspace = name ? parts[0]! : ''
    this.path = name ? `repositories/${parts.map(encoded).join('/')}` : ''
  }
  private repo(value: z.infer<typeof repository>): ForgeRepository {
    const clone =
      value.links.clone?.find((entry) => entry.name === 'https')?.href ??
      `${value.links.html.href}.git`
    const cloneURL = new URL(clone)
    cloneURL.username = ''
    cloneURL.password = ''
    cloneURL.search = ''
    cloneURL.hash = ''
    return {
      id: value.uuid,
      name: value.name,
      fullName: value.full_name,
      url: value.links.html.href,
      cloneUrl: cloneURL.href,
      defaultBranch: value.mainbranch?.name,
    }
  }
  private async page<T>(path: string, schema: z.ZodType<T>, page: number) {
    if (!Number.isInteger(page) || page < 1 || page > 100)
      throw new HttpError(400, 'Page must be between 1 and 100')
    const shape = z.object({ values: z.array(schema), next: z.url().optional() })
    let next: string | undefined = path
    const seen = new Set<string>()
    for (let index = 1; next; index++) {
      if (seen.has(next))
        throw new HttpError(400, 'Bitbucket returned a repeated pagination cursor')
      seen.add(next)
      const current = shape.parse(await this.http.json(next))
      if (index === page) return current
      next = current.next
    }
    return { values: [] as T[], next: undefined }
  }
  private async all<T>(path: string, schema: z.ZodType<T>) {
    const shape = z.object({ values: z.array(schema), next: z.url().optional() })
    const values: T[] = []
    const seen = new Set<string>()
    let next: string | undefined = path
    while (next) {
      if (seen.has(next) || seen.size >= 100)
        throw new HttpError(400, 'Bitbucket pagination could not be completed')
      seen.add(next)
      const current = shape.parse(await this.http.json(next))
      values.push(...current.values)
      next = current.next
    }
    return values
  }
  private scoped() {
    if (!this.path) throw new HttpError(400, 'Choose a Bitbucket repository first')
    return this.path
  }
  async repository() {
    return this.repo(repository.parse(await this.http.json(this.scoped())))
  }
  async repositories(page: number) {
    if (!this.workspace) {
      if (!Number.isInteger(page) || page < 1 || page > 100)
        throw new HttpError(400, 'Page must be between 1 and 100')
      // Cross-workspace repository APIs were retired in April 2026. Enumerate
      // memberships with the replacement API, then each workspace's repositories.
      const workspaces = await this.all(
        'user/workspaces?pagelen=100',
        z.object({ workspace: z.object({ slug: z.string() }) }),
      )
      const values: ForgeRepository[] = []
      const seen = new Set<string>()
      for (const [index, workspace] of workspaces.entries()) {
        let next: string | undefined =
          `repositories/${encoded(workspace.workspace.slug)}?pagelen=50&sort=full_name`
        while (next) {
          if (seen.has(next) || seen.size >= 100)
            throw new HttpError(
              400,
              'Bitbucket repository discovery exceeded its page limit. Choose a repository by workspace/repository.',
            )
          seen.add(next)
          const result = z
            .object({ values: z.array(repository), next: z.url().optional() })
            .parse(await this.http.json(next))
          values.push(...result.values.map((value) => this.repo(value)))
          if (values.length >= page * 50)
            return {
              repositories: values.slice((page - 1) * 50, page * 50),
              page,
              hasMore: values.length > page * 50 || !!result.next || index < workspaces.length - 1,
            }
          next = result.next
        }
      }
      return { repositories: values.slice((page - 1) * 50), page, hasMore: false }
    }
    const result = await this.page(
      `repositories/${encoded(this.workspace)}?pagelen=50&sort=full_name`,
      repository,
      page,
    )
    return {
      repositories: result.values.map((value) => this.repo(value)),
      page,
      hasMore: !!result.next,
    }
  }
  private summary(value: z.infer<typeof pull>, viewer?: string): PullSummary {
    const requested = value.participants.some((entry) => entry.state === 'changes_requested')
    return {
      provider: 'bitbucket',
      number: value.id,
      title: value.title,
      url: value.links.html.href,
      state: value.state === 'OPEN' ? 'open' : value.state === 'MERGED' ? 'merged' : 'closed',
      draft: value.draft,
      author: person(value.author),
      updatedAt: value.updated_on,
      head: value.source.branch.name,
      base: value.destination.branch.name,
      labels: [],
      viewerIsAuthor: viewer ? viewer === value.author.uuid : undefined,
      viewerReviewRequested: viewer
        ? value.reviewers.some((entry) => entry.uuid === viewer) &&
          !value.participants.some(
            (entry) =>
              entry.user.uuid === viewer && (entry.approved || entry.state === 'changes_requested'),
          )
        : undefined,
      reviewDecision: requested
        ? 'CHANGES_REQUESTED'
        : value.participants.some((entry) => entry.approved)
          ? 'APPROVED'
          : null,
    }
  }
  async list(state: 'open' | 'closed' | 'all', page: number) {
    this.scoped()
    const states =
      state === 'open'
        ? ['OPEN']
        : state === 'closed'
          ? ['MERGED', 'DECLINED', 'SUPERSEDED']
          : ['OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED']
    const query = new URLSearchParams({ pagelen: '50', sort: '-updated_on' })
    for (const state of states) query.append('state', state)
    const [pageResult, viewer] = await Promise.allSettled([
      this.page(`${this.path}/pullrequests?${query}`, pull, page),
      this.http.json('user').then((data) => user.parse(data).uuid),
    ])
    if (pageResult.status === 'rejected') throw pageResult.reason
    const result = pageResult.value
    return {
      pulls: result.values.map((value) => ({
        ...this.summary(value, viewer.status === 'fulfilled' ? viewer.value : undefined),
        ...(viewer.status === 'rejected'
          ? { statusError: `Viewer identity unavailable: ${message(viewer.reason)}` }
          : {}),
      })),
      page,
      hasMore: !!result.next,
    }
  }
  private get(number: number) {
    return this.http
      .json(`${this.scoped()}/pullrequests/${number}`)
      .then((value) => pull.parse(value))
  }
  async detail(number: number): Promise<PullDetail> {
    const value = await this.get(number)
    const path = `${this.path}/pullrequests/${number}`
    const results = await Promise.allSettled([
      this.all(`${path}/comments?pagelen=100`, comment),
      this.all(`${path}/statuses?pagelen=100`, status),
      this.all(`${path}/diffstat?pagelen=100`, stat),
      this.http.text(`${path}/diff`),
    ])
    const warnings: string[] = []
    const [commentsResult, checksResult, statsResult, diffResult] = results
    for (const [index, result] of results.entries())
      if (result.status === 'rejected') {
        const sections =
          [['Conversation', 'Inline comments'], ['Checks'], ['Files'], ['Diff']][index] ?? []
        for (const section of sections) warnings.push(`${section}: ${message(result.reason)}`)
      }
    let patches: PullDetail['files'] = []
    if (diffResult.status === 'fulfilled') {
      try {
        patches = parseForgeDiff(diffResult.value)
      } catch (error) {
        warnings.push(`Diff: ${message(error)}`)
      }
    }
    const files =
      statsResult.status === 'fulfilled'
        ? statsResult.value.map((file) => ({
            path: file.new?.path ?? file.old?.path ?? '',
            previousPath: file.old?.path !== file.new?.path ? file.old?.path : undefined,
            status: file.status === 'removed' ? 'removed' : file.status,
            additions: file.lines_added,
            deletions: file.lines_removed,
            patch: patches.find((entry) => entry.path === (file.new?.path ?? file.old?.path))
              ?.patch,
          }))
        : patches
    const byId = new Map(
      commentsResult.status === 'fulfilled'
        ? commentsResult.value.map((entry) => [entry.id, entry])
        : [],
    )
    const comments: PullComment[] =
      commentsResult.status === 'fulfilled'
        ? commentsResult.value
            .filter((entry) => !entry.deleted)
            .map((entry) => {
              let root = entry
              const seen = new Set<number>()
              while (root.parent && !seen.has(root.id)) {
                seen.add(root.id)
                const parent = byId.get(root.parent.id)
                if (!parent) break
                root = parent
              }
              const inline = entry.inline ?? root.inline
              return {
                id: String(entry.id),
                threadId: String(root.id),
                resolved: !!root.resolution,
                canResolve: true,
                author: person(entry.user),
                body: entry.content.raw,
                date: entry.created_on,
                url: entry.links?.html.href ?? `${value.links.html.href}#comment-${entry.id}`,
                kind: inline ? 'inline' : 'comment',
                path: inline?.path,
                line: inline?.to ?? inline?.from,
                outdated: inline?.outdated,
                replyTo: entry.parent ? String(entry.parent.id) : undefined,
              }
            })
        : []
    for (const entry of value.participants) {
      if (!entry.approved && entry.state !== 'changes_requested') continue
      comments.push({
        id: `review-${entry.user.uuid}`,
        author: person(entry.user),
        body: '',
        date: entry.participated_on ?? value.updated_on,
        url: value.links.html.href,
        kind: 'review',
        state: entry.state === 'changes_requested' ? 'CHANGES_REQUESTED' : 'APPROVED',
      })
    }
    const completeCounts =
      statsResult.status === 'fulfilled' ||
      (diffResult.status === 'fulfilled' && patches.length > 0)
    const head = this.repo(value.source.repository)
    return {
      capabilities,
      fileBaseUrl: `${head.url}/src/${value.source.commit.hash}/`,
      pull: {
        ...this.summary(value),
        connectionId: this.http.connection.id,
        provider: 'bitbucket',
        headSha: value.source.commit.hash,
        baseSha: value.destination.commit.hash,
        repositoryUrl: value.destination.repository.links.html.href,
        cloneUrl: head.cloneUrl,
        headRef: `refs/heads/${value.source.branch.name}`,
        body: value.description,
        additions: completeCounts
          ? files.reduce((sum, file) => sum + (file.additions ?? 0), 0)
          : null,
        deletions: completeCounts
          ? files.reduce((sum, file) => sum + (file.deletions ?? 0), 0)
          : null,
        changedFiles: files.length,
        mergeable: null,
        reviewers: value.reviewers.map((entry) => entry.uuid),
        assignees: [],
      },
      files,
      comments,
      checks:
        checksResult.status === 'fulfilled'
          ? checksResult.value.map((entry) => ({
              name: entry.name || entry.key,
              status:
                entry.state === 'SUCCESSFUL'
                  ? 'SUCCESS'
                  : entry.state === 'INPROGRESS'
                    ? 'PENDING'
                    : entry.state === 'FAILED'
                      ? 'FAILURE'
                      : entry.state,
              url: entry.url,
            }))
          : [],
      warnings,
    }
  }
  private async current(number: number, sha: string) {
    const value = await this.get(number)
    if (value.source.commit.hash !== sha)
      throw new HttpError(
        409,
        'The pull request changed. Refresh it before submitting this action.',
      )
    return value
  }
  private result(
    value: z.infer<typeof pull>,
    status: PullActionResult['status'] = 'updated',
  ): PullActionResult {
    return { number: value.id, url: value.links.html.href, status }
  }
  async create(input: PullCreate) {
    this.scoped()
    const value = pull.parse(
      await this.http.json(`${this.path}/pullrequests`, {
        method: 'POST',
        body: {
          title: input.title,
          description: input.body,
          source: { branch: { name: input.head } },
          destination: { branch: { name: input.base } },
          draft: input.draft,
        },
      }),
    )
    return this.result(value, 'created')
  }
  async comment(input: z.infer<typeof pullLineCommentSchema>) {
    if (input.start !== input.end)
      throw new HttpError(400, 'Bitbucket Cloud supports single-line comments. Select one line.')
    const value = await this.current(input.number, input.headSha)
    const result = comment.parse(
      await this.http.json(`${this.path}/pullrequests/${input.number}/comments`, {
        method: 'POST',
        body: {
          content: { raw: input.body },
          inline: { path: input.path, [input.side === 'additions' ? 'to' : 'from']: input.end },
        },
      }),
    )
    return { url: result.links?.html.href ?? `${value.links.html.href}#comment-${result.id}` }
  }
  async act(input: PullAction): Promise<PullActionResult> {
    if (!capabilities.actions.includes(input.action))
      throw new HttpError(400, `Bitbucket Cloud does not support ${input.action}`)
    if (input.action === 'reviewers' && input.teams.length)
      throw new HttpError(400, 'Bitbucket Cloud reviewers must be individual account UUIDs')
    if (input.action === 'merge' && input.method === 'rebase')
      throw new HttpError(400, 'Bitbucket Cloud does not support rebase merging')
    const value = await this.current(input.number, input.headSha)
    const path = `${this.path}/pullrequests/${input.number}`
    if (input.action === 'comment' || input.action === 'reply') {
      await this.http.json(`${path}/comments`, {
        method: 'POST',
        body: {
          content: { raw: input.body },
          ...(input.action === 'reply'
            ? { parent: { id: z.coerce.number().int().positive().parse(input.commentId) } }
            : {}),
        },
      })
    } else if (input.action === 'review') {
      if (input.event === 'comment' && !input.body)
        throw new HttpError(400, 'Enter a review comment')
      // Publish the body first; a failed comment must not silently submit an approval.
      if (input.body)
        await this.http.json(`${path}/comments`, {
          method: 'POST',
          body: { content: { raw: input.body } },
        })
      if (input.event !== 'comment')
        await this.http.json(
          `${path}/${input.event === 'approve' ? 'approve' : 'request-changes'}`,
          { method: 'POST' },
        )
    } else if (input.action === 'resolve') {
      const id = z.coerce.number().int().positive().parse(input.threadId)
      await this.http.json(`${path}/comments/${id}/resolve`, {
        method: input.resolved ? 'POST' : 'DELETE',
      })
    } else if (input.action === 'edit') {
      await this.http.json(path, {
        method: 'PUT',
        body: {
          title: input.title,
          description: input.body,
          ...(input.base ? { destination: { branch: { name: input.base } } } : {}),
        },
      })
    } else if (input.action === 'reviewers') {
      const existing = value.reviewers.map((entry) => entry.uuid)
      const reviewers =
        input.operation === 'remove'
          ? existing.filter((uuid) => !input.reviewers.includes(uuid))
          : [...new Set([...existing, ...input.reviewers])]
      await this.http.json(path, {
        method: 'PUT',
        body: { reviewers: reviewers.map((uuid) => ({ uuid })) },
      })
    } else if (input.action === 'close') {
      await this.http.json(`${path}/decline`, { method: 'POST' })
    } else if (input.action === 'merge') {
      const result = await this.http.jsonResponse(`${path}/merge`, {
        method: 'POST',
        body: {
          type: 'pullrequest',
          merge_strategy: input.method === 'squash' ? 'squash' : 'merge_commit',
          ...(input.message ? { message: input.message } : {}),
        },
      })
      if (result.status === 202)
        return {
          ...this.result(value, 'queued'),
          message: 'Bitbucket is processing the merge. Refresh to check its result.',
        }
      const merged = pull.parse(result.data)
      return this.result(merged, merged.state === 'MERGED' ? 'merged' : 'queued')
    }
    return this.result(value, input.action === 'review' ? 'submitted' : 'updated')
  }
}
