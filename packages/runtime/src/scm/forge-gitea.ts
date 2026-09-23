import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { Schema } from 'effect'
import { parse as parseVersion } from 'semver'
import {
  forgeRepositorySchema,
  forgeRepositoryPageSchema,
  pullPageSchema,
  pullDetailSchema,
  pullCreateSchema,
  pullActionSchema,
  pullActionResultSchema,
  pullLineCommentSchema,
  type ForgeCapabilities,
  type PullAction,
  type PullCreate,
  type PullDetail,
  type PullSummary,
} from '@dovo/protocol'
import { HttpError, errorMessage } from '../errors.js'
import type { ForgeAdapter } from './forge-types.js'
import type { ForgeHttp } from './forge-http.js'
import { parseForgeDiff } from './forge-diff.js'
import {
  forgeUser,
  forgeRepository,
  forgePull,
  forgeComment,
  forgeReview,
  forgeInline,
  forgeFile,
  forgeCombinedStatus,
} from './forge-gitea-schemas.js'
type Transport = Pick<ForgeHttp, 'connection' | 'json' | 'text'>
type Pull = Schema.Schema.Type<typeof forgePull>
type Repository = Schema.Schema.Type<typeof forgeRepository>
type Review = Schema.Schema.Type<typeof forgeReview>
const pageSize = 50
export class GiteaForge implements ForgeAdapter {
  private readonly repositoryPath: string
  private readonly provider: 'forgejo' | 'gitea'
  private versionRequest?: Promise<{
    major: number
    minor: number
    warning?: string
  }>
  constructor(
    private readonly http: Transport,
    repository: string,
  ) {
    if (http.connection.provider !== 'forgejo' && http.connection.provider !== 'gitea')
      throw new HttpError(400, 'Choose a Forgejo or Gitea connection.')
    this.provider = http.connection.provider
    const segments = repository.split('/')
    if (
      repository &&
      (segments.length !== 2 ||
        segments.some((v) => !v || v === '.' || v === '..' || /[\s\\?#]/.test(v)))
    )
      throw new HttpError(400, 'Enter the repository as owner/name.')
    this.repositoryPath = repository
      ? `/api/v1/repos/${segments.map(encodeURIComponent).join('/')}`
      : ''
  }
  private get path() {
    if (!this.repositoryPath) throw new HttpError(400, 'Choose a repository first.')
    return this.repositoryPath
  }
  private version(): Promise<{
    major: number
    minor: number
    warning?: string
  }> {
    return (this.versionRequest ??= this.http
      .json('/api/v1/version')
      .then((value) => {
        const parsed = decode(
          mutableStruct({
            version: Schema.String,
          }),
          value,
        )
        const version = parseVersion(parsed.version.replace(/^v/, ''))
        if (!version) throw new Error('The server did not return a recognized version.')
        return {
          major: version.major,
          minor: version.minor,
        }
      })
      .catch((error: unknown) => ({
        major: 0,
        minor: 0,
        warning: `Server version unavailable; optional review features are disabled. ${errorMessage(error)}`,
      })))
  }
  private async capabilities(repo?: Repository): Promise<ForgeCapabilities> {
    const version = await this.version()
    const modernGitea = this.provider === 'gitea' && version.major === 1
    return {
      actions: [
        'create',
        'edit',
        'comment',
        'inline-comment',
        'review',
        'reviewers',
        'merge',
        'close',
        'reopen',
        ...(modernGitea && version.minor >= 26 ? ['resolve' as const] : []),
        ...(modernGitea && version.minor >= 27 ? ['reply' as const] : []),
      ],
      reviewDecisions: ['comment', 'approve', 'request-changes'],
      mergeMethods: [
        ...(repo?.allow_merge_commits === true ? ['merge' as const] : []),
        ...(repo?.allow_squash_merge === true ? ['squash' as const] : []),
        ...(repo?.allow_rebase === true ? ['rebase' as const] : []),
      ],
      inlineRange: this.provider === 'forgejo' && version.major >= 16,
      draft: false,
    }
  }
  private async rawRepository() {
    return decode(forgeRepository, await this.http.json(this.path))
  }
  private mapRepository(repo: Repository) {
    return decode(forgeRepositorySchema, {
      id: String(repo.id),
      name: repo.name,
      fullName: repo.full_name,
      url: repo.html_url,
      cloneUrl: repo.clone_url,
      defaultBranch: repo.default_branch,
    })
  }
  async repository() {
    return this.mapRepository(await this.rawRepository())
  }
  private pagePath(path: string, page: number) {
    return `${path}${path.includes('?') ? '&' : '?'}limit=${pageSize}&page=${page}`
  }

  // Some instances cap limit below 50. An empty next page, rather than its size, proves the end.
  private async all<T, I>(path: string, schema: Schema.Schema<T, I>): Promise<T[]> {
    const values: T[] = []
    for (let page = 1; page <= 100; page++) {
      const rows = decode(mutableArray(schema), await this.http.json(this.pagePath(path, page)))
      if (!rows.length) return values
      values.push(...rows)
    }
    throw new HttpError(
      502,
      'The server returned too many pages. Open the remaining data on the server.',
    )
  }
  async repositories(page: number) {
    decode(
      Schema.Number.pipe(Schema.finite())
        .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
        .pipe(Schema.positive()),
      page,
    )
    const path = '/api/v1/user/repos'
    const repos = decode(
      mutableArray(forgeRepository),
      await this.http.json(this.pagePath(path, page)),
    )
    const next = repos.length
      ? decode(mutableArray(forgeRepository), await this.http.json(this.pagePath(path, page + 1)))
      : []
    return decode(forgeRepositoryPageSchema, {
      repositories: repos.map((r) => this.mapRepository(r)),
      page,
      hasMore: next.length > 0,
    })
  }
  private async viewer() {
    try {
      return {
        login: decode(forgeUser, await this.http.json('/api/v1/user')).login,
      }
    } catch (error) {
      return {
        login: undefined,
        warning: `Review assignment could not be personalized. ${errorMessage(error)}`,
      }
    }
  }
  private summary(pull: Pull, viewer?: string): PullSummary {
    return {
      provider: this.provider,
      number: pull.number,
      title: pull.title,
      url: pull.html_url,
      state: pull.merged ? 'merged' : pull.state,
      draft: pull.draft,
      author: pull.user?.login ?? 'Deleted user',
      updatedAt: pull.updated_at,
      head: pull.head.label,
      base: pull.base.ref,
      labels: pull.labels?.map((l) => l.name) ?? [],
      ...(viewer
        ? {
            viewerIsAuthor: pull.user?.login.toLowerCase() === viewer.toLowerCase(),
            viewerReviewRequested:
              pull.requested_reviewers?.some(
                (u) => u.login.toLowerCase() === viewer.toLowerCase(),
              ) ?? false,
          }
        : {}),
    }
  }
  private reviewDecision(reviews: Review[]) {
    const latest = new Map<string, Review>()
    for (const review of [...reviews].sort((a, b) =>
      (a.submitted_at ?? '').localeCompare(b.submitted_at ?? ''),
    )) {
      if (review.user && ['APPROVED', 'REQUEST_CHANGES'].includes(review.state))
        latest.set(review.user.login, review)
    }
    // Approval alone does not prove that all branch-protection requirements are satisfied.
    return [...latest.values()].some(
      (review) =>
        review.official && !review.dismissed && !review.stale && review.state === 'REQUEST_CHANGES',
    )
      ? 'CHANGES_REQUESTED'
      : null
  }
  async list(state: 'open' | 'closed' | 'all', page: number) {
    decode(
      Schema.Number.pipe(Schema.finite())
        .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
        .pipe(Schema.positive()),
      page,
    )
    decode(Schema.Literal('open', 'closed', 'all'), state)
    const path = `${this.path}/pulls?state=${state}&sort=recentupdate`
    const [raw, viewer] = await Promise.all([
      this.http.json(this.pagePath(path, page)),
      this.viewer(),
    ])
    const rows = decode(mutableArray(Schema.NullOr(forgePull)), raw)
    const next = rows.length
      ? decode(
          mutableArray(Schema.NullOr(forgePull)),
          await this.http.json(this.pagePath(path, page + 1)),
        )
      : []
    const pulls: PullSummary[] = []
    const valid = rows.filter((row): row is Pull => row !== null)
    // Bound requests on installations without a batch status API.
    for (let index = 0; index < valid.length; index += 4) {
      pulls.push(
        ...(await Promise.all(
          valid.slice(index, index + 4).map(async (pull) => {
            const summary = this.summary(pull, viewer.login)
            if (pull.state !== 'open') return summary
            const [status, reviews] = await Promise.allSettled([
              this.http
                .json(`${this.path}/commits/${pull.head.sha}/status`)
                .then((v) => decode(forgeCombinedStatus, v)),
              this.all(`${this.path}/pulls/${pull.number}/reviews`, forgeReview),
            ])
            const errors = [
              ...[status, reviews].flatMap((r) =>
                r.status === 'rejected' ? [errorMessage(r.reason)] : [],
              ),
            ].filter(Boolean)
            return {
              ...summary,
              checksState:
                status.status === 'fulfilled' && status.value.total_count > 0
                  ? status.value.state.toUpperCase()
                  : null,
              reviewDecision:
                reviews.status === 'fulfilled' ? this.reviewDecision(reviews.value) : null,
              ...(errors.length
                ? {
                    statusError: errors.join(' '),
                  }
                : {}),
            }
          }),
        )),
      )
    }
    return decode(pullPageSchema, {
      pulls,
      page,
      hasMore: next.length > 0,
      ...(rows.some((row) => row === null)
        ? {
            refreshError:
              'The server could not load some pull requests. Refresh or open the repository on the server.',
          }
        : {}),
    })
  }
  private async pull(number: number) {
    decode(
      Schema.Number.pipe(Schema.finite())
        .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
        .pipe(Schema.positive()),
      number,
    )
    return decode(forgePull, await this.http.json(`${this.path}/pulls/${number}`))
  }
  private async current(number: number, headSha: string) {
    const pull = await this.pull(number)
    if (pull.head.sha !== headSha)
      throw new HttpError(409, 'This PR changed. Refresh before submitting this action.')
    return pull
  }
  private async allChecks(sha: string) {
    const path = `${this.path}/commits/${sha}/status`
    const combined = decode(forgeCombinedStatus, await this.http.json(this.pagePath(path, 1)))
    for (let page = 2; combined.statuses.length < combined.total_count && page <= 100; page++) {
      const next = decode(forgeCombinedStatus, await this.http.json(this.pagePath(path, page)))
      if (!next.statuses.length) break
      combined.statuses.push(...next.statuses)
    }
    return combined
  }
  async detail(number: number) {
    const [pull, repo, version, viewer] = await Promise.all([
      this.pull(number),
      this.rawRepository(),
      this.version(),
      this.viewer(),
    ])
    const capabilities = await this.capabilities(repo)
    const warnings = [version.warning, viewer.warning].filter((v): v is string => Boolean(v))
    const results = await Promise.allSettled([
      this.http
        .json(`${this.path}/issues/${number}/comments`)
        .then((v) => decode(mutableArray(forgeComment), v)),
      this.all(`${this.path}/pulls/${number}/reviews`, forgeReview),
      this.all(`${this.path}/pulls/${number}/files`, forgeFile),
      this.http.text(`${this.path}/pulls/${number}.diff`).then(parseForgeDiff),
      this.allChecks(pull.head.sha),
    ])
    for (const [index, result] of results.entries())
      if (result.status === 'rejected')
        warnings.push(
          `${['Conversation', 'Reviews', 'Files', 'Diff', 'Checks'][index]}: ${errorMessage(result.reason)}`,
        )
    const [conversation, reviews, files, diff, status] = results
    const comments: PullDetail['comments'] = []
    if (conversation.status === 'fulfilled')
      comments.push(
        ...conversation.value.map((c) => ({
          id: `comment-${c.id}`,
          author: c.user?.login ?? 'Deleted user',
          body: c.body ?? '',
          date: c.created_at,
          url: c.html_url,
          kind: 'comment' as const,
        })),
      )
    if (reviews.status === 'fulfilled') {
      comments.push(
        ...reviews.value.map((r) => ({
          id: `review-${r.id}`,
          author: r.user?.login ?? 'Deleted user',
          body: r.body ?? '',
          date: r.submitted_at ?? '',
          url: r.html_url,
          kind: 'review' as const,
          state: r.dismissed
            ? 'DISMISSED'
            : r.state === 'REQUEST_CHANGES'
              ? 'CHANGES_REQUESTED'
              : r.state === 'COMMENT'
                ? 'COMMENTED'
                : r.state,
          outdated: r.stale,
        })),
      )
      for (let index = 0; index < reviews.value.length; index += 4) {
        const batch = reviews.value.slice(index, index + 4).filter((r) => r.comments_count > 0)
        const inline = await Promise.allSettled(
          batch.map(async (review) =>
            decode(
              mutableArray(forgeInline),
              await this.http.json(`${this.path}/pulls/${number}/reviews/${review.id}/comments`),
            ),
          ),
        )
        for (const result of inline) {
          if (result.status === 'rejected') {
            warnings.push(`Inline comments: ${errorMessage(result.reason)}`)
            continue
          }
          comments.push(
            ...result.value.map((c) => ({
              id: `inline-${c.id}`,
              threadId: String(c.id),
              author: c.user?.login ?? 'Deleted user',
              body: c.body ?? '',
              date: c.created_at,
              url: c.html_url,
              kind: 'inline' as const,
              path: c.path,
              line: c.position || c.original_position || null,
              diff: c.diff_hunk ?? undefined,
              resolved: Boolean(c.resolver),
              canResolve: capabilities.actions.includes('resolve'),
              commitId: c.commit_id,
              outdated: Boolean(c.commit_id && c.commit_id !== pull.head.sha),
            })),
          )
        }
      }
    }
    comments.sort((a, b) => (a.date || '\uffff').localeCompare(b.date || '\uffff'))
    const patches = new Map(
      (diff.status === 'fulfilled' ? diff.value : []).map((file) => [file.path, file]),
    )
    const mappedFiles =
      files.status === 'fulfilled'
        ? files.value.map((file) => ({
            path: file.filename,
            previousPath: file.previous_filename,
            status: file.status === 'deleted' ? 'removed' : file.status,
            additions: file.additions ?? null,
            deletions: file.deletions ?? null,
            patch: patches.get(file.filename)?.patch,
          }))
        : [...patches.values()]
    if (pull.changed_files != null && mappedFiles.length < pull.changed_files)
      warnings.push(
        'The server returned only part of this PR’s files. Open the repository on the server for the remaining files.',
      )
    const checks =
      status.status === 'fulfilled'
        ? status.value.statuses.map((s) => ({
            name: s.context,
            status: s.status,
            ...(s.target_url
              ? {
                  url: s.target_url,
                }
              : {}),
          }))
        : []
    if (status.status === 'fulfilled' && status.value.total_count > status.value.statuses.length)
      warnings.push(
        'Only part of the check list was returned. Open the PR on the server for all checks.',
      )
    return decode(pullDetailSchema, {
      capabilities,
      fileBaseUrl: `${pull.head.repo?.html_url ?? repo.html_url}/src/commit/${pull.head.sha}/`,
      pull: {
        ...this.summary(pull, viewer.login),
        headSha: pull.head.sha,
        baseSha: pull.base.sha,
        repositoryUrl: repo.html_url,
        connectionId: this.http.connection.id,
        cloneUrl: repo.clone_url,
        headRef: `refs/pull/${number}/head`,
        body: pull.body ?? '',
        additions: pull.additions ?? null,
        deletions: pull.deletions ?? null,
        changedFiles: pull.changed_files ?? null,
        mergeable: pull.mergeable ?? null,
        reviewers: [
          ...(pull.requested_reviewers?.map((u) => u.login) ?? []),
          ...(pull.requested_reviewers_teams?.map((t) => t.name) ?? []),
        ],
        assignees: pull.assignees?.map((u) => u.login) ?? [],
        checksState:
          status.status === 'fulfilled' && status.value.total_count > 0
            ? status.value.state.toUpperCase()
            : null,
        reviewDecision: reviews.status === 'fulfilled' ? this.reviewDecision(reviews.value) : null,
      },
      comments,
      files: mappedFiles,
      checks,
      warnings,
    })
  }
  async comment(value: Schema.Schema.Type<typeof pullLineCommentSchema>) {
    const input = decode(pullLineCommentSchema, value)
    const capabilities = await this.capabilities()
    if (input.start !== input.end && !capabilities.inlineRange)
      throw new HttpError(
        400,
        'This server only supports single-line review comments. Select one line.',
      )
    await this.current(input.number, input.headSha)
    const review = decode(
      forgeReview,
      await this.http.json(`${this.path}/pulls/${input.number}/reviews`, {
        method: 'POST',
        body: {
          event: 'COMMENT',
          commit_id: input.headSha,
          comments: [
            {
              body: input.body,
              path: input.path,
              new_position: input.side === 'additions' ? input.start : 0,
              old_position: input.side === 'deletions' ? input.start : 0,
              ...(input.end !== input.start
                ? {
                    extra_lines_count: input.end - input.start,
                  }
                : {}),
            },
          ],
        },
      }),
    )
    return {
      url: review.html_url,
    }
  }
  async create(value: PullCreate) {
    const input = decode(pullCreateSchema, value)
    if (input.draft)
      throw new HttpError(
        400,
        'This server does not expose draft creation through its API. Create the PR, then mark it as a draft on the server.',
      )
    const pull = decode(
      forgePull,
      await this.http.json(`${this.path}/pulls`, {
        method: 'POST',
        body: {
          title: input.title,
          body: input.body,
          head: input.head,
          base: input.base,
        },
      }),
    )
    return decode(pullActionResultSchema, {
      number: pull.number,
      url: pull.html_url,
      status: 'created',
    })
  }
  private commentId(value: string) {
    const match = /^(?:inline-)?([1-9]\d*)$/.exec(value)
    if (!match) throw new HttpError(400, 'Choose a review comment from this PR.')
    return match[1]
  }
  async act(value: PullAction) {
    const input = decode(pullActionSchema, value)
    const pull = await this.current(input.number, input.headSha)
    const path = `${this.path}/pulls/${input.number}`
    let status: 'updated' | 'submitted' | 'merged' = 'updated'
    switch (input.action) {
      case 'comment':
        await this.http.json(`${this.path}/issues/${input.number}/comments`, {
          method: 'POST',
          body: {
            body: input.body,
          },
        })
        status = 'submitted'
        break
      case 'review':
        await this.http.json(`${path}/reviews`, {
          method: 'POST',
          body: {
            body: input.body,
            commit_id: input.headSha,
            event: {
              comment: 'COMMENT',
              approve: 'APPROVED',
              'request-changes': 'REQUEST_CHANGES',
            }[input.event],
          },
        })
        status = 'submitted'
        break
      case 'reply': {
        if (!(await this.capabilities()).actions.includes('reply'))
          throw new HttpError(
            400,
            'This server version does not support review replies through its API. Reply on the server.',
          )
        await this.http.json(`${path}/comments/${this.commentId(input.commentId)}/replies`, {
          method: 'POST',
          body: {
            body: input.body,
          },
        })
        status = 'submitted'
        break
      }
      case 'resolve': {
        if (!(await this.capabilities()).actions.includes('resolve'))
          throw new HttpError(
            400,
            'This server version does not support resolving review threads through its API. Resolve the thread on the server.',
          )
        const id = this.commentId(input.threadId)
        // This provider's resolve route has no PR number; check comment ownership first.
        const reviews = await this.all(`${path}/reviews`, forgeReview)
        let belongs = false
        for (const review of reviews) {
          if (!review.comments_count) continue
          const comments = decode(
            mutableArray(forgeInline),
            await this.http.json(`${path}/reviews/${review.id}/comments`),
          )
          if (comments.some((c) => String(c.id) === id)) {
            belongs = true
            break
          }
        }
        if (!belongs)
          throw new HttpError(400, 'This review comment does not belong to the selected PR.')
        await this.http.json(
          `${this.path}/pulls/comments/${id}/${input.resolved ? 'resolve' : 'unresolve'}`,
          {
            method: 'POST',
          },
        )
        break
      }
      case 'edit':
        await this.http.json(path, {
          method: 'PATCH',
          body: {
            title: input.title,
            body: input.body,
            ...(input.base
              ? {
                  base: input.base,
                }
              : {}),
            ...(pull.content_version != null
              ? {
                  content_version: pull.content_version,
                }
              : {}),
          },
        })
        break
      case 'reviewers': {
        await this.http.json(`${path}/requested_reviewers`, {
          method: input.operation === 'remove' ? 'DELETE' : 'POST',
          body: {
            reviewers: input.reviewers,
            team_reviewers: input.teams,
          },
        })
        break
      }
      case 'merge': {
        const repo = await this.rawRepository()
        const capabilities = await this.capabilities(repo)
        if (!capabilities.mergeMethods.includes(input.method))
          throw new HttpError(400, 'This merge method is not enabled for the repository.')
        const version = await this.version()
        if (!version.major)
          throw new HttpError(
            400,
            'Cannot verify the server’s merge API version. Open the PR on the server to merge.',
          )
        const snakeCase = this.provider === 'gitea' && version.major === 1 && version.minor >= 26
        await this.http.json(`${path}/merge`, {
          method: 'POST',
          body: {
            [snakeCase ? 'do' : 'Do']: input.method,
            head_commit_id: input.headSha,
            ...(input.message !== undefined
              ? {
                  [snakeCase ? 'merge_message_field' : 'MergeMessageField']: input.message,
                }
              : {}),
          },
        })
        const result = await this.pull(input.number)
        if (!result.merged)
          throw new HttpError(
            409,
            'The server has not confirmed this PR was merged. Refresh before trying again.',
          )
        status = 'merged'
        break
      }
      case 'close':
      case 'reopen':
        await this.http.json(path, {
          method: 'PATCH',
          body: {
            state: input.action === 'close' ? 'closed' : 'open',
          },
        })
        break
    }
    return decode(pullActionResultSchema, {
      number: input.number,
      url: pull.html_url,
      status,
    })
  }
}
