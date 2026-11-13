import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  botContextMessages,
  botMemoryReviewSchema,
  decode,
  maxValue,
  minValue,
  mutableArray,
  mutableStruct,
  memoryEvidenceSchema,
  redactCredentialText,
  resolveTaskAgent,
  permissionPolicyReadOnly,
  type BotMemoryReviewState,
  type Task,
} from '@dovo/protocol'
import type { Services } from '../services.js'
import { HttpError } from '../errors.js'

const operationSchema = mutableStruct({
  action: Schema.Literals(['add', 'update', 'forget']),
  key: maxValue(minValue(Schema.String, 1), 120),
  content: maxValue(Schema.String, 2000),
  sources: memoryEvidenceSchema.fields.sources,
})
const resultSchema = mutableStruct({ operations: maxValue(mutableArray(operationSchema), 10) })
const safeText = (text: string) =>
  redactCredentialText(text) === text &&
  !/\b(password|passphrase|api[ _-]?key|access[ _-]?token|private[ _-]?key|secret)\s*[:=]|-----BEGIN|\b\d{13,19}\b/i.test(
    text,
  )
const documentId = (id: string) => `bot-memory-review:${id}`

/** A separate, text-only utility session. It never enters the Bot's conversation or queue. */
export class BotMemoryReview {
  private timer?: ReturnType<typeof setInterval>
  private running?: { id: string; controller: AbortController; done: Promise<void> }
  private stopped = false
  private unsubscribe: () => void
  constructor(
    private db: Database.Database,
    private s: Pick<Services, 'store' | 'memory' | 'titles' | 'tasks' | 'activity'>,
  ) {
    this.unsubscribe = s.store.onCommitted(() => {
      const run = this.running
      if (run && !this.eligible(run.id))
        run.controller.abort(new Error('Memory review yielded to active work.'))
    })
  }
  private task(id: string) {
    const task = this.s.store.taskSummary(id)
    if (
      !task.bot ||
      task.replica ||
      task.archivedAt ||
      task.archived ||
      task.example ||
      task.machineHandoff
    )
      throw new HttpError(404, 'Bot not found on this computer.')
    return task
  }
  state(id: string): BotMemoryReviewState {
    this.task(id)
    const value = this.db
      .prepare('SELECT value FROM documents WHERE id=?')
      .pluck()
      .get(documentId(id))
    if (typeof value === 'string') return decode(botMemoryReviewSchema, JSON.parse(value))
    return this.save(id, { enabled: true, revision: randomUUID() })
  }
  status(id: string) {
    return { ...this.state(id), running: this.running?.id === id }
  }
  private save(id: string, state: BotMemoryReviewState) {
    const next = decode(botMemoryReviewSchema, state)
    this.db
      .prepare('INSERT OR REPLACE INTO documents VALUES (?,?)')
      .run(documentId(id), JSON.stringify(next))
    return next
  }
  configure(id: string, revision: string, enabled: boolean) {
    const state = this.state(id)
    if (state.revision !== revision)
      throw new HttpError(409, 'Memory settings changed. Refresh first.')
    if (this.running?.id === id) this.running.controller.abort()
    this.save(id, {
      ...state,
      revision: randomUUID(),
      enabled,
      error: undefined,
      retryAt: undefined,
    })
    return this.status(id)
  }
  clear(id: string, revision: string) {
    this.db.transaction(() => {
      const state = this.state(id)
      if (state.revision !== revision)
        throw new HttpError(409, 'Memory settings changed. Refresh first.')
      if (this.running?.id === id) this.running.controller.abort()
      this.s.memory.clearBot(id)
      // Do not relearn earlier messages after an explicit clear, including after restart.
      this.save(id, {
        ...state,
        revision: randomUUID(),
        cursor: this.s.store.task(id).messages.at(-1)?.id,
        error: undefined,
        retryAt: undefined,
      })
    })()
    return this.status(id)
  }
  private eligible(id: string) {
    try {
      const task = this.task(id)
      const agent = resolveTaskAgent(task, this.s.store.get().agents)
      return (
        !this.stopped &&
        !!agent &&
        !permissionPolicyReadOnly(agent) &&
        task.bot?.state === 'active' &&
        !task.queue?.length &&
        !task.queuePaused &&
        !this.s.tasks.hasWorkingFamily(id) &&
        this.state(id).enabled
      )
    } catch {
      return false
    }
  }
  private batch(task: Task, state: BotMemoryReviewState) {
    const start = state.cursor ? task.messages.findIndex((m) => m.id === state.cursor) + 1 : 0
    // Unknown cursors must never replay an entire replaced/imported conversation.
    if (state.cursor && !start) return { messages: [], cursor: task.messages.at(-1)?.id, turns: 0 }
    const allowed = new Set(botContextMessages(task.messages, task.bot).map((m) => m.id))
    const completed = new Set(task.turns?.filter((t) => t.status === 'completed').map((t) => t.id))
    const messages: Array<{ messageId: string; text: string }> = []
    const turns = new Set<string>()
    let size = 0,
      cursor = state.cursor
    for (const m of task.messages.slice(start, start + 200)) {
      if (messages.length >= 40) break
      const before = cursor
      cursor = m.id
      if (
        m.role !== 'user' ||
        (m.source && m.source.kind !== 'user') ||
        m.subagentResultId ||
        !m.turnId ||
        !completed.has(m.turnId) ||
        !allowed.has(m.id) ||
        !m.text.trim() ||
        m.text.length > 4000 ||
        m.text.startsWith('/') ||
        !safeText(m.text)
      )
        continue
      if (size + m.text.length > 32000) {
        cursor = before
        break
      }
      messages.push({ messageId: m.id, text: m.text })
      turns.add(m.turnId)
      size += m.text.length
    }
    return { messages, cursor, turns: turns.size }
  }
  start() {
    if (this.timer || this.stopped) return
    this.timer = setInterval(() => {
      void this.tick().catch(() => {
        this.s.activity.add('runtime', 'bot-memory', 'Memory review scheduler failed')
      })
    }, 60_000)
    this.timer.unref()
  }
  async tick(now = Date.now()) {
    if (this.stopped || this.running) return
    for (const summary of this.s.store.get().tasks) {
      if (!summary.bot || !this.eligible(summary.id)) continue
      const state = this.state(summary.id)
      if (state.retryAt && Date.parse(state.retryAt) > now) continue
      const task = this.s.store.task(summary.id)
      const batch = this.batch(task, state)
      const last = task.turns?.at(-1)?.finishedAt ?? task.createdAt
      const reset = task.bot?.contextResets?.at(-1)?.at
      if (
        batch.turns >= 20 ||
        (batch.turns >= 3 && now - Date.parse(last) >= 15 * 60_000) ||
        (batch.messages.length && reset && (!state.lastReviewedAt || reset > state.lastReviewedAt))
      ) {
        await this.review(summary.id)
        return // One bounded run per tick; user work always has priority.
      }
      // Advance past skipped data without calling a model or getting stuck on long messages.
      if (!batch.messages.length && batch.cursor !== state.cursor)
        this.save(summary.id, { ...state, cursor: batch.cursor, revision: randomUUID() })
    }
  }
  review(id: string) {
    if (this.running?.id === id) return this.running.done
    if (this.running) throw new HttpError(409, 'Another memory review is running. Try later.')
    if (!this.eligible(id))
      throw new HttpError(409, 'Resume this Bot and finish active work before reviewing memory.')
    const controller = new AbortController()
    const done = Promise.resolve()
      .then(() => this.run(id, controller))
      .finally(() => {
        if (this.running?.controller === controller) this.running = undefined
      })
    this.running = { id, controller, done }
    return done
  }
  private async run(id: string, controller: AbortController) {
    const state = this.state(id)
    const task = this.s.store.task(id)
    const batch = this.batch(task, state)
    const notes = this.s.memory.botNotes(id)
    const fingerprint = JSON.stringify(notes)
    try {
      if (JSON.stringify(notes).length > 100_000)
        throw new Error('Memory review limit reached. Reduce saved notes before reviewing.')
      const text = batch.messages.length
        ? await this.s.titles.memoryReview(
            JSON.stringify({
              messages: batch.messages,
              notes: notes.map((n) => ({ key: n.key, content: n.content, learned: !!n.evidence })),
            }),
            controller.signal,
          )
        : '{"operations":[]}'
      controller.signal.throwIfAborted()
      if (text.length > 12000) throw new Error('Invalid memory review response.')
      const parsed = decode(resultSchema, JSON.parse(text))
      const seen = new Set<string>()
      for (const op of parsed.operations) {
        if (
          !op.key.trim() ||
          /[\0\r\n]/.test(op.key) ||
          seen.has(op.key) ||
          !op.sources.length ||
          !safeText(op.content) ||
          !safeText(op.key) ||
          op.sources.some(
            (source) =>
              !source.quote.trim() ||
              !batch.messages.some(
                (m) => m.messageId === source.messageId && m.text.includes(source.quote),
              ),
          )
        )
          throw new Error('Memory review returned invalid source evidence.')
        seen.add(op.key)
      }
      this.db.transaction(() => {
        controller.signal.throwIfAborted()
        if (
          !this.eligible(id) ||
          this.state(id).revision !== state.revision ||
          JSON.stringify(this.s.memory.botNotes(id)) !== fingerprint ||
          this.task(id).bot?.revision !== task.bot?.revision
        )
          throw new Error('Memory changed during review. Saved notes are unchanged.')
        const now = new Date().toISOString()
        let count = notes.length,
          size = notes.reduce((total, n) => total + n.content.length, 0)
        for (const op of parsed.operations) {
          const old = notes.find((n) => n.key === op.key)
          if (op.action === 'add' ? !!old : !old?.evidence) continue
          if (this.s.memory.forgotten(id, op.key)) continue
          if (op.action === 'forget') {
            if (old)
              this.s.memory.remove({
                scope: 'bot',
                botId: id,
                key: op.key,
                expectedRevision: old.revision,
              })
            continue
          }
          if (!op.content.trim()) continue
          const nextSize = size - (old?.content.length ?? 0) + op.content.length
          if ((!old && count >= 100) || nextSize > 128000) continue
          this.s.memory.write({
            scope: 'bot',
            botId: id,
            key: op.key,
            content: op.content,
            expectedRevision: old?.revision,
          })
          this.s.memory.saveEvidence(id, op.key, { learnedAt: now, sources: op.sources })
          size = nextSize
          if (!old) count++
        }
        this.save(id, {
          ...state,
          cursor: batch.cursor,
          revision: randomUUID(),
          lastReviewedAt: now,
          error: undefined,
          retryAt: undefined,
        })
      })()
      this.s.activity.add('task', id, 'Memory review completed')
    } catch (error) {
      if (
        controller.signal.aborted ||
        !this.eligible(id) ||
        this.state(id).revision !== state.revision
      )
        return
      // No raw provider response or transcript in diagnostics. A failed batch stays pending.
      this.save(id, {
        ...state,
        revision: randomUUID(),
        error:
          'Memory review failed. Check the utility model in Settings → Agents, then retry. Saved notes are unchanged.',
        retryAt: new Date(Date.now() + 60 * 60_000).toISOString(),
      })
      this.s.activity.add('task', id, 'Memory review failed; saved notes were preserved')
      if (error instanceof HttpError) throw error
    }
  }
  async dispose() {
    this.stopped = true
    clearInterval(this.timer)
    this.unsubscribe()
    this.running?.controller.abort(new Error('Runtime stopped.'))
    await this.running?.done
  }
}
