import { mutableStruct, mutableArray, CoercedNumber } from '@dovo/protocol'
import { urlSchema, decode } from '@dovo/protocol'
import { Schema } from 'effect'
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
const link = mutableStruct({
  href: urlSchema(),
})
const user = mutableStruct({
  uuid: Schema.String,
  display_name: Schema.optional(Schema.String),
  nickname: Schema.optional(Schema.String),
})
const repository = mutableStruct({
  uuid: Schema.String,
  name: Schema.String,
  full_name: Schema.String,
  mainbranch: Schema.optional(
    Schema.NullOr(
      mutableStruct({
        name: Schema.String,
      }),
    ),
  ),
  links: mutableStruct({
    html: link,
    clone: Schema.optional(
      mutableArray(
        mutableStruct({
          name: Schema.String,
          href: Schema.String,
        }),
      ),
    ),
  }),
})
const branch = mutableStruct({
  branch: mutableStruct({
    name: Schema.String,
  }),
  commit: mutableStruct({
    hash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{40}$/)),
  }),
  repository,
})
const participant = mutableStruct({
  user,
  approved: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }),
  state: Schema.optional(Schema.String),
  participated_on: Schema.optional(Schema.NullOr(Schema.String)),
})
const pull = mutableStruct({
  id: Schema.Number.pipe(Schema.finite())
    .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
    .pipe(Schema.positive()),
  title: Schema.String,
  description: Schema.optionalWith(Schema.String, {
    default: () => '',
  }),
  state: Schema.Literal('OPEN', 'MERGED', 'DECLINED', 'SUPERSEDED'),
  draft: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }),
  author: user,
  updated_on: Schema.String,
  source: branch,
  destination: branch,
  reviewers: Schema.optionalWith(mutableArray(user), {
    default: () => [],
  }),
  participants: Schema.optionalWith(mutableArray(participant), {
    default: () => [],
  }),
  links: mutableStruct({
    html: link,
  }),
})
const comment = mutableStruct({
  id: Schema.Number.pipe(Schema.finite()).pipe(
    Schema.int(),
    Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
  ),
  content: mutableStruct({
    raw: Schema.optionalWith(Schema.String, {
      default: () => '',
    }),
  }),
  user,
  created_on: Schema.String,
  deleted: Schema.optionalWith(Schema.Boolean, {
    default: () => false,
  }),
  parent: Schema.optional(
    Schema.NullOr(
      mutableStruct({
        id: Schema.Number.pipe(Schema.finite()).pipe(
          Schema.int(),
          Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        ),
      }),
    ),
  ),
  inline: Schema.optional(
    Schema.NullOr(
      mutableStruct({
        path: Schema.String,
        from: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.finite()))),
        to: Schema.optional(Schema.NullOr(Schema.Number.pipe(Schema.finite()))),
        outdated: Schema.optional(Schema.Boolean),
      }),
    ),
  ),
  resolution: Schema.optional(Schema.Unknown),
  links: Schema.optional(
    mutableStruct({
      html: link,
    }),
  ),
})
const status = mutableStruct({
  key: Schema.String,
  name: Schema.optional(Schema.String),
  state: Schema.String,
  url: Schema.optional(urlSchema()),
})
const stat = mutableStruct({
  status: Schema.String,
  lines_added: Schema.Number.pipe(Schema.finite())
    .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
    .pipe(Schema.nonNegative()),
  lines_removed: Schema.Number.pipe(Schema.finite())
    .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
    .pipe(Schema.nonNegative()),
  old: Schema.optional(
    Schema.NullOr(
      mutableStruct({
        path: Schema.String,
      }),
    ),
  ),
  new: Schema.optional(
    Schema.NullOr(
      mutableStruct({
        path: Schema.String,
      }),
    ),
  ),
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
const person = (value: Schema.Schema.Type<typeof user>) =>
  value.display_name ?? value.nickname ?? value.uuid
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
  private repo(value: Schema.Schema.Type<typeof repository>): ForgeRepository {
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
  private async page<T, I>(path: string, schema: Schema.Schema<T, I>, page: number) {
    if (!Number.isInteger(page) || page < 1 || page > 100)
      throw new HttpError(400, 'Page must be between 1 and 100')
    const shape = mutableStruct({
      values: mutableArray(schema),
      next: Schema.optional(urlSchema()),
    })
    let next: string | undefined = path
    const seen = new Set<string>()
    for (let index = 1; next; index++) {
      if (seen.has(next))
        throw new HttpError(400, 'Bitbucket returned a repeated pagination cursor')
      seen.add(next)
      const current: Schema.Schema.Type<typeof shape> = decode(shape, await this.http.json(next))
      if (index === page) return current
      next = current.next
    }
    return {
      values: [] as T[],
      next: undefined,
    }
  }
  private async all<T, I>(path: string, schema: Schema.Schema<T, I>) {
    const shape = mutableStruct({
      values: mutableArray(schema),
      next: Schema.optional(urlSchema()),
    })
    const values: T[] = []
    const seen = new Set<string>()
    let next: string | undefined = path
    while (next) {
      if (seen.has(next) || seen.size >= 100)
        throw new HttpError(400, 'Bitbucket pagination could not be completed')
      seen.add(next)
      const current: Schema.Schema.Type<typeof shape> = decode(shape, await this.http.json(next))
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
    return this.repo(decode(repository, await this.http.json(this.scoped())))
  }
  async repositories(page: number) {
    if (!this.workspace) {
      if (!Number.isInteger(page) || page < 1 || page > 100)
        throw new HttpError(400, 'Page must be between 1 and 100')
      // Cross-workspace repository APIs were retired in April 2026. Enumerate
      // memberships with the replacement API, then each workspace's repositories.
      const workspaces = await this.all(
        'user/workspaces?pagelen=100',
        mutableStruct({
          workspace: mutableStruct({
            slug: Schema.String,
          }),
        }),
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
          const result: { values: Schema.Schema.Type<typeof repository>[]; next?: string } = decode(
            mutableStruct({
              values: mutableArray(repository),
              next: Schema.optional(urlSchema()),
            }),
            await this.http.json(next),
          )
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
      return {
        repositories: values.slice((page - 1) * 50),
        page,
        hasMore: false,
      }
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
  private summary(value: Schema.Schema.Type<typeof pull>, viewer?: string): PullSummary {
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
    const query = new URLSearchParams({
      pagelen: '50',
      sort: '-updated_on',
    })
    for (const state of states) query.append('state', state)
    const [pageResult, viewer] = await Promise.allSettled([
      this.page(`${this.path}/pullrequests?${query}`, pull, page),
      this.http.json('user').then((data) => decode(user, data).uuid),
    ])
    if (pageResult.status === 'rejected') throw pageResult.reason
    const result = pageResult.value
    return {
      pulls: result.values.map((value) => ({
        ...this.summary(value, viewer.status === 'fulfilled' ? viewer.value : undefined),
        ...(viewer.status === 'rejected'
          ? {
              statusError: `Viewer identity unavailable: ${message(viewer.reason)}`,
            }
          : {}),
      })),
      page,
      hasMore: !!result.next,
    }
  }
  private get(number: number) {
    return this.http
      .json(`${this.scoped()}/pullrequests/${number}`)
      .then((value) => decode(pull, value))
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
    value: Schema.Schema.Type<typeof pull>,
    status: PullActionResult['status'] = 'updated',
  ): PullActionResult {
    return {
      number: value.id,
      url: value.links.html.href,
      status,
    }
  }
  async create(input: PullCreate) {
    this.scoped()
    const value = decode(
      pull,
      await this.http.json(`${this.path}/pullrequests`, {
        method: 'POST',
        body: {
          title: input.title,
          description: input.body,
          source: {
            branch: {
              name: input.head,
            },
          },
          destination: {
            branch: {
              name: input.base,
            },
          },
          draft: input.draft,
        },
      }),
    )
    return this.result(value, 'created')
  }
  async comment(input: Schema.Schema.Type<typeof pullLineCommentSchema>) {
    if (input.start !== input.end)
      throw new HttpError(400, 'Bitbucket Cloud supports single-line comments. Select one line.')
    const value = await this.current(input.number, input.headSha)
    const result = decode(
      comment,
      await this.http.json(`${this.path}/pullrequests/${input.number}/comments`, {
        method: 'POST',
        body: {
          content: {
            raw: input.body,
          },
          inline: {
            path: input.path,
            [input.side === 'additions' ? 'to' : 'from']: input.end,
          },
        },
      }),
    )
    return {
      url: result.links?.html.href ?? `${value.links.html.href}#comment-${result.id}`,
    }
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
          content: {
            raw: input.body,
          },
          ...(input.action === 'reply'
            ? {
                parent: {
                  id: decode(
                    CoercedNumber.pipe(
                      Schema.int(),
                      Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
                    ).pipe(Schema.positive()),
                    input.commentId,
                  ),
                },
              }
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
          body: {
            content: {
              raw: input.body,
            },
          },
        })
      if (input.event !== 'comment')
        await this.http.json(
          `${path}/${input.event === 'approve' ? 'approve' : 'request-changes'}`,
          {
            method: 'POST',
          },
        )
    } else if (input.action === 'resolve') {
      const id = decode(
        CoercedNumber.pipe(
          Schema.int(),
          Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
        ).pipe(Schema.positive()),
        input.threadId,
      )
      await this.http.json(`${path}/comments/${id}/resolve`, {
        method: input.resolved ? 'POST' : 'DELETE',
      })
    } else if (input.action === 'edit') {
      await this.http.json(path, {
        method: 'PUT',
        body: {
          title: input.title,
          description: input.body,
          ...(input.base
            ? {
                destination: {
                  branch: {
                    name: input.base,
                  },
                },
              }
            : {}),
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
        body: {
          reviewers: reviewers.map((uuid) => ({
            uuid,
          })),
        },
      })
    } else if (input.action === 'close') {
      await this.http.json(`${path}/decline`, {
        method: 'POST',
      })
    } else if (input.action === 'merge') {
      const result = await this.http.jsonResponse(`${path}/merge`, {
        method: 'POST',
        body: {
          type: 'pullrequest',
          merge_strategy: input.method === 'squash' ? 'squash' : 'merge_commit',
          ...(input.message
            ? {
                message: input.message,
              }
            : {}),
        },
      })
      if (result.status === 202)
        return {
          ...this.result(value, 'queued'),
          message: 'Bitbucket is processing the merge. Refresh to check its result.',
        }
      const merged = decode(pull, result.data)
      return this.result(merged, merged.state === 'MERGED' ? 'merged' : 'queued')
    }
    return this.result(value, input.action === 'review' ? 'submitted' : 'updated')
  }
}
