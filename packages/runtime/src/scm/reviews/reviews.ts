import { runClientEffect } from '@dovo/client-runtime'
import { createTwoFilesPatch } from 'diff'
import {
  githubPullTarget,
  decode,
  featureReviewSchema,
  featureReviewGroups,
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

export class FileReviews {
  private pending = new Map<string, Promise<unknown>>()
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
    let scope: string, files: { path: string; fingerprint: string }[]
    let changes: ChangedFile[] | undefined
    let working: ChangedFile[] | undefined
    let workingVersions: Record<string, number> | undefined
    let pullSource: PullDetail | undefined
    let localPull = false
    if (context.kind === 'pull') {
      const repo = s.store.get().repositories.find((repo) => repo.id === context.repositoryId)
      const target = !repo ? githubPullTarget(context.repositoryId) : null
      if (repo?.kind || (!repo && !target)) throw new HttpError(404, 'Git project not found')
      if (target && context.number !== target.number)
        throw new HttpError(400, 'PR target does not match its URL')
      const detail = await runClientEffect(
        s.pullCache.sectionEffect(repo?.path ?? context.repositoryId, context.number, 'changes'),
      )
      if (detail.warnings.some((warning) => warning.startsWith('Files:')))
        throw new HttpError(503, 'PR files are unavailable. Refresh the PR to try again.')
      localPull = !!repo
      pullSource = detail
      scope = pullReviewScope(detail)
      files = pullReviewFiles(detail)
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
      if (context.source === 'turn') {
        const checkpoint = task.turns?.find((turn) => turn.id === context.turnId)?.checkpoint
        const history = context.checkoutId
          ? checkpoint?.linked?.find((item) => item.checkoutId === context.checkoutId)
          : checkpoint
        if (!history) throw new HttpError(404, 'Change history not found')
        changes = checkpointFiles(history)
      } else if (context.source === 'branch') {
        const cwd = await s.checkouts.directory(task.id)
        const diff = await s.git.reviewBranchChangesFiles(cwd)
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
      : localPull && s.reviewMarks.hasScope(scope)
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
    let groups: ReviewProgress['groups'] = []
    if (organize) {
      if (JSON.stringify(files) !== JSON.stringify(organize.expected))
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
        return {
          path,
          evidence: patch.slice(0, budget),
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
