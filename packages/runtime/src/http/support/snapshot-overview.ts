import {
  checkpointFileCount,
  checkpointCanUndo,
  taskMetadata,
  decode,
  mutableStruct,
} from '@dovo/protocol'
import { Schema } from 'effect'
import type Database from 'better-sqlite3'
import { conversationPage, taskBudgetUsage } from '@dovo/protocol'
import type {
  Workspace,
  Task,
  TaskSummary,
  WorkspaceSummary,
  ConversationPage,
} from '@dovo/protocol'
const pagedTasks = new WeakMap<Task, Task>()
function pagedTask(task: Task): Task {
  const cached = pagedTasks.get(task)
  if (cached) return cached
  const page = conversationPage(task)
  const visible = new Set(page.turns.map((turn) => turn.id))
  const older = task.turns?.filter((turn) => !visible.has(turn.id)) ?? []
  const budget = taskBudgetUsage({ turns: older })
  const undoable = [...older]
    .reverse()
    .find((turn) => turn.status !== 'running' && checkpointCanUndo(turn.checkpoint))
  const result = {
    ...task,
    messages: page.messages,
    turns: page.turns,
    historyBefore: page.before,
    historyTotals: older.length
      ? {
          tokens: budget.tokens,
          milliseconds: budget.minutes * 60000,
          hasChanges: older.some(
            (turn) => !!turn.checkpoint && checkpointFileCount(turn.checkpoint) > 0,
          ),
          undoableTurnId: undoable?.id,
        }
      : undefined,
  }
  pagedTasks.set(task, result)
  return result
}
const scopedTasks = new WeakMap<Task, Task>()
const scopedWorkspaces = new WeakMap<Workspace, Map<string, Workspace>>()
function summaryTask(task: Task): Task {
  const cached = scopedTasks.get(task)
  if (cached) return cached
  const summary = {
    ...task,
    messages: [],
    sideChats: task.sideChats?.map((chat) => ({ ...chat, messages: [] })),
    files: task.files.map(({ path, viewed }) => ({ path, viewed, before: '', after: '' })),
    forkedFrom: task.forkedFrom ? { ...task.forkedFrom, snapshot: undefined } : undefined,
    turns: task.turns?.map((turn) => ({ ...turn, checkpoint: undefined })),
  }
  scopedTasks.set(task, summary)
  return summary
}
/** Keep editable drafts and task metadata, but send history only for subscribed threads. */
export function scopedWorkspace(
  workspace: Workspace,
  taskIds: readonly string[],
  paged = false,
): Workspace {
  const key = JSON.stringify([paged, [...new Set(taskIds)].sort()])
  let variants = scopedWorkspaces.get(workspace)
  const cached = variants?.get(key)
  if (cached) return cached
  if (!variants) {
    variants = new Map()
    scopedWorkspaces.set(workspace, variants)
  }
  const details = new Set(taskIds)
  const result = {
    ...workspace,
    tasks: workspace.tasks.map((task) =>
      details.has(task.id) ? (paged ? pagedTask(task) : task) : summaryTask(task),
    ),
  }
  // Device metadata remains filtered separately; only identical workspace projections share a hash.
  variants.set(key, result)
  if (variants.size > 16) {
    const oldest = variants.keys().next().value
    if (oldest !== undefined) variants.delete(oldest)
  }
  return result
}

interface SnapshotHistories {
  publicTask(id: string): Task
  publicPagedTask?(summary: TaskSummary): Task
  publicCompleteTasks(reuse?: (summary: TaskSummary) => Task | undefined): Iterable<{
    summary: TaskSummary
    task: Task
  }>
}
const wireSummaries = new WeakMap<TaskSummary, { overview?: Task; scoped?: Task }>()
const fullTasks = new WeakMap<TaskSummary, WeakRef<Task>>()
const snapshotWorkspaces = new WeakMap<WorkspaceSummary, Map<string, WeakRef<Workspace>>>()

/** Wire summaries retain only the latest turn and aggregate facts about earlier turns. */
function wireSummary(summary: TaskSummary, overview: boolean): Task {
  let variants = wireSummaries.get(summary)
  const cached = overview ? variants?.overview : variants?.scoped
  if (cached) return cached
  const task: Task = {
    ...taskMetadata(summary),
    messages: [],
    turns:
      summary.history.turns === undefined
        ? undefined
        : summary.history.latestTurn
          ? [summary.history.latestTurn]
          : [],
    historyTotals: summary.history.earlier,
    sideChats: summary.sideChats?.map((chat) => ({ ...chat, messages: [] })),
    files: summary.files.map(({ path, viewed }) => ({ path, viewed, before: '', after: '' })),
    ...(overview ? { draftAttachments: undefined } : {}),
    forkedFrom: summary.forkedFrom ? { ...summary.forkedFrom, snapshot: undefined } : undefined,
  }
  if (!variants) wireSummaries.set(summary, (variants = {}))
  if (overview) variants.overview = task
  else variants.scoped = task
  return task
}

/** Project summaries without hydrating unrelated histories. Legacy full snapshots materialize
 * complete tasks without retaining them in this cache after their readers release them. */
export function snapshotWorkspace(
  workspace: WorkspaceSummary,
  histories: SnapshotHistories,
  options: { overview?: boolean; taskIds?: readonly string[]; pagedHistory?: boolean },
): Workspace {
  const { overview = false, taskIds, pagedHistory = false } = options
  const key = JSON.stringify([overview, pagedHistory, taskIds && [...new Set(taskIds)].sort()])
  let variants = snapshotWorkspaces.get(workspace)
  const cached = variants?.get(key)?.deref()
  if (cached) return cached
  if (!variants) {
    variants = new Map()
    snapshotWorkspaces.set(workspace, variants)
  }
  let tasks: Task[]
  if (taskIds) {
    const details = new Set(taskIds)
    tasks = workspace.tasks.map((summary) => {
      if (!details.has(summary.id)) return wireSummary(summary, false)
      if (pagedHistory && histories.publicPagedTask) return histories.publicPagedTask(summary)
      const task = histories.publicTask(summary.id)
      return pagedHistory ? pagedTask(task) : task
    })
  } else if (overview) tasks = workspace.tasks.map((summary) => wireSummary(summary, true))
  else {
    tasks = []
    for (const { summary, task } of histories.publicCompleteTasks((summary) =>
      fullTasks.get(summary)?.deref(),
    )) {
      fullTasks.set(summary, new WeakRef(task))
      tasks.push(task)
    }
  }
  const result: Workspace = { ...workspace, tasks }
  variants.set(key, new WeakRef(result))
  if (variants.size > 16) {
    const oldest = variants.keys().next().value
    if (oldest !== undefined) variants.delete(oldest)
  }
  return result
}

const olderTurnSchema = mutableStruct({
  id: Schema.String,
  started: Schema.String,
  finished: Schema.NullOr(Schema.String),
  tokens: Schema.NullOr(Schema.Number),
  changed: Schema.Number,
  undoable: Schema.Number,
})
const storedPages = new WeakMap<TaskSummary, Task>()
const olderBudgets = new WeakMap<object, Map<string, Task['historyTotals']>>()

/** Read only small turn facts for aggregate totals; file bodies and older messages stay in SQLite.
 * Cache while the earlier-turn summary and page ownership are unchanged during streaming. */
function olderHistoryTotals(db: Database.Database, summary: TaskSummary, page: ConversationPage) {
  if ((summary.history.turns ?? 0) === page.turns.length) return undefined
  const visible = page.turns.map((turn) => turn.id)
  const key = JSON.stringify([summary.id, visible])
  const earlier = summary.history.earlier
  const latestVisible =
    !summary.history.latestTurn || visible.includes(summary.history.latestTurn.id)
  let cached = earlier && latestVisible ? olderBudgets.get(earlier) : undefined
  if (cached?.has(key)) return cached.get(key)
  const rows = db.prepare(`SELECT item_id AS id,
    json_extract(item.value, '$.startedAt') AS started,
    json_extract(item.value, '$.finishedAt') AS finished,
    json_extract(item.value, '$.tokens') AS tokens,
    (COALESCE(json_array_length(item.value, '$.checkpoint.files'), 0)
      + COALESCE(json_array_length(item.value, '$.checkpoint.omitted'), 0)
      + COALESCE((SELECT SUM(COALESCE(json_array_length(link.value, '$.files'), 0)
          + COALESCE(json_array_length(link.value, '$.omitted'), 0))
        FROM json_each(item.value, '$.checkpoint.linked') AS link), 0) > 0) AS changed,
    (json_extract(item.value, '$.status') != 'running'
      AND COALESCE(length(json_extract(item.value, '$.checkpoint.error')), 0) = 0
      AND ((COALESCE(length(json_extract(item.value, '$.checkpoint.after')), 0) > 0
        AND COALESCE(json_extract(item.value, '$.checkpoint.undone'), 0) = 0
        AND COALESCE(json_array_length(item.value, '$.checkpoint.files'), 0)
          + COALESCE(json_array_length(item.value, '$.checkpoint.omitted'), 0) > 0)
      OR EXISTS (SELECT 1 FROM json_each(item.value, '$.checkpoint.linked') AS link
        WHERE COALESCE(length(json_extract(link.value, '$.after')), 0) > 0
          AND COALESCE(length(json_extract(link.value, '$.error')), 0) = 0
          AND COALESCE(json_extract(link.value, '$.undone'), 0) = 0
          AND COALESCE(json_array_length(link.value, '$.files'), 0)
            + COALESCE(json_array_length(link.value, '$.omitted'), 0) > 0))) AS undoable
    FROM conversation_items AS item WHERE task_id = ? AND kind = 'turn'
      AND item_id NOT IN (SELECT value FROM json_each(?)) ORDER BY ordinal`)
  let tokens: number | undefined
  let milliseconds = 0
  let hasChanges = false
  let undoableTurnId: string | undefined
  const now = Date.now()
  for (const value of rows.iterate(summary.id, JSON.stringify(visible))) {
    const turn = decode(olderTurnSchema, value)
    if (turn.tokens !== null) tokens = (tokens ?? 0) + turn.tokens
    const start = Date.parse(turn.started)
    const end = turn.finished ? Date.parse(turn.finished) : now
    if (Number.isFinite(start) && Number.isFinite(end)) milliseconds += Math.max(0, end - start)
    hasChanges ||= !!turn.changed
    if (turn.undoable) undoableTurnId = turn.id
  }
  const totals = { tokens, milliseconds, hasChanges, undoableTurnId }
  if (earlier && latestVisible) {
    if (!cached) olderBudgets.set(earlier, (cached = new Map()))
    cached.set(key, totals)
    if (cached.size > 16) {
      const oldest = cached.keys().next().value
      if (oldest !== undefined) cached.delete(oldest)
    }
  }
  return totals
}

/** A negotiated page never requests the task's complete history from the store. */
export function pagedSummaryTask(
  db: Database.Database,
  summary: TaskSummary,
  page: ConversationPage,
): Task {
  const cached = storedPages.get(summary)
  if (cached) return cached
  const task = {
    ...taskMetadata(summary),
    messages: page.messages,
    turns: page.turns,
    historyBefore: page.before,
    historyTotals: olderHistoryTotals(db, summary, page),
  }
  storedPages.set(summary, task)
  return task
}
