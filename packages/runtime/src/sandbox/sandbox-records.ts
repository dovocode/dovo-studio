import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PinnedGitLayout } from '../scm/git/hardened-git.js'

/** One checkout of a sandboxed thread, as recorded before any agent code ran in it. */
export type RecordedCheckout = {
  /** The path the thread uses. */
  root: string
  /** Its real path. */
  real: string
  /** Missing when the folder was not a Git checkout. */
  layout?: PinnedGitLayout
}
/** Trusted state for one sandboxed thread. It lives in the runtime data folder, outside every
 * container mount, so an agent cannot change it. */
export type SandboxRecord = {
  taskId: string
  created: string
  checkouts: RecordedCheckout[]
  /** Real host paths mounted writable into the thread's container. */
  writable: string[]
}

const within = (path: string, root: string) => path === root || path.startsWith(`${root}/`)

function parseRecord(text: string): SandboxRecord | undefined {
  const value: unknown = JSON.parse(text)
  if (!value || typeof value !== 'object') return undefined
  const record = value as Partial<SandboxRecord>
  const strings = (items: unknown): items is string[] =>
    Array.isArray(items) && items.every((item) => typeof item === 'string')
  const layout = (item: unknown): item is PinnedGitLayout =>
    !!item &&
    typeof item === 'object' &&
    ['worktree', 'gitDir', 'commonDir'].every(
      (key) => typeof (item as Record<string, unknown>)[key] === 'string',
    )
  if (
    typeof record.taskId !== 'string' ||
    typeof record.created !== 'string' ||
    !strings(record.writable) ||
    !Array.isArray(record.checkouts) ||
    !record.checkouts.every(
      (item: unknown) =>
        !!item &&
        typeof item === 'object' &&
        typeof (item as RecordedCheckout).root === 'string' &&
        typeof (item as RecordedCheckout).real === 'string' &&
        ((item as RecordedCheckout).layout === undefined ||
          layout((item as RecordedCheckout).layout)),
    )
  )
    return undefined
  return record as SandboxRecord
}

/** A folder that was not a Git checkout when its sandbox started. Git in it keeps failing with
 * "not a git repository", also after the agent runs `git init` there. */
const noRepository = (worktree: string): PinnedGitLayout => ({
  worktree,
  gitDir: '/dev/null',
  commonDir: '/dev/null',
})

export class SandboxRecords {
  private records = new Map<string, SandboxRecord>()

  constructor(private directory: string) {
    let names: string[] = []
    try {
      names = readdirSync(directory)
    } catch {
      return
    }
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      try {
        const record = parseRecord(readFileSync(join(directory, name), 'utf8'))
        if (record) this.records.set(record.taskId, record)
      } catch (error) {
        console.error('Could not read a sandbox record', name, error)
      }
    }
  }

  private file(taskId: string) {
    return join(
      this.directory,
      `${createHash('sha256').update(taskId).digest('hex').slice(0, 32)}.json`,
    )
  }

  get(taskId: string) {
    return this.records.get(taskId)
  }

  save(record: SandboxRecord) {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    const file = this.file(record.taskId)
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(record), { mode: 0o600 })
    renameSync(temporary, file)
    this.records.set(record.taskId, record)
  }

  /** Forget threads that no longer exist. Archived threads keep their record, so the Git calls
   * that archive, restore or delete them stay hardened. */
  prune(exists: (taskId: string) => boolean) {
    for (const taskId of [...this.records.keys()]) {
      if (exists(taskId)) continue
      rmSync(this.file(taskId), { force: true })
      this.records.delete(taskId)
    }
  }

  /** The recorded checkout that contains a real path, from any thread. The oldest record wins:
   * a later thread must not trust files that an earlier sandbox could change. */
  checkout(real: string) {
    let best: { checkout: RecordedCheckout; top: string; created: string } | undefined
    for (const record of this.records.values())
      for (const checkout of record.checkouts) {
        const top = checkout.layout?.worktree ?? checkout.real
        if (!within(real, top)) continue
        if (
          !best ||
          top.length > best.top.length ||
          (top.length === best.top.length && record.created < best.created)
        )
          best = { checkout, top, created: record.created }
      }
    return best?.checkout
  }

  /** The Git layout for Dovo's Git calls in a real path, when a sandbox can write it. */
  gitLayout(real: string): PinnedGitLayout | undefined {
    const checkout = this.checkout(real)
    if (!checkout) return undefined
    return checkout.layout ?? noRepository(checkout.real)
  }

  /** Common Git folders of every recorded checkout. A sandbox can write them. */
  commonDirs() {
    const folders = new Set<string>()
    for (const record of this.records.values())
      for (const checkout of record.checkouts)
        if (checkout.layout) folders.add(checkout.layout.commonDir)
    return folders
  }

  /** Whether any sandbox can write this real path. */
  writable(real: string) {
    for (const record of this.records.values())
      if (record.writable.some((root) => within(real, root))) return true
    return false
  }
}
