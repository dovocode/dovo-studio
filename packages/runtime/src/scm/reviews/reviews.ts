import { runClientEffect } from '@dovo/client-runtime'
import { LocalCommits } from '../git/local-commits.js'
import { createTwoFilesPatch } from 'diff'
import { randomUUID } from 'node:crypto'
import { guideSteps } from './guide.js'
import {
  githubPullTarget,
  decode,
  featureReviewSchema,
  featureReviewGroups,
  reviewRevision,
  reviewGuideState,
  type ReviewGuide,
  type reviewGuideMoveSchema,
  type TitleGenerationSettings,
  changedFileFingerprint,
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

export const pullReviewScope = (detail: PullDetail) =>
  JSON.stringify(['pull', detail.pull.connectionId ?? '', detail.pull.url])
export const pullReviewFiles = (detail: PullDetail) =>
  detail.files.map((file) => ({
    path: file.path,
    fingerprint: pullFileFingerprint(file, detail.pull),
  }))

export const pullReviewRevision = (detail: PullDetail) =>
  reviewRevision(
    pullReviewFiles(detail),
    JSON.stringify([pullReviewScope(detail), detail.pull.baseSha, detail.pull.headSha]),
  )
/** A client holding this guide needs only its mutable state; steps never change. */
const withKnownGuide = (progress: ReviewProgress, knownGuide?: string): ReviewProgress => {
  const { guide, ...rest } = progress
  return guide && guide.id === knownGuide
    ? { ...rest, guideState: reviewGuideState(guide) }
    : progress
}
const sameFiles = (
  a: { path: string; fingerprint: string }[],
  b: { path: string; fingerprint: string }[],
) => reviewRevision(a, '') === reviewRevision(b, '')

export class FileReviews {
  private pending = new Map<string, Promise<unknown>>()
  private organizers = new Map<string, symbol>()
  private evidenceRefreshes = new Map<string, { revision?: string; at: number }>()
  constructor(
    private services: Pick<Services, 'store' | 'git' | 'checkouts' | 'pullCache' | 'reviewMarks'>,
  ) {}
  /** Serialize scope reads/writes, so an older disk read cannot restore an invalidated mark. */
  request(
    context: ReviewContext,
    mark?: { path: string; fingerprint: string; viewed: boolean; version: number },
    guideUpdate?:
      | { move: typeof reviewGuideMoveSchema.Type }
      | { save: ReviewGuide; valid: () => boolean },
    knownGuide?: string,
  ) {
    const key = JSON.stringify(
      context.kind === 'pull'
        ? ['pull', context.repositoryId, context.number]
        : [
            'task',
            context.taskId,
            context.source,
            context.turnId ?? '',
            context.checkoutId ?? '',
            context.commitSha ?? '',
          ],
    )
    const work = (this.pending.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(() => this.resolve(context, mark, undefined, guideUpdate))
      .then((progress) => withKnownGuide(progress, knownGuide))
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
    guided = false,
    revision?: string,
  ) {
    const key = JSON.stringify(context)
    const claim = Symbol('review generation')
    this.organizers.set(key, claim)
    try {
      const result = await this.resolve(context, undefined, {
        selection: selection ?? titles.read(),
        expected,
        titles,
        guided,
        revision,
      })
      if (this.organizers.get(key) !== claim)
        throw new HttpError(409, 'A newer review generation replaced this request.')
      const current = await this.request(
        context,
        undefined,
        result.guide && guided
          ? {
              save: result.guide,
              valid: () => this.organizers.get(key) === claim,
            }
          : undefined,
      )
      if (!sameFiles(current.files, expected))
        throw new HttpError(
          409,
          'Changes updated during analysis. Organize the current diff again.',
        )
      return { ...result, files: current.files }
    } finally {
      if (this.organizers.get(key) === claim) this.organizers.delete(key)
    }
  }
  private async resolve(
    context: ReviewContext,
    mark?: { path: string; fingerprint: string; viewed: boolean; version: number },
    organize?: {
      selection: TitleGenerationSettings
      expected: { path: string; fingerprint: string }[]
      titles: TitleGeneration
      guided: boolean
      revision?: string
    },
    guideUpdate?:
      | { move: typeof reviewGuideMoveSchema.Type }
      | { save: ReviewGuide; valid: () => boolean },
  ): Promise<ReviewProgress> {
    const s = this.services
    let scope: string, files: { path: string; fingerprint: string }[]
    let changes: ChangedFile[] | undefined
    let working: ChangedFile[] | undefined
    let workingVersions: Record<string, number> | undefined
    let pullSource: PullDetail | undefined
    if (context.kind === 'pull') {
      const repo = s.store.get().repositories.find((repo) => repo.id === context.repositoryId)
      const target = !repo ? githubPullTarget(context.repositoryId) : null
      if (repo?.kind || (!repo && !target)) throw new HttpError(404, 'Git project not found')
      if (target && context.number !== target.number)
        throw new HttpError(400, 'PR target does not match its URL')
      let detail = await runClientEffect(
        s.pullCache.sectionEffect(repo?.path ?? context.repositoryId, context.number, 'changes'),
      )
      const detailScope = pullReviewScope(detail)
      const authoritative = s.reviewMarks.revision(detailScope)
      const priorRefresh = this.evidenceRefreshes.get(detailScope)
      if (
        s.reviewMarks.hasScope(detailScope) &&
        authoritative !== pullReviewRevision(detail) &&
        (!priorRefresh ||
          priorRefresh.revision !== authoritative ||
          Date.now() - priorRefresh.at >= 60_000)
      ) {
        this.evidenceRefreshes.delete(detailScope)
        this.evidenceRefreshes.set(detailScope, { revision: authoritative, at: Date.now() })
        if (this.evidenceRefreshes.size > 500)
          this.evidenceRefreshes.delete(this.evidenceRefreshes.keys().next().value!)
        detail = await runClientEffect(
          s.pullCache.sectionEffect(
            repo?.path ?? context.repositoryId,
            context.number,
            'changes',
            true,
          ),
        )
      }
      if (detail.warnings.some((warning) => warning.startsWith('Files:')))
        throw new HttpError(503, 'PR files are unavailable. Refresh the PR to try again.')
      pullSource = detail
      scope = pullReviewScope(detail)
      files = pullReviewFiles(detail)
    } else {
      const task = s.store.task(context.taskId)
      if (
        (context.source === 'turn') !== !!context.turnId ||
        (context.source === 'commit') !== !!context.commitSha ||
        (context.source === 'branch' && context.checkoutId)
      )
        throw new HttpError(400, 'Choose a valid review source')
      scope = JSON.stringify([
        'task',
        task.id,
        context.checkoutId ?? '',
        context.source,
        context.turnId ?? '',
        ...(context.source === 'commit' ? [context.commitSha] : []),
      ])
      if (context.source === 'commit' && context.commitSha) {
        const cwd = await s.checkouts.commitDirectory(task.id, context.checkoutId)
        changes = (await new LocalCommits(s.git).changes(cwd, context.commitSha)).files
      } else if (context.source === 'turn') {
        const checkpoint = task.turns?.find((turn) => turn.id === context.turnId)?.checkpoint
        const history = context.checkoutId
          ? checkpoint?.linked?.find((item) => item.checkoutId === context.checkoutId)
          : checkpoint
        if (!history) throw new HttpError(404, 'Change history not found')
        changes = checkpointFiles(history)
      } else if (context.source === 'branch') {
        const cwd = await s.checkouts.directory(task.id)
        const diff = await s.git.reviewBranchChangesFiles(cwd, s.checkouts.branchBase(task.id))
        changes = checkpointFiles(diff)
      } else if (context.checkoutId) {
        changes = await s.git.changes(
          await s.checkouts.selectedDirectory(task.id, context.checkoutId),
        )
      } else {
        const current = s.store.taskSummary(task.id)
        working = current.files
        workingVersions = current.fileReviewVersions
        changes = working
      }
      files = changes.map((file) => ({
        path: file.path,
        fingerprint: changedFileFingerprint(file),
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
      : organize || s.reviewMarks.hasScope(scope)
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
        const updated = s.store.taskSummary(context.taskId).fileReviewVersions?.[mark.path] ?? 0
        states = states.map((file) =>
          file.path === mark.path ? { ...file, viewed: mark.viewed, version: updated } : file,
        )
      } else {
        s.reviewMarks.set(scope, mark)
        states = s.reviewMarks.files(scope)
      }
    }
    const revision = reviewRevision(
      files,
      JSON.stringify([scope, pullSource?.pull.baseSha, pullSource?.pull.headSha]),
    )
    // Only a fresh PullCache fetch advances the authoritative PR revision. A cached section
    // can be older than a completed full-detail fetch, including when the patch is unchanged.
    const authoritativeRevision = pullSource ? s.reviewMarks.revision(scope) : undefined
    const staleEvidence = !!pullSource && authoritativeRevision !== revision
    if (staleEvidence && (guideUpdate || organize))
      throw new HttpError(
        409,
        'PR changes updated. Refresh the PR changes before continuing this review.',
      )
    let guide = staleEvidence ? undefined : s.reviewMarks.guide(scope, revision)
    if (guideUpdate) {
      if ('move' in guideUpdate) guide = s.reviewMarks.moveGuide(scope, revision, guideUpdate.move)
      else {
        if (!guideUpdate.valid() || guideUpdate.save.revision !== revision)
          throw new HttpError(
            409,
            'Changes updated during analysis. Generate a guide for the current diff.',
          )
        guide = guideUpdate.save
        s.reviewMarks.saveGuide(scope, context.kind === 'task' ? context.taskId : null, guide)
      }
    }
    // Clients derive a guide's groups from its steps (reviewGuideGroups); generation returns its own.
    let groups: ReviewProgress['groups'] = []
    if (organize) {
      if (organize.guided && organize.revision !== revision)
        throw new HttpError(409, 'Changes updated. Refresh before generating a review guide.')
      if (!sameFiles(files, organize.expected))
        throw new HttpError(409, 'Changes updated. Refresh the diff before organizing it.')
      if (!files.length || files.length > 500)
        throw new HttpError(400, 'Choose a diff with 1–500 files')
      // Bound evidence, retaining every path and explicitly labeling incomplete source.
      const budget = Math.min(12_000, Math.floor(180_000 / files.length))
      const evidenceByPath = new Map(changes?.map((file) => [file.path, file]))
      const patches = new Map(pullSource?.files.map((file) => [file.path, file.patch]))
      const evidence = files.map(({ path }) => {
        const file = evidenceByPath.get(path)
        const patch =
          patches.get(path) ??
          (file && !file.preview ? createTwoFilesPatch(path, path, file.before, file.after) : '')
        const bounded =
          patch.length > budget
            ? patch.slice(0, Math.max(0, patch.lastIndexOf('\n', budget)))
            : patch
        return {
          path,
          evidence: bounded,
          incomplete: !patch || patch.length > budget,
        }
      })
      const output = await organize.titles.organizeReview(
        JSON.stringify({ changes: evidence }),
        organize.selection,
      )
      try {
        const parsed: unknown = JSON.parse(
          output
            .trim()
            .replace(/^```(?:json)?\s*/, '')
            .replace(/\s*```$/, ''),
        )
        const generated = decode(featureReviewSchema, parsed)
        groups = featureReviewGroups(
          generated,
          files.map((file) => file.path),
        )
        if (organize.guided)
          guide = {
            id: randomUUID(),
            revision,
            generatedAt: new Date().toISOString(),
            steps: guideSteps(generated.groups, evidence),
            position: 0,
            seen: [],
            version: 0,
          }
      } catch {
        throw new HttpError(
          502,
          'The organizer returned invalid or incomplete feature groups. Try again or choose another model.',
        )
      }
    }
    return {
      files: working ? states : s.reviewMarks.files(scope),
      groups,
      revision,
      ...(guide ? { guide } : {}),
    }
  }
}
