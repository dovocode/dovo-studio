import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import { decode, mutableArray, mutableStruct, type SpendPause } from '@dovo/protocol'
import type { TaskMetadata } from '@dovo/protocol'
import type { WorkspaceStore } from '../../storage/workspace.js'

const familySchema = mutableStruct({ reset_at: Schema.String, owner_messages: Schema.String })
const enabledKey = 'unattended-spend-enabled-at'
/** Owner messages that may still wait in a queue. Older ones have started long ago. */
const ownerMessageLimit = 20

type FamilyTask = Pick<TaskMetadata, 'id' | 'delegation' | 'botJob' | 'spawnParent'>

/** The thread that owns a family: follow child agents, Bot workers and local spawned threads up
 * to the top-level thread or Bot. A parent on another computer leaves this thread as the root. */
export function spendFamilyRoot(tasks: ReadonlyMap<string, FamilyTask>, id: string) {
  const seen = new Set<string>()
  let current = id
  for (;;) {
    seen.add(current)
    const task = tasks.get(current)
    const parent =
      task?.delegation?.parentTaskId ?? task?.botJob?.botId ?? task?.spawnParent?.threadId
    if (!parent || seen.has(parent) || !tasks.has(parent)) return current
    current = parent
  }
}

/** Estimated spend of work that runs without a new owner message, per thread family.
 *
 * The counter covers every finished turn in the family that started after the latest reset: an
 * owner message to any thread in the family, Continue, or the moment the limit was turned on.
 * Turns use the same pricing as Settings → Usage, including custom prices. A finished turn
 * without a price makes the total unknown, so it holds new unattended work like a reached limit. */
export class UnattendedSpend {
  constructor(
    private readonly db: Database.Database,
    private readonly store: WorkspaceStore,
    private readonly configured: () => number | null,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS unattended_spend_families (root_id TEXT PRIMARY KEY, reset_at TEXT NOT NULL, owner_messages TEXT NOT NULL)',
    )
  }
  /** The limit in USD, or undefined when off. Turning it on starts every counter at zero. */
  limitUsd(): number | undefined {
    const limit = this.configured()
    const saved = this.db.prepare('SELECT 1 FROM documents WHERE id = ?').get(enabledKey)
    if (limit === null) {
      if (saved) this.db.prepare('DELETE FROM documents WHERE id = ?').run(enabledKey)
      return undefined
    }
    if (!saved)
      this.db
        .prepare('INSERT INTO documents VALUES (?, ?)')
        .run(enabledKey, new Date().toISOString())
    return limit
  }
  private enabledAt() {
    const row = this.db.prepare('SELECT value FROM documents WHERE id = ?').get(enabledKey)
    return row ? decode(mutableStruct({ value: Schema.String }), row).value : undefined
  }
  private tasks() {
    return new Map(this.store.get().tasks.map((task) => [task.id, task]))
  }
  root(id: string) {
    return spendFamilyRoot(this.tasks(), id)
  }
  /** Every local thread in the same family as `id`, including the root. */
  family(id: string) {
    const tasks = this.tasks()
    const root = spendFamilyRoot(tasks, id)
    return [...tasks.keys()].filter((taskId) => spendFamilyRoot(tasks, taskId) === root)
  }
  private saved(root: string) {
    const row = this.db
      .prepare('SELECT reset_at, owner_messages FROM unattended_spend_families WHERE root_id = ?')
      .get(root)
    if (!row) return undefined
    const family = decode(familySchema, row)
    return {
      resetAt: family.reset_at,
      ownerMessages: decode(mutableArray(Schema.String), JSON.parse(family.owner_messages)),
    }
  }
  /** Resets the family counter. A message id marks the owner's own input, which always starts. */
  reset(id: string, ownerMessageId?: string) {
    const root = this.root(id)
    const previous = this.saved(root)?.ownerMessages ?? []
    const ownerMessages = ownerMessageId
      ? [...previous.filter((item) => item !== ownerMessageId), ownerMessageId].slice(
          -ownerMessageLimit,
        )
      : previous
    this.db
      .prepare(
        'INSERT INTO unattended_spend_families VALUES (?, ?, ?) ON CONFLICT(root_id) DO UPDATE SET reset_at = excluded.reset_at, owner_messages = excluded.owner_messages',
      )
      .run(root, new Date().toISOString(), JSON.stringify(ownerMessages))
  }
  ownerMessage(id: string, messageId: string) {
    return !!this.saved(this.root(id))?.ownerMessages.includes(messageId)
  }
  /** Estimated cost and unpriced turns since the family's latest reset. */
  spend(id: string) {
    const family = this.family(id)
    const since = [this.saved(this.root(id))?.resetAt, this.enabledAt()]
      .filter((value): value is string => !!value)
      .sort()
      .at(-1)
    let spentUsd = 0
    let unpricedTurns = 0
    for (const record of this.store.usage.turns(family, since ?? new Date(0).toISOString())) {
      const cost = this.store.usagePricing.price(record).turn.estimatedCostUsd
      if (cost === undefined) unpricedTurns++
      else spentUsd += cost
    }
    return { spentUsd, unpricedTurns }
  }
  /** The pause to show when the limit holds new unattended work of this thread. */
  reached(id: string, now = new Date()): SpendPause | undefined {
    const limitUsd = this.limitUsd()
    if (limitUsd === undefined) return undefined
    const { spentUsd, unpricedTurns } = this.spend(id)
    if (spentUsd < limitUsd && !unpricedTurns) return undefined
    return { spentUsd, unpricedTurns, limitUsd, at: now.toISOString() }
  }
  /** Removes state of families whose root thread no longer exists. */
  prune() {
    const ids = new Set(this.store.get().tasks.map((task) => task.id))
    const roots = decode(
      mutableArray(mutableStruct({ root_id: Schema.String })),
      this.db.prepare('SELECT root_id FROM unattended_spend_families').all(),
    )
    for (const { root_id } of roots)
      if (!ids.has(root_id))
        this.db.prepare('DELETE FROM unattended_spend_families WHERE root_id = ?').run(root_id)
  }
}
