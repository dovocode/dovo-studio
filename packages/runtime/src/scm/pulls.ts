import { HttpError } from '../errors.js'
import { createHash } from 'node:crypto'
import { pullStatuses } from './pull-statuses.js'
import { actOnGithubPull, createGithubPull } from './github-actions.js'
import { githubThreads } from './github-threads.js'
import { githubChecks } from './github-checks.js'
import { z } from 'zod'
import type { GitService } from './git.js'
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
import { errorMessage } from '../errors.js'
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
export class PullRequests {
  private accounts = new Map<string, { expires: number; value: Promise<string> }>()
  constructor(
    private git: GitService,
    private target?: {
      host: string
      repository: string
      profile?: string
      token?: (cwd: string) => Promise<string | undefined>
    },
  ) {}
  private async location(cwd: string) {
    const repo = z
      .object({
        nameWithOwner: z
          .string()
          .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
          .refine(
            (value) => value.split('/').every((part) => part !== '.' && part !== '..'),
            'Use a GitHub owner/repository name',
          ),
        url: z.url({ protocol: /^https?$/ }),
      })
      .parse(
        this.target
          ? {
              nameWithOwner: this.target.repository,
              url: `https://${z
                .string()
                .regex(/^[a-zA-Z0-9.-]+(?::[0-9]+)?$/)
                .parse(this.target.host)}/${this.target.repository}`,
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
  private async run(cwd: string, args: string[]) {
    if (!this.target) return this.git.github(cwd, args)
    const token = await this.target.token?.(cwd)
    if (this.target.profile && !token)
      throw new HttpError(401, 'The selected GitHub profile is not signed in on this runtime.')
    return this.git.githubAccount(
      args,
      { timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
      cwd,
      token ? { host: this.target.host, token } : undefined,
    )
  }
  private async json(cwd: string, args: string[]): Promise<unknown> {
    return JSON.parse(await this.run(cwd, args))
  }
  async identity(cwd: string, refresh = false) {
    const repo = await this.location(cwd)
    const environment = createHash('sha256')
      .update(
        JSON.stringify([
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
      const value = this.target?.profile
        ? this.json(cwd, ['api', '--hostname', repo.host, 'user']).then((response) => {
            const account = z.object({ login: z.string().min(1) }).parse(response)
            if (account.login.toLowerCase() !== this.target!.profile!.toLowerCase())
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
            const accounts = z
              .object({
                hosts: z.record(
                  z.string(),
                  z.array(
                    z.object({
                      login: z.string().min(1),
                      active: z.boolean(),
                      state: z.string(),
                    }),
                  ),
                ),
              })
              .parse(response).hosts[repo.host]
            const current = accounts?.find((entry) => entry.active && entry.state === 'success')
            if (!current)
              throw new Error(
                `No authenticated GitHub account is active for ${repo.host}. Run gh auth login --hostname ${repo.host} on the runtime host.`,
              )
            return current.login
          })
      account = { expires: Date.now() + 60000, value }
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
  async list(cwd: string, state: 'open' | 'closed' | 'all', page: number) {
    const repo = await this.location(cwd)
    const pulls = z
      .array(restPull)
      .parse(
        await this.json(cwd, [
          'api',
          '--hostname',
          repo.host,
          `${repo.path}/pulls?state=${state}&sort=updated&direction=desc&per_page=50&page=${page}`,
        ]),
      )
    const statuses = await pullStatuses(
      this.git,
      cwd,
      repo.host,
      repo.nameWithOwner,
      pulls.map((p) => p.number),
      this.target ? (args) => this.run(cwd, args) : undefined,
    )
    return pullPageSchema.parse({
      pulls: pulls.map((p) => ({ ...summary(p), provider: 'github', ...statuses.get(p.number) })),
      hasMore: pulls.length === 50,
      page,
    })
  }
  async comment(cwd: string, value: unknown) {
    const input = pullLineCommentSchema.parse(value)
    const repo = await this.location(cwd)
    const pull = restDetail.parse(
      await this.json(cwd, ['api', '--hostname', repo.host, `${repo.path}/pulls/${input.number}`]),
    )
    if (pull.head.sha !== input.headSha)
      throw new HttpError(409, 'This PR changed. Refresh before posting your comment.')
    const side = input.side === 'additions' ? 'RIGHT' : 'LEFT'
    const result = z
      .object({ html_url: z.url() })
      .parse(
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
    return pullLineCommentResponse.parse({ url: result.html_url })
  }
  async detail(cwd: string, number: number) {
    const repo = await this.location(cwd)
    const api = (path: string, paginate = false) =>
      this.json(cwd, [
        'api',
        '--hostname',
        repo.host,
        `${repo.path}/${path}`,
        ...(paginate ? ['--paginate', '--slurp'] : []),
      ])
    const pull = restDetail.parse(await api(`pulls/${number}`))
    const results = await Promise.allSettled([
      api(`issues/${number}/comments?per_page=100`, true).then((v) =>
        z.array(z.array(restComment)).parse(v).flat(),
      ),
      api(`pulls/${number}/reviews?per_page=100`, true).then((v) =>
        z
          .array(z.array(restReview.extend({ commit_id: z.string().optional() })))
          .parse(v)
          .flat(),
      ),
      api(`pulls/${number}/comments?per_page=100`, true).then((v) =>
        z.array(z.array(restInline)).parse(v).flat(),
      ),
      api(`pulls/${number}/files?per_page=100`, true).then((v) =>
        z.array(z.array(restFile)).parse(v).flat(),
      ),
      this.json(cwd, [
        'pr',
        'view',
        String(number),
        '--repo',
        repo.repository,
        '--json',
        'statusCheckRollup',
      ]).then((v) => checkRollup.parse(v).statusCheckRollup ?? []),
      githubThreads((args) => this.json(cwd, args), repo, number),
      githubChecks((args) => this.json(cwd, args), repo, pull.head.sha),
      this.json(cwd, ['api', '--hostname', repo.host, repo.path]).then((value) =>
        z
          .object({
            allow_merge_commit: z.boolean().optional(),
            allow_squash_merge: z.boolean().optional(),
            allow_rebase_merge: z.boolean().optional(),
          })
          .parse(value),
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
          ...(c.commit_id ? { commitId: c.commit_id } : {}),
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
          ...(c.in_reply_to_id ? { replyTo: `inline-${c.in_reply_to_id}` } : {}),
        })),
      )
    comments.sort((a, b) => (a.date || '\uffff').localeCompare(b.date || '\uffff'))
    if (files.status === 'fulfilled' && files.value.length < pull.changed_files)
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
        ...(threads.status === 'fulfilled' ? ['resolve' as const] : []),
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
            ...(c.detailsUrl || c.targetUrl ? { url: c.detailsUrl || c.targetUrl } : {}),
          }))
        : []
    return pullDetailSchema.parse({
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
