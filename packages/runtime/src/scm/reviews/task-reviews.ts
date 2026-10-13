import { retainChangedFiles } from '../git/retain-changes.js'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Schema, Effect } from 'effect'
import {
  decode,
  mutableArray,
  mutableStruct,
  codeReviewSchema,
  parseCodeReviewOutput,
  independentReviewPrompt,
  changedFileFingerprint,
  codeFindingPrompt,
  recentTools,
  verificationCommand,
  resolveTaskAgent,
  checkpointFiles,
  findingIdentity,
  approvalIsCurrent,
  type CodeReview,
  type TaskReviewReport,
  type CodeFinding,
} from '@dovo/protocol'
import { runClientEffect } from '@dovo/client-runtime'
import type { Services } from '../../services.js'
import { HttpError, errorMessage } from '../../errors.js'
const rowSchema = mutableStruct({ value: Schema.String })
export class TaskReviews {
  private starting = new Set<string>()
  constructor(
    private db: Database.Database,
    private s: Pick<Services, 'store' | 'tasks' | 'git' | 'checkouts' | 'activity'>,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS task_code_reviews (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, request_id TEXT NOT NULL, agent_id TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(task_id,request_id)); CREATE INDEX IF NOT EXISTS task_code_reviews_task ON task_code_reviews(task_id)',
    )
  }
  private list(taskId: string) {
    this.s.store.taskSummary(taskId)
    return decode(
      mutableArray(rowSchema),
      this.db
        .prepare('SELECT value FROM task_code_reviews WHERE task_id=? ORDER BY rowid DESC')
        .all(taskId),
    ).map((row) => decode(codeReviewSchema, JSON.parse(row.value)))
  }
  private save(review: CodeReview) {
    this.db
      .prepare('UPDATE task_code_reviews SET value=? WHERE id=? AND task_id=?')
      .run(JSON.stringify(review), review.id, review.taskId)
  }
  private async settle(review: CodeReview) {
    const saved = this.review(review.taskId, review.id)
    if (saved.status !== 'running') return saved
    if (review.status !== 'running' || !review.reviewerTaskId) return review
    const reviewer = this.s.store.get().tasks.find((task) => task.id === review.reviewerTaskId)
    if (reviewer && this.s.tasks.hasWorkingFamily(reviewer.id)) return review
    const result: CodeReview = { ...review, finishedAt: new Date().toISOString() }
    if (!reviewer || ['failed', 'cancelled'].includes(reviewer.status)) {
      result.status = reviewer?.status === 'cancelled' ? 'cancelled' : 'failed'
      result.error = reviewer?.error ?? 'Reviewer execution is no longer available.'
    } else {
      try {
        const output = parseCodeReviewOutput(
          this.s.store
            .task(reviewer.id)
            .messages.filter((message) => message.role === 'assistant')
            .map((message) => message.text)
            .join('\n'),
        )
        const cwd = await this.s.checkouts.reviewDirectory(review.taskId)
        if (!cwd || cwd !== review.directory)
          throw new Error('The reviewed checkout changed. Run a fresh review.')
        const findings = output.findings.map((finding) => {
          if (
            /^[\\/]|^[a-z]:/i.test(finding.path) ||
            finding.path.split(/[\\/]/).some((part) => part === '..') ||
            !finding.path.trim()
          )
            throw new Error('The reviewer returned an invalid file path.')
          return { ...finding, id: randomUUID(), status: 'open' as const }
        })
        const previous = this.list(review.taskId).find(
          (item) => item.id !== review.id && item.status === 'completed',
        )
        const claims = output.verifiedFixes ?? []
        if (claims.length) {
          const tree = await this.s.git.snapshot(cwd, `refs/dovo/reviews/${review.id}/current`)
          if (tree !== review.baseline)
            throw new Error('Changes moved during verification. Run a fresh review.')
          const events = []
          for (let offset = 0; offset < 2000; offset += 100) {
            const page = this.s.activity.list('', 'tool', offset, reviewer.id).events
            events.push(...page)
            if (page.length < 100) break
          }
          const commands = recentTools(events).map((tool) =>
            verificationCommand(tool, 'reviewer', review.baseline),
          )
          for (const claim of claims) {
            const original = previous?.findings.find((finding) => finding.id === claim.findingId)
            if (
              !original ||
              findings.some((finding) => findingIdentity(finding) === findingIdentity(original)) ||
              !commands.some(
                (command) =>
                  command?.command.trim() === claim.command.trim() && command.status === 'passed',
              )
            )
              throw new Error(
                'A claimed fix has no matching original finding and passing regression command. Run a fresh review.',
              )
          }
        }
        result.verifiedFixes = claims
        result.status = 'completed'
        result.summary = output.summary
        result.notVerified = output.notVerified
        result.findings = findings
      } catch (error) {
        result.status = 'failed'
        result.error = errorMessage(error)
      }
    }
    const current = this.review(review.taskId, review.id)
    if (current.status !== 'running') return current
    this.save(result)
    return result
  }
  async read(taskId: string): Promise<TaskReviewReport> {
    const reviews = []
    for (const review of this.list(taskId)) reviews.push(await this.settle(review))
    const latest = reviews[0]
    const task = this.s.store.taskSummary(taskId)
    const cwd = latest ? await this.s.checkouts.reviewDirectory(taskId) : undefined
    const files =
      cwd && cwd === latest?.directory
        ? latest.scope === 'branch' && latest.base
          ? checkpointFiles(
              await this.s.git.checkpointChanges(
                cwd,
                latest.base,
                await this.s.git.snapshot(cwd, `refs/dovo/reviews/${latest.id}/current`),
              ),
            )
          : await this.s.git.changes(cwd)
        : task.files
    const head = cwd ? (await this.s.git.command(cwd, ['rev-parse', 'HEAD'])).trim() : undefined
    const current =
      !!latest &&
      cwd === latest.directory &&
      head === latest.head &&
      JSON.stringify(latest.files) ===
        JSON.stringify(
          files
            .map((file) => ({ path: file.path, fingerprint: changedFileFingerprint(file) }))
            .sort((a, b) => a.path.localeCompare(b.path)),
        )
    const commands: TaskReviewReport['commands'] = []
    let evidenceLimited = false
    const sources = [
      { id: taskId, source: 'author' as const },
      ...(latest?.reviewerTaskId
        ? [{ id: latest.reviewerTaskId, source: 'reviewer' as const }]
        : []),
    ]
    for (const scope of sources) {
      const events = []
      for (let offset = 0; offset < 2000; offset += 100) {
        const page = this.s.activity.list('', 'tool', offset, scope.id).events
        events.push(...page)
        if (page.length < 100) break
        if (offset === 1900) evidenceLimited = true
      }
      for (const tool of recentTools(events)) {
        const revision = scope.source === 'reviewer' ? latest?.baseline : undefined
        const command = verificationCommand(tool, scope.source, revision)
        if (command) commands.push(command)
      }
    }
    const approved =
      !!latest &&
      current &&
      approvalIsCurrent(latest) &&
      !latest.findings.some((f) => f.status === 'open' || f.status === 'addressed')
    return {
      reviews,
      current,
      commands: commands.sort((a, b) => b.time.localeCompare(a.time)).slice(0, 100),
      evidenceLimited: evidenceLimited || commands.length > 100,
      approved,
    }
  }
  async start(
    taskId: string,
    requestId: string,
    agentId?: string,
    scope: 'working' | 'branch' = 'working',
  ) {
    const prior = decode(
      Schema.UndefinedOr(mutableStruct({ agent_id: Schema.String, value: Schema.String })),
      this.db
        .prepare('SELECT agent_id,value FROM task_code_reviews WHERE task_id=? AND request_id=?')
        .get(taskId, requestId),
    )
    if (prior) {
      if (
        prior.agent_id !== (agentId ?? '') ||
        (decode(codeReviewSchema, JSON.parse(prior.value)).scope ?? 'working') !== scope
      )
        throw new HttpError(409, 'This review request was already used with another configuration')
      return this.read(taskId)
    }
    if (this.starting.has(taskId))
      throw new HttpError(409, 'A review is already running. Wait for it to finish or stop it.')
    const parent = this.s.store.taskSummary(taskId)
    if (parent.status === 'running' || this.s.tasks.hasWorkingFamily(taskId))
      throw new HttpError(409, 'Finish running work before reviewing')
    this.starting.add(taskId)
    try {
      // Reconcile interrupted reviewers after a runtime restart before admitting a new pass.
      for (const review of this.list(taskId)) await this.settle(review)
      if (this.list(taskId).some((review) => review.status === 'running'))
        throw new HttpError(409, 'A review is already running. Wait for it to finish or stop it.')
      const directory = await this.s.checkouts.reviewDirectory(taskId)
      if (!directory) throw new HttpError(409, 'Open this thread’s Git checkout before reviewing')
      const id = randomUUID()
      const captured = await runClientEffect(
        this.s.tasks.withCheckoutMutationEffect(
          directory,
          Effect.tryPromise({
            try: async () => {
              const baseline = await this.s.git.snapshot(
                directory,
                `refs/dovo/reviews/${id}/baseline`,
              )
              const base =
                scope === 'branch' ? (await this.s.git.branchTrees(directory)).before : undefined
              const files = base
                ? checkpointFiles(await this.s.git.checkpointChanges(directory, base, baseline))
                : await this.s.git.changes(directory)
              return {
                files,
                baseline,
                base,
                head: (await this.s.git.command(directory, ['rev-parse', 'HEAD'])).trim(),
              }
            },
            catch: (error) => new HttpError(409, errorMessage(error)),
          }),
        ),
      )
      if (!captured.files.length)
        throw new HttpError(400, 'There are no changes in the selected review scope')
      const currentParent = this.s.store.task(taskId)
      if (currentParent.status === 'running')
        throw new HttpError(409, 'The author started working. Review after it finishes.')
      const previous = this.list(taskId).find((review) => review.status === 'completed')
      const brief = currentParent.messages
        .filter((message) => message.role === 'user' && !message.file && !message.review)
        .map((message) => message.text)
        .join('\n\n')
      const reviewer = this.s.tasks.createIndependentReviewer(
        taskId,
        id,
        independentReviewPrompt(brief, captured.files, previous, captured.base),
        agentId,
      )
      const configured = resolveTaskAgent(reviewer, this.s.store.get().agents)
      const review: CodeReview = {
        id,
        taskId,
        reviewerTaskId: reviewer.id,
        reviewer: configured?.name ?? '',
        model: configured?.model ?? '',
        createdAt: new Date().toISOString(),
        status: 'running',
        directory,
        scope,
        base: captured.base,
        baseline: captured.baseline,
        head: captured.head,
        files: captured.files
          .map((file) => ({ path: file.path, fingerprint: changedFileFingerprint(file) }))
          .sort((a, b) => a.path.localeCompare(b.path)),
        findings: [],
        summary: '',
        notVerified: [],
      }
      this.db
        .prepare('INSERT INTO task_code_reviews VALUES (?,?,?,?,?)')
        .run(id, taskId, requestId, agentId ?? '', JSON.stringify(review))
      this.s.store.updateTask(taskId, (task) => ({
        ...task,
        files: scope === 'working' ? retainChangedFiles(task.files, captured.files) : task.files,
      }))
      void this.s.tasks
        .start(reviewer.id)
        .then((run) => run.done)
        .catch((error) => {
          if (!this.db.open) return
          const task = this.s.store.taskSummary(reviewer.id)
          if (task.status === 'draft')
            this.s.store.updateTask(task.id, (task) => ({
              ...task,
              status: 'failed',
              error: errorMessage(error),
            }))
        })
        .finally(() => {
          if (this.db.open)
            void this.settle(review).catch((error) =>
              console.error('Could not save code review:', error),
            )
        })
      return this.read(taskId)
    } finally {
      this.starting.delete(taskId)
    }
  }
  private review(taskId: string, reviewId: string) {
    const review = this.list(taskId).find((review) => review.id === reviewId)
    if (!review) throw new HttpError(404, 'Code review not found')
    return review
  }
  async approve(taskId: string, reviewId: string, approvedValue: boolean) {
    const review = this.review(taskId, reviewId)
    if (!approvedValue) {
      const { approval: _approval, ...rest } = review
      this.save(rest)
      return this.read(taskId)
    }
    if (review.status !== 'completed')
      throw new HttpError(409, 'Run a completed review before approving changes.')
    const report = await this.read(taskId)
    if (!report.current || report.reviews[0]?.id !== review.id)
      throw new HttpError(
        409,
        'Changes have moved since this review. Run a fresh review before approving.',
      )
    if (review.findings.some((f) => f.status === 'open' || f.status === 'addressed'))
      throw new HttpError(
        409,
        'Resolve or dismiss every open finding before approving. Addressed findings need a fresh review.',
      )
    this.save({
      ...review,
      approval: {
        approvedAt: new Date().toISOString(),
        baseline: review.baseline,
        head: review.head,
      },
    })
    return this.read(taskId)
  }
  async finding(
    taskId: string,
    reviewId: string,
    findingId: string,
    status: CodeFinding['status'],
    resolution?: string,
  ) {
    const review = this.review(taskId, reviewId)
    if (!review.findings.some((finding) => finding.id === findingId))
      throw new HttpError(404, 'Finding not found')
    this.save({
      ...review,
      findings: review.findings.map((finding) =>
        finding.id === findingId ? { ...finding, status, resolution } : finding,
      ),
    })
    return this.read(taskId)
  }
  /** Latest completed, still-current review approved with no open findings, if any. */
  async isApproved(taskId: string): Promise<boolean> {
    return (await this.read(taskId)).approved
  }
  async fix(taskId: string, reviewId: string, findingIds: string[], messageId: string) {
    const review = this.review(taskId, reviewId)
    const findings = review.findings.filter((finding) => findingIds.includes(finding.id))
    if (findings.length !== new Set(findingIds).size || !findings.length)
      throw new HttpError(404, 'Finding not found')
    if (
      this.s.store.taskSummary(taskId).status === 'running' ||
      this.s.tasks.hasWorkingFamily(taskId)
    )
      throw new HttpError(409, 'Finish running work before fixing findings')
    await this.s.tasks.send(taskId, messageId, codeFindingPrompt(findings))
    this.save({
      ...review,
      findings: review.findings.map((finding) =>
        findingIds.includes(finding.id) ? { ...finding, status: 'addressed' } : finding,
      ),
    })
    return this.read(taskId)
  }
  async stop(taskId: string, reviewId: string) {
    const review = this.review(taskId, reviewId)
    if (review.status === 'running' && review.reviewerTaskId)
      this.s.tasks.cancel(review.reviewerTaskId)
    return this.read(taskId)
  }
  async changes(taskId: string, reviewId: string) {
    const review = this.review(taskId, reviewId)
    const cwd = await this.s.checkouts.reviewDirectory(taskId)
    if (!cwd || cwd !== review.directory)
      throw new HttpError(409, 'The reviewed checkout changed. Run a fresh review.')
    const after = await this.s.git.snapshot(cwd, `refs/dovo/reviews/${review.id}/current`)
    const changes = await this.s.git.checkpointChanges(cwd, review.baseline, after)
    return { ...changes, files: checkpointFiles(changes) }
  }
}
