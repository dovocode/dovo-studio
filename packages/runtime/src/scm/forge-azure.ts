import { z } from 'zod'
import { createTwoFilesPatch } from 'diff'
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

const identity = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  uniqueName: z.string().optional(),
})
const repository = z
  .object({
    id: z.string(),
    name: z.string(),
    project: z.object({ id: z.string(), name: z.string() }),
    webUrl: z.url().optional(),
    remoteUrl: z.url(),
    defaultBranch: z.string().optional(),
  })
  .transform((value) => {
    const web = new URL(value.webUrl ?? value.remoteUrl)
    web.username = ''
    web.password = ''
    web.search = ''
    web.hash = ''
    return { ...value, webUrl: web.href }
  })
const commit = z.object({ commitId: z.string().regex(/^[a-f0-9]{40}$/) })
const reviewer = identity.extend({
  vote: z.number().default(0),
  isRequired: z.boolean().optional(),
})
const pull = z.object({
  pullRequestId: z.number().int().positive(),
  title: z.string(),
  description: z.string().nullish(),
  status: z.enum(['active', 'abandoned', 'completed']),
  isDraft: z.boolean().default(false),
  createdBy: identity,
  creationDate: z.string(),
  closedDate: z.string().optional(),
  sourceRefName: z.string(),
  targetRefName: z.string(),
  repository,
  forkSource: z.object({ repository, name: z.string().optional() }).nullish(),
  lastMergeSourceCommit: commit.nullish(),
  lastMergeTargetCommit: commit.nullish(),
  reviewers: z.array(reviewer).default([]),
  labels: z.array(z.object({ name: z.string() })).default([]),
  mergeStatus: z.string().optional(),
  mergeFailureMessage: z.string().optional(),
  completionQueueTime: z.string().optional(),
})
const position = z.object({ line: z.number().int(), offset: z.number().int().optional() })
const thread = z.object({
  id: z.number().int(),
  status: z.union([z.string(), z.number()]),
  isDeleted: z.boolean().optional(),
  publishedDate: z.string(),
  lastUpdatedDate: z.string().optional(),
  comments: z
    .array(
      z.object({
        id: z.number().int(),
        parentCommentId: z.number().int().optional(),
        author: identity,
        content: z.string().nullish(),
        publishedDate: z.string(),
        isDeleted: z.boolean().optional(),
        commentType: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .default([]),
  threadContext: z
    .object({
      filePath: z.string().optional(),
      leftFileStart: position.nullish(),
      rightFileStart: position.nullish(),
    })
    .nullish(),
  pullRequestThreadContext: z
    .object({
      iterationContext: z.object({ secondComparingIteration: z.number() }).optional(),
      trackingCriteria: z.object({ origFilePath: z.string().optional() }).nullish(),
    })
    .nullish(),
})
const iteration = z.object({
  id: z.number().int().positive(),
  sourceRefCommit: commit,
  targetRefCommit: commit,
  commonRefCommit: commit,
  createdDate: z.string().optional(),
  updatedDate: z.string().optional(),
})
const change = z.object({
  changeTrackingId: z.number().int(),
  changeType: z.union([z.string(), z.number()]),
  originalPath: z.string().optional(),
  item: z.object({
    path: z.string(),
    objectId: z.string().optional(),
    isFolder: z.boolean().optional(),
  }),
})
const status = z.object({
  id: z.number(),
  state: z.string(),
  context: z.object({ name: z.string(), genre: z.string().optional() }),
  targetUrl: z.url().nullish(),
  iterationId: z.number().optional(),
})
const policy = z.object({
  status: z.string(),
  configuration: z.object({
    isBlocking: z.boolean().optional(),
    type: z.object({ displayName: z.string() }),
  }),
  context: z.object({ buildId: z.number().optional() }).nullish(),
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
    'reopen',
  ],
  reviewDecisions: ['comment', 'approve', 'request-changes'],
  mergeMethods: ['merge', 'squash', 'rebase'],
}
const label = (value: z.infer<typeof identity>) => value.displayName ?? value.uniqueName ?? value.id
const branchName = (value: string) => value.replace(/^refs\/heads\//, '')
const branchRef = (value: string) =>
  value.startsWith('refs/heads/') ? value : `refs/heads/${value}`
const message = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason))
const safePath = (value: string) => value.replace(/^\//, '')
const reviewState = (vote: number) =>
  vote === 10
    ? 'APPROVED'
    : vote === 5
      ? 'APPROVED_WITH_SUGGESTIONS'
      : vote === -5
        ? 'WAITING_FOR_AUTHOR'
        : vote === -10
          ? 'CHANGES_REQUESTED'
          : undefined

export class AzureForge implements ForgeAdapter {
  private readonly project: string
  private readonly path: string
  constructor(
    private readonly http: ForgeHttp,
    name: string,
  ) {
    const parts = name.split('/')
    if (
      name &&
      (parts.length !== 2 || parts.some((part) => !part || part === '.' || part === '..'))
    )
      throw new HttpError(400, 'Use an Azure repository in project/repository form')
    this.project = name ? parts[0]! : ''
    this.path = name
      ? `${encodeURIComponent(this.project)}/_apis/git/repositories/${encodeURIComponent(parts[1]!)}`
      : ''
  }
  private api(path: string, query: Record<string, string> = {}) {
    return `${path}?${new URLSearchParams({ ...query, 'api-version': '7.1' })}`
  }
  private repo(value: z.infer<typeof repository>): ForgeRepository {
    const clone = new URL(value.remoteUrl)
    clone.username = ''
    clone.password = ''
    clone.search = ''
    clone.hash = ''
    return {
      id: value.id,
      name: value.name,
      fullName: `${value.project.name}/${value.name}`,
      url: value.webUrl,
      cloneUrl: clone.href,
      defaultBranch: value.defaultBranch ? branchName(value.defaultBranch) : undefined,
    }
  }
  private scoped() {
    if (!this.path) throw new HttpError(400, 'Choose an Azure repository first')
    return this.path
  }
  async repository() {
    return this.repo(repository.parse(await this.http.json(this.api(this.scoped()))))
  }
  async repositories(page: number) {
    if (!Number.isInteger(page) || page < 1) throw new HttpError(400, 'Invalid page')
    const result = z
      .object({ value: z.array(repository) })
      .parse(
        await this.http.json(
          this.api(
            `${this.project ? `${encodeURIComponent(this.project)}/` : ''}_apis/git/repositories`,
          ),
        ),
      )
    return {
      repositories: result.value.slice((page - 1) * 50, page * 50).map((value) => this.repo(value)),
      page,
      hasMore: result.value.length > page * 50,
    }
  }
  private url(value: z.infer<typeof pull>) {
    return `${value.repository.webUrl}/pullrequest/${value.pullRequestId}`
  }
  private summary(value: z.infer<typeof pull>, viewer?: string): PullSummary {
    return {
      provider: 'azure-devops',
      number: value.pullRequestId,
      title: value.title,
      url: this.url(value),
      state:
        value.status === 'active' ? 'open' : value.status === 'completed' ? 'merged' : 'closed',
      draft: value.isDraft,
      author: label(value.createdBy),
      updatedAt: value.closedDate ?? value.creationDate,
      head: branchName(value.sourceRefName),
      base: branchName(value.targetRefName),
      labels: value.labels.map((entry) => entry.name),
      viewerIsAuthor: viewer ? viewer === value.createdBy.id : undefined,
      viewerReviewRequested: viewer
        ? value.reviewers.some((entry) => entry.id === viewer && entry.vote === 0)
        : undefined,
      reviewDecision: value.reviewers.some((entry) => entry.vote === -10)
        ? 'CHANGES_REQUESTED'
        : value.reviewers.some((entry) => entry.vote === -5)
          ? 'WAITING_FOR_AUTHOR'
          : value.reviewers.some((entry) => entry.vote === 10)
            ? 'APPROVED'
            : value.reviewers.some((entry) => entry.vote === 5)
              ? 'APPROVED_WITH_SUGGESTIONS'
              : null,
    }
  }
  async list(state: 'open' | 'closed' | 'all', page: number) {
    this.scoped()
    if (!Number.isInteger(page) || page < 1 || page > 100)
      throw new HttpError(400, 'Page must be between 1 and 100')
    const viewer = this.viewer().then(
      (id) => ({ id, error: undefined }),
      (error: unknown) => ({ id: undefined, error: message(error) }),
    )
    const summaries = async (values: z.infer<typeof pull>[]) => {
      const me = await viewer
      return values.map((value) => ({
        ...this.summary(value, me.id),
        ...(me.error ? { statusError: `Viewer identity unavailable: ${me.error}` } : {}),
      }))
    }
    // Azure has no combined closed-state filter. Read both states before paging so
    // abandoned requests never disappear behind a page full of completed requests.
    if (state === 'closed') {
      const values = (
        await Promise.all(
          ['completed', 'abandoned'].map(async (status) => {
            const result = z.object({ value: z.array(pull) }).parse(
              await this.http.json(
                this.api(`${this.path}/pullrequests`, {
                  'searchCriteria.status': status,
                  $top: String(page * 50 + 1),
                }),
              ),
            )
            return result.value
          }),
        )
      )
        .flat()
        .sort((a, b) =>
          (b.closedDate ?? b.creationDate).localeCompare(a.closedDate ?? a.creationDate),
        )
      return {
        pulls: await summaries(values.slice((page - 1) * 50, page * 50)),
        page,
        hasMore: values.length > page * 50,
      }
    }
    const result = z.object({ value: z.array(pull) }).parse(
      await this.http.json(
        this.api(`${this.path}/pullrequests`, {
          'searchCriteria.status': state === 'all' ? 'all' : 'active',
          $top: '51',
          $skip: String((page - 1) * 50),
        }),
      ),
    )
    return {
      pulls: await summaries(result.value.slice(0, 50)),
      page,
      hasMore: result.value.length > 50,
    }
  }
  private async get(number: number) {
    const value = pull.parse(
      await this.http.json(this.api(`${this.scoped()}/pullrequests/${number}`)),
    )
    if (!value.lastMergeSourceCommit || !value.lastMergeTargetCommit)
      throw new HttpError(
        400,
        'Azure is still preparing this pull request. Refresh when its source and target commits are available.',
      )
    return {
      ...value,
      lastMergeSourceCommit: value.lastMergeSourceCommit,
      lastMergeTargetCommit: value.lastMergeTargetCommit,
    }
  }
  private async iterations(number: number) {
    const result = z
      .object({ value: z.array(iteration) })
      .parse(await this.http.json(this.api(`${this.path}/pullrequests/${number}/iterations`)))
    const latest = result.value.reduce<z.infer<typeof iteration> | undefined>(
      (latest, entry) => (!latest || entry.id > latest.id ? entry : latest),
      undefined,
    )
    if (!latest) throw new HttpError(400, 'Azure returned no pull request iteration')
    return latest
  }
  private async changes(number: number, id: number) {
    const values: z.infer<typeof change>[] = []
    let skip = 0
    const seen = new Set<number>()
    for (;;) {
      if (seen.has(skip) || seen.size >= 100)
        throw new HttpError(400, 'Azure changed-file pagination could not be completed')
      seen.add(skip)
      const result = z
        .object({
          changeEntries: z.array(change),
          nextSkip: z.number().int().nonnegative().default(0),
          nextTop: z.number().int().nonnegative().default(0),
        })
        .parse(
          await this.http.json(
            this.api(`${this.path}/pullrequests/${number}/iterations/${id}/changes`, {
              $compareTo: '0',
              $top: '100',
              $skip: String(skip),
            }),
          ),
        )
      values.push(...result.changeEntries.filter((entry) => !entry.item.isFolder))
      if (!result.nextSkip && !result.nextTop) return values
      skip = result.nextSkip
    }
  }
  private async content(path: string, sha: string, repositoryPath = this.path) {
    const result = z
      .object({
        content: z.string().optional(),
        contentMetadata: z.object({ isBinary: z.boolean().optional() }).optional(),
      })
      .parse(
        await this.http.json(
          this.api(`${repositoryPath}/items`, {
            path,
            'versionDescriptor.version': sha,
            'versionDescriptor.versionType': 'commit',
            includeContent: 'true',
          }),
        ),
      )
    if (
      result.contentMetadata?.isBinary ||
      result.content === undefined ||
      result.content.includes('\0')
    )
      throw new HttpError(400, 'Binary or unavailable file content')
    if (result.content.length > 1_000_000)
      throw new HttpError(400, 'File exceeds the diff preview limit')
    return result.content
  }
  private fileStatus(value: z.infer<typeof change>) {
    const type = value.changeType
    if (typeof type === 'number')
      return type & 16 ? 'removed' : type & 1 ? 'added' : type & 8 ? 'renamed' : 'modified'
    return /delete/i.test(type)
      ? 'removed'
      : /add/i.test(type)
        ? 'added'
        : /rename/i.test(type)
          ? 'renamed'
          : 'modified'
  }
  private async files(
    changes: z.infer<typeof change>[],
    current: z.infer<typeof iteration>,
    sourcePath: string,
    warnings: string[],
  ) {
    const files: PullDetail['files'] = changes.map((entry) => ({
      path: safePath(entry.item.path),
      previousPath: entry.originalPath ? safePath(entry.originalPath) : undefined,
      status: this.fileStatus(entry),
      additions: null,
      deletions: null,
    }))
    // Four requests at once, at most 100 previews; metadata stays complete for larger PRs.
    for (let start = 0; start < Math.min(files.length, 100); start += 4)
      await Promise.all(
        files.slice(start, start + 4).map(async (file, offset) => {
          const entry = changes[start + offset]!
          try {
            const [before, after] = await Promise.all([
              file.status === 'added'
                ? ''
                : this.content(
                    entry.originalPath ?? entry.item.path,
                    current.commonRefCommit.commitId,
                  ),
              file.status === 'removed'
                ? ''
                : this.content(entry.item.path, current.sourceRefCommit.commitId, sourcePath),
            ])
            const raw = createTwoFilesPatch(
              file.status === 'added' ? '/dev/null' : `a/${file.previousPath ?? file.path}`,
              file.status === 'removed' ? '/dev/null' : `b/${file.path}`,
              before,
              after,
              '',
              '',
              { context: 3, timeout: 250, maxEditLength: 10000 },
            )
            if (raw === undefined)
              throw new HttpError(400, 'Diff exceeds the preview complexity limit')
            const parsed = parseForgeDiff(raw)[0]
            if (parsed) {
              file.patch = parsed.patch
              file.additions = parsed.additions
              file.deletions = parsed.deletions
            } else if (before === after) {
              file.additions = 0
              file.deletions = 0
            } else throw new HttpError(400, 'Diff could not be parsed')
          } catch (error) {
            warnings.push(`Diff unavailable for ${file.path}: ${message(error)}`)
          }
        }),
      )
    if (files.length > 100)
      warnings.push(
        'Diff previews are limited to the first 100 files. All changed file names are shown.',
      )
    return files
  }
  private async viewer() {
    return z
      .object({ authenticatedUser: identity })
      .parse(
        await this.http.json(
          '_apis/connectionData?connectOptions=1&lastChangeId=-1&lastChangeId64=-1',
        ),
      ).authenticatedUser.id
  }
  async detail(number: number): Promise<PullDetail> {
    const value = await this.get(number)
    const path = `${this.path}/pullrequests/${number}`
    const policyPath = `${encodeURIComponent(this.project)}/_apis/policy/evaluations?${new URLSearchParams({ artifactId: `vstfs:///CodeReview/CodeReviewId/${value.repository.project.id}/${number}`, 'api-version': '7.1-preview.1' })}`
    const results = await Promise.allSettled([
      this.iterations(number),
      this.http
        .json(this.api(`${path}/threads`))
        .then((data) => z.object({ value: z.array(thread) }).parse(data).value),
      this.http
        .json(this.api(`${path}/statuses`))
        .then((data) => z.object({ value: z.array(status) }).parse(data).value),
      this.http
        .json(policyPath)
        .then((data) => z.object({ value: z.array(policy) }).parse(data).value),
      this.viewer(),
    ])
    const [iterationResult, threadResult, statusResult, policyResult, viewerResult] = results
    const warnings = [
      'Azure does not expose a general PR update time. Lists use the creation or completion date.',
    ]
    for (const [index, result] of results.entries())
      if (result.status === 'rejected') {
        const sections =
          [
            ['Files'],
            ['Conversation', 'Inline comments'],
            ['Checks'],
            ['Checks'],
            ['Viewer identity'],
          ][index] ?? []
        for (const section of sections)
          warnings.push(
            `${section}: ${index === 3 ? 'Policies unavailable. ' : ''}${message(result.reason)}`,
          )
      }
    const latest = iterationResult.status === 'fulfilled' ? iterationResult.value : undefined
    if (latest && latest.sourceRefCommit.commitId !== value.lastMergeSourceCommit.commitId)
      throw new HttpError(
        409,
        'The pull request changed while loading. Refresh it to load the latest diff.',
      )
    let files: PullDetail['files'] = []
    const headRepository = value.forkSource?.repository ?? value.repository
    const sourcePath = `${encodeURIComponent(headRepository.project.name)}/_apis/git/repositories/${encodeURIComponent(headRepository.id)}`
    if (latest) {
      try {
        files = await this.files(
          await this.changes(number, latest.id),
          latest,
          sourcePath,
          warnings,
        )
      } catch (error) {
        warnings.push(`Files: ${message(error)}`)
      }
    }
    const comments: PullComment[] = []
    const url = this.url(value)
    if (threadResult.status === 'fulfilled')
      for (const entry of threadResult.value) {
        if (entry.isDeleted) continue
        const resolved =
          ['fixed', 'wontFix', 'closed', 'byDesign'].includes(String(entry.status)) ||
          [2, 3, 4, 5].includes(Number(entry.status))
        for (const item of entry.comments) {
          if (
            item.isDeleted ||
            item.commentType === 'system' ||
            item.commentType === 3 ||
            item.commentType === 'codeChange' ||
            item.commentType === 2
          )
            continue
          comments.push({
            id: String(item.id),
            threadId: String(entry.id),
            resolved,
            canResolve: true,
            author: label(item.author),
            body: item.content ?? '',
            date: item.publishedDate,
            url: `${url}?discussionId=${entry.id}`,
            kind: entry.threadContext?.filePath ? 'inline' : 'comment',
            path: entry.threadContext?.filePath
              ? safePath(entry.threadContext.filePath)
              : undefined,
            line:
              entry.threadContext?.rightFileStart?.line ?? entry.threadContext?.leftFileStart?.line,
            replyTo: item.parentCommentId ? String(item.parentCommentId) : undefined,
            outdated:
              latest && entry.pullRequestThreadContext?.iterationContext
                ? entry.pullRequestThreadContext.iterationContext.secondComparingIteration <
                  latest.id
                : undefined,
          })
        }
      }
    for (const entry of value.reviewers)
      if (entry.vote)
        comments.push({
          id: `review-${entry.id}`,
          author: label(entry),
          body:
            entry.vote === 5
              ? 'Approved with suggestions'
              : entry.vote === -5
                ? 'Waiting for author'
                : '',
          date: value.closedDate ?? value.creationDate,
          url,
          kind: 'review',
          state: reviewState(entry.vote),
        })
    const checks: PullDetail['checks'] =
      statusResult.status === 'fulfilled'
        ? statusResult.value
            .filter((entry) => !entry.iterationId || !latest || entry.iterationId === latest.id)
            .map((entry) => ({
              name: [entry.context.genre, entry.context.name].filter(Boolean).join(' / '),
              status:
                entry.state === 'succeeded'
                  ? 'SUCCESS'
                  : entry.state === 'pending'
                    ? 'PENDING'
                    : entry.state === 'failed' || entry.state === 'error'
                      ? 'FAILURE'
                      : entry.state,
              url: entry.targetUrl ?? undefined,
            }))
        : []
    if (policyResult.status === 'fulfilled')
      for (const entry of policyResult.value)
        checks.push({
          name: `${entry.configuration.type.displayName}${entry.configuration.isBlocking ? ' (required)' : ''}`,
          status:
            entry.status === 'approved'
              ? 'SUCCESS'
              : entry.status === 'rejected' || entry.status === 'broken'
                ? 'FAILURE'
                : entry.status === 'notApplicable'
                  ? 'SKIPPED'
                  : 'PENDING',
          url: entry.context?.buildId
            ? `${this.http.connection.baseUrl}/${encodeURIComponent(this.project)}/_build/results?buildId=${entry.context.buildId}`
            : url,
        })
    const countsKnown =
      !!latest &&
      !warnings.some((warning) => warning.startsWith('Files:')) &&
      files.every((file) => file.additions !== null && file.deletions !== null)
    const fileBaseUrl = new URL(headRepository.webUrl)
    fileBaseUrl.search = new URLSearchParams({
      path: '/',
      version: `GC${value.lastMergeSourceCommit.commitId}`,
    }).toString()
    return {
      capabilities,
      fileBaseUrl: fileBaseUrl.href,
      pull: {
        ...this.summary(value),
        updatedAt:
          latest?.updatedDate ?? latest?.createdDate ?? value.closedDate ?? value.creationDate,
        viewerIsAuthor:
          viewerResult.status === 'fulfilled'
            ? viewerResult.value === value.createdBy.id
            : undefined,
        viewerReviewRequested:
          viewerResult.status === 'fulfilled'
            ? value.reviewers.some((entry) => entry.id === viewerResult.value && entry.vote === 0)
            : undefined,
        provider: 'azure-devops',
        connectionId: this.http.connection.id,
        headSha: value.lastMergeSourceCommit.commitId,
        baseSha: latest?.commonRefCommit.commitId ?? value.lastMergeTargetCommit.commitId,
        repositoryUrl: value.repository.webUrl,
        cloneUrl: this.repo(headRepository).cloneUrl,
        headRef: value.sourceRefName,
        body: value.description ?? '',
        additions: countsKnown ? files.reduce((sum, file) => sum + (file.additions ?? 0), 0) : null,
        deletions: countsKnown ? files.reduce((sum, file) => sum + (file.deletions ?? 0), 0) : null,
        changedFiles: files.length,
        mergeable:
          value.mergeStatus === 'succeeded'
            ? true
            : value.mergeStatus === 'conflicts' || value.mergeStatus === 'failure'
              ? false
              : null,
        reviewers: value.reviewers.map((entry) => entry.id),
        assignees: [],
      },
      files,
      comments,
      checks,
      warnings,
    }
  }
  private async current(number: number, sha: string) {
    const value = await this.get(number)
    if (value.lastMergeSourceCommit.commitId !== sha)
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
    return { number: value.pullRequestId, url: this.url(value), status }
  }
  private description(body: string) {
    if (body.length > 4000)
      throw new HttpError(400, 'Azure pull request descriptions are limited to 4,000 characters')
    return body
  }
  async create(input: PullCreate) {
    this.scoped()
    const value = pull.parse(
      await this.http.json(this.api(`${this.path}/pullrequests`), {
        method: 'POST',
        body: {
          title: input.title,
          description: this.description(input.body),
          sourceRefName: branchRef(input.head),
          targetRefName: branchRef(input.base),
          isDraft: input.draft,
        },
      }),
    )
    return this.result(value, 'created')
  }
  async comment(input: z.infer<typeof pullLineCommentSchema>) {
    const value = await this.current(input.number, input.headSha)
    const latest = await this.iterations(input.number)
    if (latest.sourceRefCommit.commitId !== input.headSha)
      throw new HttpError(409, 'The pull request changed. Refresh before commenting.')
    const files = await this.changes(input.number, latest.id)
    const file = files.find((entry) => safePath(entry.item.path) === safePath(input.path))
    if (!file)
      throw new HttpError(400, 'The selected file is not part of the current pull request diff')
    const side = input.side === 'additions' ? 'right' : 'left'
    const created = z.object({ id: z.number() }).parse(
      await this.http.json(this.api(`${this.path}/pullrequests/${input.number}/threads`), {
        method: 'POST',
        body: {
          comments: [{ parentCommentId: 0, content: input.body, commentType: 1 }],
          status: 1,
          threadContext: {
            filePath: file.item.path,
            [`${side}FileStart`]: { line: input.start, offset: 1 },
            [`${side}FileEnd`]: { line: input.end, offset: 1 },
          },
          pullRequestThreadContext: {
            changeTrackingId: file.changeTrackingId,
            iterationContext: {
              firstComparingIteration: latest.id,
              secondComparingIteration: latest.id,
            },
          },
        },
      }),
    )
    return { url: `${this.url(value)}?discussionId=${created.id}` }
  }
  async act(input: PullAction): Promise<PullActionResult> {
    if (input.action === 'reviewers' && input.teams.length)
      throw new HttpError(400, 'Use Azure identity GUIDs for individual or group reviewers')
    const value = await this.current(input.number, input.headSha)
    const path = `${this.path}/pullrequests/${input.number}`
    if (input.action === 'comment' || input.action === 'review') {
      if (input.action === 'review' && input.event === 'comment' && !input.body)
        throw new HttpError(400, 'Enter a review comment')
      if (input.body)
        await this.http.json(this.api(`${path}/threads`), {
          method: 'POST',
          body: {
            comments: [{ parentCommentId: 0, content: input.body, commentType: 1 }],
            status: 1,
          },
        })
      if (input.action === 'review' && input.event !== 'comment') {
        const id = await this.viewer()
        await this.http.json(this.api(`${path}/reviewers/${encodeURIComponent(id)}`), {
          method: 'PUT',
          body: { id, vote: input.event === 'approve' ? 10 : -10 },
        })
      }
    } else if (input.action === 'reply') {
      if (!input.threadId) throw new HttpError(400, 'An Azure reply requires its thread ID')
      const id = z.coerce.number().int().positive().parse(input.threadId)
      const parent = z.coerce.number().int().positive().parse(input.commentId)
      await this.http.json(this.api(`${path}/threads/${id}/comments`), {
        method: 'POST',
        body: { parentCommentId: parent, content: input.body, commentType: 1 },
      })
    } else if (input.action === 'resolve') {
      const id = z.coerce.number().int().positive().parse(input.threadId)
      await this.http.json(this.api(`${path}/threads/${id}`), {
        method: 'PATCH',
        body: { status: input.resolved ? 'fixed' : 'active' },
      })
    } else if (input.action === 'edit') {
      await this.http.json(this.api(path), {
        method: 'PATCH',
        body: {
          title: input.title,
          description: this.description(input.body),
          ...(input.base ? { targetRefName: branchRef(input.base) } : {}),
        },
      })
    } else if (input.action === 'reviewers') {
      const ids = input.reviewers.map((id) => z.uuid().parse(id))
      if (input.operation === 'remove') {
        for (const entry of value.reviewers.filter((entry) => ids.includes(entry.id)))
          await this.http.json(this.api(`${path}/reviewers/${encodeURIComponent(entry.id)}`), {
            method: 'DELETE',
          })
      } else {
        for (const id of [...new Set(ids)].filter(
          (id) => !value.reviewers.some((entry) => entry.id === id),
        ))
          await this.http.json(this.api(`${path}/reviewers/${id}`), {
            method: 'PUT',
            body: { id, vote: 0 },
          })
      }
    } else if (input.action === 'close' || input.action === 'reopen') {
      if (value.status === 'completed')
        throw new HttpError(400, 'A completed Azure pull request cannot be reopened or abandoned')
      await this.http.json(this.api(path), {
        method: 'PATCH',
        body: { status: input.action === 'close' ? 'abandoned' : 'active' },
      })
    } else if (input.action === 'merge') {
      const merged = pull.parse(
        await this.http.json(this.api(path), {
          method: 'PATCH',
          body: {
            status: 'completed',
            lastMergeSourceCommit: { commitId: input.headSha },
            completionOptions: {
              mergeStrategy:
                input.method === 'merge'
                  ? 'noFastForward'
                  : input.method === 'squash'
                    ? 'squash'
                    : 'rebase',
              deleteSourceBranch: false,
              bypassPolicy: false,
              ...(input.message ? { mergeCommitMessage: input.message } : {}),
            },
          },
        }),
      )
      if (merged.mergeFailureMessage) throw new HttpError(409, merged.mergeFailureMessage)
      return this.result(merged, merged.status === 'completed' ? 'merged' : 'queued')
    }
    return this.result(value, input.action === 'review' ? 'submitted' : 'updated')
  }
}
