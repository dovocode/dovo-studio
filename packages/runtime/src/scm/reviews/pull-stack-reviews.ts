import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  mutableArray,
  mutableStruct,
  pullCodeReviewSchema,
  pullReviewStackSchema,
  type PullCodeReview,
  type PullReviewStack,
  type pullCodeReviewStartSchema,
} from '@dovo/protocol'
import { HttpError, errorMessage } from '../../errors.js'

type Start = typeof pullCodeReviewStartSchema.Type
type Context = NonNullable<PullCodeReview['stack']>
type Prepared = Pick<PullReviewStack, 'destination' | 'readerIdentity' | 'rootNumber' | 'members'>
const rows = mutableArray(mutableStruct({ value: Schema.String }))
const now = () => new Date().toISOString()

/** A durable queue keeps each PR's evidence, checks and publication separate. */
export class PullStackReviews {
  private active = new Map<string, { controller: AbortController; done: Promise<void> }>()
  constructor(
    private db: Database.Database,
    private prepare: (input: Start) => Promise<Prepared>,
    private startMember: (
      input: Start,
      context: Context,
    ) => Promise<{ id: string; done: Promise<void> }>,
    private cancelMember: (id: string) => void,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS pull_stack_reviews (id TEXT PRIMARY KEY, scope TEXT NOT NULL, request_id TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(scope, request_id))',
    )
    for (const { value } of decode(
      rows,
      db.prepare('SELECT value FROM pull_stack_reviews').all(),
    )) {
      const stack = decode(pullReviewStackSchema, JSON.parse(value))
      if (stack.status !== 'running') continue
      stack.status = 'interrupted'
      stack.finishedAt = now()
      for (const member of stack.members)
        if (member.status === 'queued' || member.status === 'running') member.status = 'interrupted'
      this.write(stack)
    }
  }
  private write(stack: PullReviewStack) {
    stack.sequence++
    this.db
      .prepare('UPDATE pull_stack_reviews SET value=? WHERE id=?')
      .run(JSON.stringify(stack), stack.id)
  }
  private review(id: string | undefined) {
    if (!id) return undefined
    const row = this.db.prepare('SELECT value FROM pull_code_reviews WHERE id=?').get(id)
    return row
      ? decode(
          pullCodeReviewSchema,
          JSON.parse(decode(mutableStruct({ value: Schema.String }), row).value),
        )
      : undefined
  }
  list(scope: string, number: number) {
    return decode(
      rows,
      this.db
        .prepare('SELECT value FROM pull_stack_reviews WHERE scope=? ORDER BY rowid DESC')
        .all(scope),
    )
      .map(({ value }) => decode(pullReviewStackSchema, JSON.parse(value)))
      .filter((stack) => stack.members.some((member) => member.target.number === number))
      .slice(0, 20)
      .map((stack) => ({
        ...stack,
        members: stack.members.map((member) => {
          const review = member.status === 'running' ? this.review(member.reviewId) : undefined
          return review
            ? {
                ...member,
                status: review.status,
                findings: review.findings.length,
                suppliedFiles: review.coverage.filter((file) => file.state === 'supplied').length,
                totalFiles: review.coverage.length + review.missingFiles,
                error: review.error,
              }
            : member
        }),
      }))
  }
  async start(input: Start, scope: string) {
    const fingerprint = createHash('sha256').update(JSON.stringify(input)).digest('hex')
    const prior = decode(
      rows,
      this.db
        .prepare('SELECT value FROM pull_stack_reviews WHERE scope=? AND request_id=?')
        .all(scope, input.requestId),
    )[0]
    if (prior) {
      if (decode(pullReviewStackSchema, JSON.parse(prior.value)).fingerprint !== fingerprint)
        throw new HttpError(
          409,
          'This stack request belongs to another revision or reviewer. Start a new review.',
        )
      return
    }
    const prepared = await this.prepare(input)
    const existing = decode(
      rows,
      this.db
        .prepare('SELECT value FROM pull_stack_reviews WHERE scope=? AND request_id=?')
        .all(scope, input.requestId),
    )[0]
    if (existing) {
      if (decode(pullReviewStackSchema, JSON.parse(existing.value)).fingerprint !== fingerprint)
        throw new HttpError(
          409,
          'This stack request belongs to another revision or reviewer. Start a new review.',
        )
      return
    }
    if (this.list(scope, input.target.number).some((stack) => stack.status === 'running'))
      throw new HttpError(409, 'A review is already running for this PR stack.')
    const stack: PullReviewStack = {
      ...prepared,
      id: randomUUID(),
      sequence: 0,
      requestId: input.requestId,
      fingerprint,
      status: 'running',
      createdAt: now(),
    }
    const inserted = this.db
      .prepare(
        'INSERT OR IGNORE INTO pull_stack_reviews(id,scope,request_id,value) VALUES(?,?,?,?)',
      )
      .run(stack.id, scope, input.requestId, JSON.stringify(stack))
    if (!inserted.changes) return
    const controller = new AbortController()
    const done = this.run(stack, input, controller).finally(() => this.active.delete(stack.id))
    this.active.set(stack.id, { controller, done })
  }
  private async run(stack: PullReviewStack, input: Start, controller: AbortController) {
    const context: Context = {
      id: stack.id,
      rootNumber: stack.rootNumber,
      readerIdentity: stack.readerIdentity,
      members: stack.members.map((member) => ({
        number: member.target.number,
        title: member.title.slice(0, 500),
        url: member.url,
        parentNumber: member.parentNumber,
        headSha: member.headSha,
        baseSha: member.baseSha,
      })),
    }
    for (const member of stack.members) {
      if (controller.signal.aborted) {
        member.status = 'cancelled'
        continue
      }
      try {
        const started = await this.startMember(
          {
            ...input,
            fullStack: false,
            remainingFrom: undefined,
            target: member.target,
            requestId: member.requestId,
            headSha: member.headSha,
            baseSha: member.baseSha,
          },
          context,
        )
        member.reviewId = started.id
        member.status = 'running'
        this.write(stack)
        if (controller.signal.aborted) this.cancelMember(started.id)
        await started.done
        const review = this.review(started.id)
        member.status = review?.status ?? 'failed'
        member.error = review?.error
        member.findings = review?.findings.length
        member.suppliedFiles = review?.coverage.filter((file) => file.state === 'supplied').length
        member.totalFiles = review ? review.coverage.length + review.missingFiles : undefined
      } catch (error) {
        member.status = controller.signal.aborted ? 'cancelled' : 'failed'
        member.error = errorMessage(error)
      }
      this.write(stack)
    }
    stack.status = controller.signal.aborted
      ? 'cancelled'
      : stack.members.every((member) => member.status === 'completed')
        ? 'completed'
        : 'failed'
    stack.finishedAt = now()
    this.write(stack)
  }
  stop(scope: string, number: number, id: string) {
    const stack = this.list(scope, number).find((stack) => stack.id === id)
    if (!stack) throw new HttpError(404, 'PR stack review not found for this account.')
    this.active.get(id)?.controller.abort()
    for (const member of stack.members) if (member.reviewId) this.cancelMember(member.reviewId)
  }
  async dispose() {
    for (const { controller } of this.active.values()) controller.abort()
    await Promise.allSettled([...this.active.values()].map(({ done }) => done))
  }
}
