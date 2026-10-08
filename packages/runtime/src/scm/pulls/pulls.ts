import { mutableStruct, mutableArray } from '@dovo/protocol'
import { refine, urlSchema, decode, minValue } from '@dovo/protocol'
import { HttpError } from '../../errors.js'
import { createHash } from 'node:crypto'
import { pullStatuses } from './pull-statuses.js'
import { actOnGithubPull, createGithubPull } from '../forges/providers/github-actions.js'
import { githubThreads } from '../forges/providers/github-threads.js'
import { githubChecks } from '../forges/providers/github-checks.js'
import { Schema } from 'effect'
import type { GitService } from '../git/git.js'
import {
  pullLineCommentSchema,
  pullLineCommentResponse,
  pullPageSchema,
  pullDetailSchema,
  type PullComment,
  type PullCreate,
  type PullAction,
  type ForgeCapabilities,
} from '@dovo/protocol'
import { errorMessage } from '../../errors.js'
import {
  restPull,
  restDetail,
  restComment,
  restReview,
  restInline,
  restFile,
  checkRollup,
  summary,
} from './pull-schemas.js'
/** A verified login stays valid for minutes; a failed check is never reused. */
const ACCOUNT_TTL = 600_000
export class PullRequests {
  private locations = new Map<
    string,
    {
      expires: number
      value: Promise<{
        nameWithOwner: string
        url: string
        host: string
        repository: string
        path: string
      }>
    }
  >()
  private location(cwd: string) {
    const cached = this.locations.get(cwd)
    if (cached && cached.expires > Date.now()) return cached.value
    const value = this.resolveLocation(cwd)
    const entry = { expires: Date.now() + 300_000, value }
    if (this.locations.size >= 100) this.locations.clear()
    this.locations.set(cwd, entry)
    void value.catch(() => {
      if (this.locations.get(cwd) === entry) this.locations.delete(cwd)
    })
    return value
  }
  private accounts = new Map<
    string,
    {
      expires: number
      value: Promise<string>
    }
  >()
  constructor(
    private git: GitService,
    private target?: {
      host: string
      repository: string
      profile?: string
      env?: Record<string, string>
      token?: (cwd: string) => Promise<string | undefined>
    },
  ) {}
  private async resolveLocation(cwd: string) {
    const repo = decode(
      mutableStruct({
        nameWithOwner: refine(
          Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/))),
          (value) => value.split('/').every((part) => part !== '.' && part !== '..'),
          'Use a GitHub owner/repository name',
        ),
        url: urlSchema({
          protocol: /^https?$/,
        }),
      }),
      this.target
        ? {
            nameWithOwner: this.target.repository,
            url: `https://${decode(Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-zA-Z0-9.-]+(?::[0-9]+)?$/))), this.target.host)}/${this.target.repository}`,
          }
        : await this.json(cwd, ['repo', 'view', '--json', 'nameWithOwner,url']),
    )
    return {
      nameWithOwner: repo.nameWithOwner,
      url: repo.url,
      host: new URL(repo.url).host,
      repository: `${new URL(repo.url).host}/${repo.nameWithOwner}`,
      path: `repos/${repo.nameWithOwner.split('/').map(encodeURIComponent).join('/')}`,
    }
  }
  private async run(cwd: string, args: string[], background = false) {
    if (!this.target) return this.git.github(cwd, args, background)
    const token = await this.target.token?.(cwd)
    if (this.target.profile && !token)
      throw new HttpError(401, 'The selected GitHub profile is not signed in on this runtime.')
    return this.git.githubAccount(
      args,
      {
        timeout: 60000,
        maxBuffer: 32 * 1024 * 1024,
      },
      cwd,
      token
        ? {
            host: this.target.host,
            token,
            ...(this.target.env ? { env: this.target.env } : {}),
          }
        : undefined,
      background,
    )
  }
  private async json(cwd: string, args: string[], background = false): Promise<unknown> {
    return JSON.parse(await this.run(cwd, args, background))
  }
  async identity(cwd: string, refresh = false) {
    if (refresh) this.locations.delete(cwd)
    const repo = await this.location(cwd)
    const selectedToken = await this.target?.token?.(cwd)
    // A checkout can select its own CLI account; keep identities per checkout.
    const environment = createHash('sha256')
      .update(
        JSON.stringify([
          selectedToken,
          process.env.GH_TOKEN,
          process.env.GITHUB_TOKEN,
          process.env.GH_ENTERPRISE_TOKEN,
          process.env.GITHUB_ENTERPRISE_TOKEN,
        ]),
      )
      .digest('hex')
    const key = JSON.stringify([repo.host, cwd, this.target?.profile, environment])
    let account = this.accounts.get(key)
    if (refresh || !account || account.expires <= Date.now()) {
      const value =
        this.target?.profile || selectedToken
          ? this.json(cwd, ['api', '--hostname', repo.host, 'user']).then((response) => {
              const account = decode(
                mutableStruct({
                  login: minValue(Schema.String, 1),
                }),
                response,
              )
              if (
                this.target?.profile &&
                account.login.toLowerCase() !== this.target.profile.toLowerCase()
              )
                throw new HttpError(
                  409,
                  'The selected GitHub profile changed. Refresh before continuing.',
                )
              return account.login
            })
          : this.json(cwd, [
              'auth',
              'status',
              '--active',
              '--hostname',
              repo.host,
              '--json',
              'hosts',
            ]).then((response) => {
              const accounts = decode(
                mutableStruct({
                  hosts: Schema.Record(
                    Schema.String,
                    Schema.mutableKey(
                      mutableArray(
                        mutableStruct({
                          login: minValue(Schema.String, 1),
                          active: Schema.Boolean,
                          state: Schema.String,
                        }),
                      ),
                    ),
                  ),
                }),
                response,
              ).hosts[repo.host]
              const current = accounts?.find((entry) => entry.active && entry.state === 'success')
              if (!current)
                throw new Error(
                  `No authenticated GitHub account is active for ${repo.host}. Run gh auth login --hostname ${repo.host} on the runtime host.`,
                )
              return current.login
            })
      account = {
        expires: Date.now() + ACCOUNT_TTL,
        value,
      }
      this.accounts.set(key, account)
      const entry = account
      void value.catch(() => {
        if (this.accounts.get(key) === entry) this.accounts.delete(key)
      })
    }
    return JSON.stringify([
      'github',
      repo.host,
      repo.nameWithOwner.toLowerCase(),
      await account.value,
      environment,
    ])
  }
  async create(cwd: string, input: PullCreate) {
    return createGithubPull((args) => this.json(cwd, args), await this.location(cwd), input)
  }
  async act(cwd: string, input: PullAction) {
    return actOnGithubPull((args) => this.json(cwd, args), await this.location(cwd), input)
  }
  async list(cwd: string, state: 'open' | 'closed' | 'all', page: number, background = false) {
    const repo = await this.location(cwd)
    const pulls = decode(
      mutableArray(restPull),
      await this.json(
        cwd,
        [
          'api',
          '--hostname',
          repo.host,
          `${repo.path}/pulls?state=${state}&sort=updated&direction=desc&per_page=50&page=${page}`,
        ],
        background,
      ),
    )
    const statuses = await pullStatuses(
      this.git,
      cwd,
      repo.host,
      repo.nameWithOwner,
      pulls.map((p) => p.number),
      (args) => this.run(cwd, args, background),
    )
    return decode(pullPageSchema, {
      pulls: pulls.map((p) => ({
        ...summary(p),
        provider: 'github',
        ...statuses.get(p.number),
      })),
      hasMore: pulls.length === 50,
      page,
    })
  }
  async comment(cwd: string, value: unknown) {
    const input = decode(pullLineCommentSchema, value)
    const repo = await this.location(cwd)
    const pull = decode(
      restDetail,
      await this.json(cwd, ['api', '--hostname', repo.host, `${repo.path}/pulls/${input.number}`]),
    )
    if (pull.head.sha !== input.headSha)
      throw new HttpError(409, 'This PR changed. Refresh before posting your comment.')
    const side = input.side === 'additions' ? 'RIGHT' : 'LEFT'
    const result = decode(
      mutableStruct({
        html_url: urlSchema(),
      }),
      await this.json(cwd, [
        'api',
        '--hostname',
        repo.host,
        `${repo.path}/pulls/${input.number}/comments`,
        '--method',
        'POST',
        '-f',
        `body=${input.body}`,
        '-f',
        `commit_id=${input.headSha}`,
        '-f',
        `path=${input.path}`,
        '-f',
        `side=${side}`,
        '-F',
        `line=${input.end}`,
        ...(input.start === input.end
          ? []
          : ['-F', `start_line=${input.start}`, '-f', `start_side=${side}`]),
      ]),
    )
    return decode(pullLineCommentResponse, {
      url: result.html_url,
    })
  }
  async status(cwd: string, number: number, background = false) {
    return this.detail(cwd, number, true, background)
  }
  async feedback(cwd: string, number: number) {
    return this.detail(cwd, number, false, true, true)
  }
  async detail(
    cwd: string,
    number: number,
    monitor = false,
    background = false,
    feedbackOnly = false,
  ) {
    const repo = await this.location(cwd)
    const json = (args: string[]) => this.json(cwd, args, background)
    const api = (path: string, paginate = false) =>
      json([
        'api',
        '--hostname',
        repo.host,
        `${repo.path}/${path}`,
        ...(paginate ? ['--paginate', '--slurp'] : []),
      ])
    const pull = decode(restDetail, await api(`pulls/${number}`))
    if (monitor) {
      const checks =
        decode(
          checkRollup,
          await json([
            'pr',
            'view',
            String(number),
            '--repo',
            repo.repository,
            '--json',
            'statusCheckRollup',
          ]),
        ).statusCheckRollup ?? []
      return decode(pullDetailSchema, {
        pull: {
          ...summary(pull),
          provider: 'github',
          repositoryUrl: repo.url,
          headSha: pull.head.sha,
          baseSha: pull.base.sha,
          body: pull.body ?? '',
          additions: pull.additions,
          deletions: pull.deletions,
          changedFiles: pull.changed_files,
          mergeable: pull.mergeable,
          reviewers: pull.requested_reviewers.map((user) => user.login),
          assignees: pull.assignees.map((user) => user.login),
        },
        comments: [],
        files: [],
        warnings: [],
        checks: checks.map((check) => ({
          name: check.name ?? check.context ?? 'Check',
          status: check.conclusion || check.state || check.status || 'Unknown',
        })),
      })
    }
    const results = await Promise.allSettled([
      api(`issues/${number}/comments?per_page=100`, true).then((v) =>
        decode(mutableArray(mutableArray(restComment)), v).flat(),
      ),
      api(`pulls/${number}/reviews?per_page=100`, true).then((v) =>
        decode(
          mutableArray(
            mutableArray(
              mutableStruct({
                ...restReview.fields,
                ...{
                  commit_id: Schema.optional(Schema.String),
                },
              }),
            ),
          ),
          v,
        ).flat(),
      ),
      api(`pulls/${number}/comments?per_page=100`, true).then((v) =>
        decode(mutableArray(mutableArray(restInline)), v).flat(),
      ),
      feedbackOnly
        ? Promise.resolve([])
        : api(`pulls/${number}/files?per_page=100`, true).then((v) =>
            decode(mutableArray(mutableArray(restFile)), v).flat(),
          ),
      json([
        'pr',
        'view',
        String(number),
        '--repo',
        repo.repository,
        '--json',
        'statusCheckRollup',
      ]).then((v) => decode(checkRollup, v).statusCheckRollup ?? []),
      feedbackOnly
        ? Promise.resolve(
            new Map<
              string,
              Pick<PullComment, 'threadId' | 'resolved' | 'outdated' | 'canResolve'>
            >(),
          )
        : githubThreads(json, repo, number),
      githubChecks(json, repo, pull.head.sha, !feedbackOnly),
      feedbackOnly
        ? Promise.resolve({
            allow_merge_commit: false,
            allow_squash_merge: false,
            allow_rebase_merge: false,
          })
        : json(['api', '--hostname', repo.host, repo.path]).then((value) =>
            decode(
              mutableStruct({
                allow_merge_commit: Schema.optional(Schema.Boolean),
                allow_squash_merge: Schema.optional(Schema.Boolean),
                allow_rebase_merge: Schema.optional(Schema.Boolean),
              }),
              value,
            ),
          ),
    ])
    const warnings: string[] = [],
      comments: PullComment[] = []
    const [conversation, reviews, inline, files, checks, threads, checkDetails, repository] =
      results
    for (const [i, result] of results.entries())
      if (result.status === 'rejected')
        warnings.push(
          `${['Conversation', 'Reviews', 'Inline comments', 'Files', 'Checks', 'Review threads', 'Check details', 'Repository settings'][i]}: ${errorMessage(result.reason)}`,
        )
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
    if (reviews.status === 'fulfilled')
      comments.push(
        ...reviews.value.map((c) => ({
          id: `review-${c.id}`,
          author: c.user?.login ?? 'Deleted user',
          body: c.body ?? '',
          date: c.submitted_at ?? '',
          url: c.html_url,
          kind: 'review' as const,
          state: c.state,
          ...(c.commit_id
            ? {
                commitId: c.commit_id,
              }
            : {}),
        })),
      )
    if (inline.status === 'fulfilled')
      comments.push(
        ...inline.value.map((c) => ({
          id: `inline-${c.id}`,
          author: c.user?.login ?? 'Deleted user',
          body: c.body ?? '',
          date: c.created_at,
          url: c.html_url,
          kind: 'inline' as const,
          path: c.path,
          line: c.line ?? c.original_line,
          diff: c.diff_hunk,
          ...(threads.status === 'fulfilled' ? threads.value.get(`inline-${c.id}`) : {}),
          ...(c.in_reply_to_id
            ? {
                replyTo: `inline-${c.in_reply_to_id}`,
              }
            : {}),
        })),
      )
    comments.sort((a, b) => (a.date || '\uffff').localeCompare(b.date || '\uffff'))
    if (!feedbackOnly && files.status === 'fulfilled' && files.value.length < pull.changed_files)
      warnings.push(
        'GitHub returned only part of this PR’s file list. Open GitHub for the remaining files.',
      )
    const mergeMethods: ForgeCapabilities['mergeMethods'] =
      repository.status === 'fulfilled'
        ? [
            ...(repository.value.allow_merge_commit ? ['merge' as const] : []),
            ...(repository.value.allow_squash_merge ? ['squash' as const] : []),
            ...(repository.value.allow_rebase_merge ? ['rebase' as const] : []),
          ]
        : []
    const capabilities: ForgeCapabilities = {
      actions: [
        'create',
        'edit',
        'comment',
        'inline-comment',
        'review',
        'reply',
        'reviewers',
        'close',
        'reopen',
        ...(!feedbackOnly && threads.status === 'fulfilled' ? ['resolve' as const] : []),
        ...(mergeMethods.length ? ['merge' as const] : []),
      ],
      reviewDecisions: ['comment', 'approve', 'request-changes'],
      mergeMethods,
      inlineRange: true,
      draft: true,
    }
    const expandedChecks = checkDetails.status === 'fulfilled' ? checkDetails.value.checks : []
    if (checkDetails.status === 'fulfilled') warnings.push(...checkDetails.value.warnings)
    const basicChecks =
      checks.status === 'fulfilled'
        ? checks.value.map((c) => ({
            name: c.name ?? c.context ?? 'Check',
            status: c.conclusion || c.state || c.status || 'Unknown',
            ...(c.detailsUrl || c.targetUrl
              ? {
                  url: c.detailsUrl || c.targetUrl,
                }
              : {}),
          }))
        : []
    return decode(pullDetailSchema, {
      capabilities,
      fileBaseUrl: `${repo.url}/blob/${pull.head.sha}/`,
      pull: {
        ...summary(pull),
        provider: 'github',
        cloneUrl: `${repo.url.replace(/\/$/, '')}.git`,
        headRef: `refs/pull/${number}/head`,
        headSha: pull.head.sha,
        baseSha: pull.base.sha,
        repositoryUrl: repo.url,
        body: pull.body ?? '',
        additions: pull.additions,
        deletions: pull.deletions,
        changedFiles: pull.changed_files,
        mergeable: pull.mergeable,
        reviewers: [
          ...pull.requested_reviewers.map((u) => u.login),
          ...(pull.requested_teams ?? []).map((team) => team.slug),
        ],
        assignees: pull.assignees.map((u) => u.login),
      },
      comments,
      warnings,
      files:
        files.status === 'fulfilled'
          ? files.value.map((f) => ({
              path: f.filename,
              previousPath: f.previous_filename,
              status: f.status,
              additions: f.additions,
              deletions: f.deletions,
              patch: f.patch,
            }))
          : [],
      checks: [
        ...expandedChecks,
        ...basicChecks.filter(
          (basic) =>
            !expandedChecks.some((rich) => rich.name === basic.name && rich.url === basic.url),
        ),
      ],
    })
  }
}
