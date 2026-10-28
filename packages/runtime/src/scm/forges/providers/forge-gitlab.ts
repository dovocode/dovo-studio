import { Schema } from 'effect'
import {
  decode,
  mutableArray,
  forgeRepositorySchema,
  forgeRepositoryPageSchema,
  pullPageSchema,
  pullDetailSchema,
  pullActionSchema,
  pullCreateSchema,
  pullActionResultSchema,
  type PullSummary,
  type PullDetail,
  type PullAction,
  type PullCreate,
  type pullLineCommentSchema,
} from '@dovo/protocol'
import type { ForgeHttp } from '../integration/forge-http.js'
import { completeForgeDiff } from '../integration/forge-diff.js'
import type { ForgeAdapter } from '../integration/forge-types.js'
import { HttpError, errorMessage } from '../../../errors.js'
import {
  gitlabProject,
  gitlabMergeRequest,
  gitlabUser,
  gitlabNote,
  gitlabDiff,
} from './forge-gitlab-schemas.js'

type Transport = Pick<ForgeHttp, 'connection' | 'json' | 'text'>
type MergeRequest = typeof gitlabMergeRequest.Type
const SIZE = 50

export function gitlabProjectPath(repository: string) {
  const parts = repository.split('/')
  if (
    parts.length < 2 ||
    parts.some((part) => !part || ['.', '..'].includes(part) || /[\p{Cc}\s\\?#%]/u.test(part))
  )
    throw new HttpError(400, 'Enter the GitLab project as group/project or group/subgroup/project.')
  return `/api/v4/projects/${encodeURIComponent(repository)}`
}
function pageNumber(page: number) {
  if (!Number.isSafeInteger(page) || page < 1) throw new HttpError(400, 'Choose a valid page.')
  return page
}
export class GitLabForge implements ForgeAdapter {
  private readonly projectPath: string
  constructor(
    private readonly http: Transport,
    repository: string,
  ) {
    this.projectPath = repository ? gitlabProjectPath(repository) : ''
  }
  private get path() {
    if (!this.projectPath) throw new HttpError(400, 'Choose a GitLab project first.')
    return this.projectPath
  }
  private mapProject(project: typeof gitlabProject.Type) {
    return decode(forgeRepositorySchema, {
      id: String(project.id),
      name: project.name,
      fullName: project.path_with_namespace,
      url: project.web_url,
      cloneUrl: project.http_url_to_repo,
      defaultBranch: project.default_branch ?? undefined,
    })
  }
  async repository() {
    return this.mapProject(decode(gitlabProject, await this.http.json(this.path)))
  }
  async repositories(page: number) {
    const rows = decode(
      mutableArray(gitlabProject),
      await this.http.json(
        `/api/v4/projects?membership=true&order_by=last_activity_at&sort=desc&per_page=${SIZE}&page=${pageNumber(page)}`,
      ),
    )
    return decode(forgeRepositoryPageSchema, {
      repositories: rows.map((project) => this.mapProject(project)),
      page,
      hasMore: rows.length === SIZE,
    })
  }
  private summary(pull: MergeRequest, viewer: string): PullSummary {
    const author = pull.author?.username
    const assigned = pull.assignees?.some((user) => user.username === viewer) ?? false
    const review = pull.reviewers?.some((user) => user.username === viewer) ?? false
    return {
      provider: 'gitlab',
      number: pull.iid,
      title: pull.title,
      url: pull.web_url,
      state: pull.state === 'merged' ? 'merged' : pull.state === 'opened' ? 'open' : 'closed',
      draft: pull.draft ?? pull.work_in_progress ?? /^(?:Draft|WIP):/i.test(pull.title),
      author: author ?? 'Deleted user',
      authorAvatarUrl: pull.author?.avatar_url || undefined,
      updatedAt: pull.updated_at,
      head: pull.source_branch,
      base: pull.target_branch,
      labels: pull.labels,
      viewerIsAuthor: author === viewer,
      viewerIsAssigned: assigned,
      viewerIsInvolved: author === viewer || assigned || review,
      viewerReviewRequested: review,
      commentCount: pull.user_notes_count,
      checksState: pull.head_pipeline?.status ?? null,
    }
  }
  private async pull(number: number) {
    pageNumber(number)
    return decode(gitlabMergeRequest, await this.http.json(`${this.path}/merge_requests/${number}`))
  }
  async list(state: 'open' | 'closed' | 'all', page: number) {
    if (!['open', 'closed', 'all'].includes(state))
      throw new HttpError(400, 'Choose a valid merge request state.')
    // GitLab's `closed` excludes merged MRs; fetch all and filter to retain Dovo's closed semantics.
    const selected = state === 'open' ? 'opened' : 'all'
    const [rows, viewer] = await Promise.all([
      this.http
        .json(
          `${this.path}/merge_requests?state=${selected}&order_by=updated_at&sort=desc&per_page=${SIZE}&page=${pageNumber(page)}`,
        )
        .then((value) => decode(mutableArray(gitlabMergeRequest), value)),
      this.http.json('/api/v4/user').then((value) => decode(gitlabUser, value)),
    ])
    return decode(pullPageSchema, {
      pulls: rows
        .filter((pull) => state !== 'closed' || pull.state !== 'opened')
        .map((pull) => this.summary(pull, viewer.username)),
      page,
      hasMore: rows.length === SIZE,
    })
  }
  private async all<T, I>(path: string, schema: Schema.Codec<T, I>) {
    const rows: T[] = []
    for (let page = 1; page <= 100; page++) {
      const batch = decode(
        mutableArray(schema),
        await this.http.json(
          `${path}${path.includes('?') ? '&' : '?'}per_page=${SIZE}&page=${page}`,
        ),
      )
      rows.push(...batch)
      if (batch.length < SIZE) return rows
    }
    throw new HttpError(502, 'GitLab returned too many pages. Open the remaining data on GitLab.')
  }
  async detail(number: number) {
    const [pull, repo, viewer] = await Promise.all([
      this.pull(number),
      this.http.json(this.path).then((value) => decode(gitlabProject, value)),
      this.http.json('/api/v4/user').then((value) => decode(gitlabUser, value)),
    ])
    const base = `${this.path}/merge_requests/${number}`
    const results = await Promise.allSettled([
      this.all(`${base}/notes?sort=asc&order_by=created_at`, gitlabNote),
      this.all(`${base}/diffs`, gitlabDiff),
      pull.source_project_id && pull.source_project_id !== repo.id
        ? this.http
            .json(`/api/v4/projects/${pull.source_project_id}`)
            .then((value) => decode(gitlabProject, value))
        : Promise.resolve(repo),
    ])
    const [notes, diffs, headProject] = results
    const warnings = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [`${['Conversation', 'Diff', 'Source project'][index]}: ${errorMessage(result.reason)}`]
        : [],
    )
    const files: PullDetail['files'] =
      diffs.status === 'fulfilled'
        ? diffs.value.map((file) => ({
            path: file.new_path,
            previousPath: file.renamed_file ? file.old_path : undefined,
            status: file.new_file
              ? 'added'
              : file.deleted_file
                ? 'removed'
                : file.renamed_file
                  ? 'renamed'
                  : 'modified',
            additions: null,
            deletions: null,
            patch: file.collapsed || file.too_large ? undefined : file.diff || undefined,
          }))
        : []
    if (!pull.diff_refs?.base_sha || !pull.sha)
      throw new HttpError(
        409,
        'GitLab has not prepared this merge request’s commits yet. Refresh shortly.',
      )
    if (
      diffs.status === 'fulfilled' &&
      diffs.value.some((file) => file.collapsed || file.too_large)
    ) {
      try {
        const patches = completeForgeDiff(await this.http.text(`${base}/raw_diffs`))
        for (const [index, source] of diffs.value.entries()) {
          const file = files[index]!
          if ((!source.collapsed && !source.too_large) || file.patch) continue
          const matches = patches.filter(
            (patch) => patch.path === file.path && patch.previousPath === file.previousPath,
          )
          if (matches.length === 1 && matches[0]?.patch) file.patch = matches[0].patch
        }
        if (
          diffs.value.some(
            (source, index) => (source.collapsed || source.too_large) && !files[index]?.patch,
          )
        )
          warnings.push(
            'GitLab omitted some large or binary diffs. Open the merge request on GitLab to see them.',
          )
        if (
          diffs.value.some(
            (source, index) => (source.collapsed || source.too_large) && files[index]?.patch,
          )
        )
          warnings.push(
            'Recovered large diffs may be incomplete; open GitLab to verify the full change.',
          )
      } catch (error) {
        warnings.push(`Raw diff unavailable or incomplete: ${errorMessage(error)}`)
      }
      const current = await this.pull(number)
      if (current.sha !== pull.sha || current.diff_refs?.base_sha !== pull.diff_refs.base_sha)
        throw new HttpError(
          409,
          'The merge request changed while loading its diff. Refresh and try again.',
        )
    }
    return decode(pullDetailSchema, {
      capabilities: {
        actions: ['create', 'edit', 'comment', 'merge', 'close', 'reopen'],
        reviewDecisions: [],
        mergeMethods:
          repo.squash_option === 'always'
            ? ['squash']
            : repo.squash_option === 'never'
              ? ['merge']
              : ['merge', 'squash'],
        draft: true,
        inlineRange: false,
      },
      fileBaseUrl:
        headProject.status === 'fulfilled'
          ? `${headProject.value.web_url}/-/blob/${pull.sha}/`
          : undefined,
      pull: {
        ...this.summary(pull, viewer.username),
        headSha: pull.sha,
        baseSha: pull.diff_refs.base_sha,
        repositoryUrl: repo.web_url,
        cloneUrl: repo.http_url_to_repo,
        headCloneUrl:
          headProject.status === 'fulfilled' ? headProject.value.http_url_to_repo : undefined,
        connectionId: this.http.connection.id,
        headRef: `refs/merge-requests/${number}/head`,
        body: pull.description ?? '',
        additions: null,
        deletions: null,
        changedFiles: diffs.status === 'fulfilled' ? files.length : null,
        mergeable:
          pull.detailed_merge_status === 'mergeable'
            ? true
            : pull.detailed_merge_status === 'conflict'
              ? false
              : null,
        reviewers: pull.reviewers?.map((user) => user.username) ?? [],
        assignees: pull.assignees?.map((user) => user.username) ?? [],
      },
      comments:
        notes.status === 'fulfilled'
          ? notes.value
              .filter((note) => !note.system)
              .map((note) => ({
                id: String(note.id),
                author: note.author?.username ?? 'Deleted user',
                body: note.body,
                date: note.created_at,
                url: `${pull.web_url}#note_${note.id}`,
                kind: 'comment',
              }))
          : [],
      files,
      checks: pull.head_pipeline
        ? [
            {
              name: pull.head_pipeline.name ?? 'Pipeline',
              id: String(pull.head_pipeline.id),
              status: pull.head_pipeline.status,
              url: pull.head_pipeline.web_url,
            },
          ]
        : [],
      warnings,
    })
  }
  async comment(_input: typeof pullLineCommentSchema.Type): Promise<{ url: string }> {
    throw new HttpError(
      400,
      'Use GitLab for inline review comments. Plain comments are supported in Dovo.',
    )
  }
  async create(value: PullCreate) {
    const input = decode(pullCreateSchema, value)
    const pull = decode(
      gitlabMergeRequest,
      await this.http.json(`${this.path}/merge_requests`, {
        method: 'POST',
        body: {
          title:
            input.draft && !/^Draft:/i.test(input.title) ? `Draft: ${input.title}` : input.title,
          description: input.body,
          source_branch: input.head,
          target_branch: input.base,
        },
      }),
    )
    return decode(pullActionResultSchema, {
      number: pull.iid,
      url: pull.web_url,
      status: 'created',
    })
  }
  async act(value: PullAction) {
    const input = decode(pullActionSchema, value)
    const pull = await this.pull(input.number)
    if (pull.sha !== input.headSha)
      throw new HttpError(409, 'This merge request changed. Refresh before submitting this action.')
    const path = `${this.path}/merge_requests/${input.number}`
    let status: 'updated' | 'submitted' | 'merged' = 'updated'
    switch (input.action) {
      case 'comment':
        await this.http.json(`${path}/notes`, { method: 'POST', body: { body: input.body } })
        status = 'submitted'
        break
      case 'edit':
        await this.http.json(path, {
          method: 'PUT',
          body: {
            title: input.title,
            description: input.body,
            ...(input.base ? { target_branch: input.base } : {}),
          },
        })
        break
      case 'close':
      case 'reopen':
        await this.http.json(path, {
          method: 'PUT',
          body: { state_event: input.action === 'close' ? 'close' : 'reopen' },
        })
        break
      case 'merge': {
        if (input.method === 'rebase')
          throw new HttpError(
            400,
            'GitLab uses the project’s configured merge strategy. Choose merge or squash.',
          )
        const result = decode(
          gitlabMergeRequest,
          await this.http.json(`${path}/merge`, {
            method: 'PUT',
            body: {
              sha: input.headSha,
              squash: input.method === 'squash',
              ...(input.message !== undefined ? { merge_commit_message: input.message } : {}),
            },
          }),
        )
        if (result.state !== 'merged')
          throw new HttpError(
            409,
            'GitLab has not confirmed this merge request was merged. Refresh before trying again.',
          )
        status = 'merged'
        break
      }
      default:
        throw new HttpError(400, 'Use GitLab for this review operation.')
    }
    return decode(pullActionResultSchema, { number: pull.iid, url: pull.web_url, status })
  }
}
