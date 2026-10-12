import { createTwoFilesPatch, parsePatch } from 'diff'
import {
  decode,
  featureReviewSchema,
  featureReviewGroups,
  type TitleGenerationSettings,
  changedFileFingerprint,
  pullFilePatch,
  pullFileFingerprint,
  checkpointFiles,
  type PullDetail,
  type ReviewContext,
  type ReviewProgress,
  type ChangedFile,
} from '@dovo/protocol'
import type { TitleGeneration } from '../../agents/tasks/title-generation.js'
import type { Services } from '../../services.js'
import { HttpError } from '../../errors.js'
import { relatedFileGroups, type ReviewSource, type ReviewModule } from './order.js'
import { reviewLanguage } from './languages.js'

export const pullReviewScope = (detail: PullDetail) =>
  JSON.stringify(['pull', detail.pull.connectionId ?? '', detail.pull.url])
export const pullReviewFiles = (detail: PullDetail) =>
  detail.files.map((file) => ({
    path: file.path,
    fingerprint: pullFileFingerprint(file, detail.pull),
  }))

export class FileReviews {
  private pending = new Map<string, Promise<unknown>>()
  private ordering = new Map<string, { groups: ReviewProgress['groups']; retryAt?: number }>()
  constructor(
    private services: Pick<Services, 'store' | 'git' | 'checkouts' | 'pullCache' | 'reviewMarks'>,
  ) {}
  /** Serialize scope reads/writes, so an older disk read cannot restore an invalidated mark. */
  request(
    context: ReviewContext,
    mark?: { path: string; fingerprint: string; viewed: boolean; version: number },
  ) {
    const key = JSON.stringify(
      context.kind === 'pull'
        ? ['pull', context.repositoryId, context.number]
        : ['task', context.taskId, context.source, context.turnId ?? '', context.checkoutId ?? ''],
    )
    const work = (this.pending.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.resolve(context, mark))
    this.pending.set(key, work)
    void work
      .finally(() => {
        if (this.pending.get(key) === work) this.pending.delete(key)
      })
      .catch(() => {})
    return work
  }
  async organize(
    context: ReviewContext,
    selection: TitleGenerationSettings | undefined,
    expected: { path: string; fingerprint: string }[],
    titles: TitleGeneration,
  ) {
    const result = await this.resolve(context, undefined, {
      selection: selection ?? titles.read(),
      expected,
      titles,
    })
    const current = await this.request(context)
    if (
      JSON.stringify(current.files.map(({ path, fingerprint }) => ({ path, fingerprint }))) !==
      JSON.stringify(expected)
    )
      throw new HttpError(409, 'Changes updated during analysis. Organize the current diff again.')
    return result
  }
  private async resolve(
    context: ReviewContext,
    mark?: { path: string; fingerprint: string; viewed: boolean; version: number },
    organize?: {
      selection: TitleGenerationSettings
      expected: { path: string; fingerprint: string }[]
      titles: TitleGeneration
    },
  ): Promise<ReviewProgress> {
    const s = this.services
    let scope: string, files: { path: string; fingerprint: string }[], sources: ReviewSource[]
    let working: ChangedFile[] | undefined
    let workingVersions: Record<string, number> | undefined
    let pullSource: { cwd: string; detail: PullDetail } | undefined
    let moduleSources: (() => Promise<ReviewModule[]>) | undefined
    let sourceIdentity: string[] = []
    if (context.kind === 'pull') {
      const repo = s.store.get().repositories.find((repo) => repo.id === context.repositoryId)
      if (!repo || repo.kind) throw new HttpError(404, 'Git project not found')
      const detail = await s.pullCache.detail(repo.path, context.number)
      if (detail.warnings.some((warning) => warning.startsWith('Files:')))
        throw new HttpError(503, 'PR files are unavailable. Refresh the PR to try again.')
      pullSource = { cwd: repo.path, detail }
      moduleSources = () =>
        s.git.reviewGoModules(
          repo.path,
          detail.files,
          detail.pull.baseSha,
          detail.pull.headSha,
          true,
        )
      scope = pullReviewScope(detail)
      files = pullReviewFiles(detail)
      // Only whole added/deleted hunks provide reliable source when local Git objects are absent.
      sources = detail.files.map((file) => {
        const source: ReviewSource = { path: file.path, previousPath: file.previousPath }
        if (!file.patch) return source
        try {
          const hunks = parsePatch(pullFilePatch(file))[0]?.hunks ?? []
          const hunk = hunks.length === 1 ? hunks[0] : undefined
          if (!hunk) return source
          if (
            file.status === 'added' &&
            hunk.oldLines === 0 &&
            hunk.newStart === 1 &&
            hunk.newLines === file.additions
          ) {
            source.before = ''
            source.after = hunk.lines
              .filter((line) => line.startsWith('+'))
              .map((line) => line.slice(1))
              .join('\n')
          } else if (
            (file.status === 'removed' || file.status === 'deleted') &&
            hunk.newLines === 0 &&
            hunk.oldStart === 1 &&
            hunk.oldLines === file.deletions
          ) {
            source.after = ''
            source.before = hunk.lines
              .filter((line) => line.startsWith('-'))
              .map((line) => line.slice(1))
              .join('\n')
          }
        } catch {
          // Provider-limited or malformed patches stay in the labeled folder fallback.
        }
        return source
      })
    } else {
      const task = s.store.task(context.taskId)
      if (
        (context.source === 'turn') !== !!context.turnId ||
        (context.source === 'branch' && context.checkoutId)
      )
        throw new HttpError(400, 'Choose a valid review source')
      scope = JSON.stringify([
        'task',
        task.id,
        context.checkoutId ?? '',
        context.source,
        context.turnId ?? '',
      ])
      let changes: ChangedFile[]
      const selectedRepository = context.checkoutId
        ? task.linkedCheckouts?.find((link) => link.id === context.checkoutId)?.repositoryId
        : task.repositoryId
      sourceIdentity = [
        s.store.get().repositories.find((repo) => repo.id === selectedRepository)?.path ?? '',
        task.execution ?? '',
        task.existingWorktreePath ?? '',
        task.checkoutBranch ?? '',
        task.linkedCheckoutSetup?.find((setup) => setup.id === context.checkoutId)?.directory ?? '',
      ]
      if (context.source === 'turn') {
        const checkpoint = task.turns?.find((turn) => turn.id === context.turnId)?.checkpoint
        const history = context.checkoutId
          ? checkpoint?.linked?.find((item) => item.checkoutId === context.checkoutId)
          : checkpoint
        if (!history) throw new HttpError(404, 'Change history not found')
        changes = checkpointFiles(history)
        sourceIdentity.push(history.before, history.after ?? '')
        moduleSources = async () => {
          const repositoryId =
            'repositoryId' in history
              ? history.repositoryId
              : s.checkouts.executionRepository(task.id).id
          const repository = s.store.get().repositories.find((repo) => repo.id === repositoryId)
          return repository
            ? s.git.reviewGoModules(repository.path, changes, history.before, history.after ?? '')
            : []
        }
      } else if (context.source === 'branch') {
        const cwd = await s.checkouts.directory(task.id)
        const diff = await s.git.reviewBranchChangesFiles(cwd)
        changes = checkpointFiles(diff)
        sourceIdentity.push(cwd, diff.before, diff.after)
        moduleSources = () => s.git.reviewGoModules(cwd, changes, diff.before, diff.after)
      } else if (context.checkoutId) {
        changes = await s.git.changes(
          await s.checkouts.selectedDirectory(task.id, context.checkoutId),
        )
      } else {
        const current = s.store.task(task.id)
        working = current.files
        workingVersions = current.fileReviewVersions
        changes = working
      }
      if (context.source === 'working')
        moduleSources = async () => {
          const cwd = await s.checkouts.reviewDirectory(task.id, context.checkoutId)
          return cwd ? s.git.reviewGoModules(cwd, changes) : []
        }
      files = changes.map((file) => ({
        path: file.path,
        fingerprint: changedFileFingerprint(file),
      }))
      sources = changes.map((file) => ({
        path: file.path,
        ...(file.preview ? {} : { before: file.before, after: file.after }),
      }))
    }
    // Fresh full PR fetches reconcile in PullCache. A cached read can decorate progress,
    // but must never roll it back after a newer fetch completed.
    let states = working
      ? files.map((file, index) => ({
          ...file,
          viewed: working?.[index]?.viewed ?? false,
          version: workingVersions?.[file.path] ?? 0,
        }))
      : pullSource && s.reviewMarks.hasScope(scope)
        ? s.reviewMarks.files(scope)
        : s.reviewMarks.reconcile(scope, files)
    if (mark) {
      const current = states.find((file) => file.path === mark.path)
      if (!current || current.fingerprint !== mark.fingerprint)
        throw new HttpError(409, 'This file changed. Refresh its diff before marking it viewed.')
      if (working && context.kind === 'task') {
        if (current.version !== mark.version)
          throw new HttpError(
            409,
            'This viewed flag changed on another client. Refresh before marking it again.',
          )
        s.store.updateTask(context.taskId, (task) => ({
          ...task,
          files: task.files.map((file) =>
            file.path === mark.path ? { ...file, viewed: mark.viewed } : file,
          ),
        }))
        const updated = s.store.task(context.taskId).fileReviewVersions?.[mark.path] ?? 0
        states = states.map((file) =>
          file.path === mark.path ? { ...file, viewed: mark.viewed, version: updated } : file,
        )
      } else {
        s.reviewMarks.set(scope, mark)
        states = s.reviewMarks.files(scope)
      }
    }
    const signature = JSON.stringify([
      scope,
      files,
      pullSource?.detail.pull.baseSha,
      pullSource?.detail.pull.headSha,
      pullSource?.cwd,
      sourceIdentity,
    ])
    const cached = this.ordering.get(signature)
    let groups =
      cached && (cached.retryAt === undefined || cached.retryAt > Date.now())
        ? cached.groups
        : undefined
    if (!groups) {
      if (pullSource) {
        const { cwd, detail } = pullSource
        const local = await s.git.reviewSources(
          cwd,
          detail.pull.baseSha,
          detail.pull.headSha,
          detail.files,
        )
        const byPath = new Map(local.map((file) => [file.path, file]))
        sources = sources.map((file) => ({ ...file, ...byPath.get(file.path) }))
      }
      const modules = sources.some((file) => file.path.endsWith('.go'))
        ? ((await moduleSources?.()) ?? [])
        : []
      groups = await relatedFileGroups(sources, modules)
      // Bounded cache; identical scans reuse AST analysis across paired clients.
      if (this.ordering.size >= 24) this.ordering.delete(this.ordering.keys().next().value ?? '')
      const incomplete =
        !!pullSource &&
        sources.some(
          (file) =>
            reviewLanguage(file.path) && (file.before === undefined || file.after === undefined),
        )
      this.ordering.set(signature, {
        groups,
        ...(incomplete ? { retryAt: Date.now() + 20_000 } : {}),
      })
    }
    if (organize) {
      if (JSON.stringify(files) !== JSON.stringify(organize.expected))
        throw new HttpError(409, 'Changes updated. Refresh the diff before organizing it.')
      if (!files.length || files.length > 500)
        throw new HttpError(400, 'Choose a diff with 1–500 files')
      // Bound evidence, retaining every path and explicitly labeling incomplete source.
      const budget = Math.min(12_000, Math.floor(180_000 / files.length))
      const changes = sources.map((file) => {
        const patch = pullSource?.detail.files.find((item) => item.path === file.path)?.patch
        const evidence =
          patch ??
          (file.before === undefined || file.after === undefined
            ? ''
            : createTwoFilesPatch(file.path, file.path, file.before, file.after))
        return {
          path: file.path,
          evidence: evidence.slice(0, budget),
          incomplete: !evidence || evidence.length > budget,
        }
      })
      const output = await organize.titles.organizeReview(
        JSON.stringify({ changes, dependencies: groups }),
        organize.selection,
      )
      try {
        const parsed: unknown = JSON.parse(
          output
            .trim()
            .replace(/^```(?:json)?\s*/, '')
            .replace(/\s*```$/, ''),
        )
        groups = featureReviewGroups(
          decode(featureReviewSchema, parsed),
          files.map((file) => file.path),
        )
      } catch {
        throw new HttpError(
          502,
          'The organizer returned invalid or incomplete feature groups. Try again or choose another model.',
        )
      }
    }
    return { files: working ? states : s.reviewMarks.files(scope), groups }
  }
}
