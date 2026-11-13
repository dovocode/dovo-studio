import type { ChildProcess } from 'node:child_process'
import type { RuntimeMemoryDiagnostics } from '@dovo/protocol'
import { stopOwnedChild } from './stop-owned-child.js'
import { pruneIdleProviders } from './warm-processes.js'
import {
  memoryBudget,
  ownedMemoryProcesses,
  readProcessMemory,
  type MemoryProcess,
  type ProcessMemory,
} from './process-memory.js'

export const memoryStoppedReason =
  'Stopped to protect this computer from running out of memory. The queue is paused. Free memory, then resume this thread explicitly.'
export class MemoryPressureStop extends Error {
  constructor() {
    super(memoryStoppedReason)
  }
}
export type MemoryOwner = {
  taskId: string
  runId: string
  current: () => boolean
  stop: (reason: MemoryPressureStop) => void
}
type Owned = { owner: MemoryOwner; child: ChildProcess; identity?: string; stopped: boolean }
type ProtectionStatus = NonNullable<RuntimeMemoryDiagnostics['protection']>

/** Sampled protection, not a kernel memory limit. Shared/external processes are never registered. */
export class MemoryProtection {
  private owned = new Map<ChildProcess, Owned>()
  private observed = new WeakSet<ChildProcess>()
  private owners = new Map<string, MemoryOwner>()
  private timer?: ReturnType<typeof setTimeout>
  private disposed = false
  private sampling?: Promise<void>
  private dangerousSince?: number
  private lastSample?: number
  private idleReleased = false
  private stoppedUnderPressure = false
  private stopFailure?: string
  private status: ProtectionStatus
  constructor(
    private read: () => Promise<ProcessMemory> = readProcessMemory,
    private releaseIdle: () => Promise<void> = () => pruneIdleProviders(true, true),
    private now = Date.now,
    private shutdown = stopOwnedChild,
    private platform = process.platform,
  ) {
    this.status = {
      mode: this.platform === 'linux' || this.platform === 'darwin' ? 'sampled' : 'unavailable',
      detail: 'Waiting for an owned agent process. Shared and external providers are excluded.',
      ownedRuns: 0,
      uncoveredRuns: 0,
    }
  }
  begin(input: MemoryOwner) {
    if (this.disposed) return () => {}
    const owner: MemoryOwner = {
      ...input,
      current: () => this.owners.get(input.taskId) === owner && input.current(),
    }
    this.owners.set(owner.taskId, owner)
    this.schedule()
    return (child: ChildProcess) => {
      if (this.disposed || !owner.current() || !child.pid) return
      const previous = this.owned.get(child)
      const record: Owned = { owner, child, identity: previous?.identity, stopped: false }
      this.owned.set(child, record)
      if (!this.observed.has(child)) {
        this.observed.add(child)
        child.once('close', () => this.owned.delete(child))
      }
    }
  }
  report(): ProtectionStatus {
    return { ...this.status }
  }
  private schedule() {
    if (this.disposed || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.sample().finally(() => {
        if (this.owners.size) this.schedule()
      })
    }, 5000)
    this.timer.unref()
  }
  sample() {
    if (this.disposed) return Promise.resolve()
    return (this.sampling ??= this.inspect().finally(() => (this.sampling = undefined)))
  }
  private async inspect() {
    try {
      for (const [id, owner] of this.owners) if (!owner.current()) this.owners.delete(id)
      for (const [child, record] of this.owned)
        if (!record.owner.current()) this.owned.delete(child)
      if (!this.owners.size) {
        this.dangerousSince = undefined
        this.status.ownedRuns = this.status.uncoveredRuns = 0
        this.status.runs = []
        return
      }
      if (this.platform !== 'linux' && this.platform !== 'darwin') {
        this.status.mode = 'unavailable'
        this.status.detail = 'Automatic memory enforcement is unavailable on this runtime platform'
        this.status.uncoveredRuns = this.owners.size
        this.status.runs = [...this.owners.values()].map((owner) => ({
          taskId: owner.taskId,
          runId: owner.runId,
          mode: 'unavailable',
        }))
        return
      }
      const snapshot = await this.read()
      if (this.disposed) return
      const at = this.now()
      // A failed reading or a suspended machine breaks the sustained-pressure window.
      if (this.lastSample !== undefined && at - this.lastSample > 15000)
        this.dangerousSince = undefined
      this.lastSample = at
      const limits = memoryBudget(snapshot.total)
      const candidates = [...this.owned.values()].flatMap((record) => {
        const { child, owner } = record
        if (
          record.stopped ||
          !owner.current() ||
          child.exitCode !== null ||
          child.signalCode !== null
        )
          return []
        const root = snapshot.processes.find((row) => row.pid === child.pid)
        if (!root || root.group !== root.pid) return []
        record.identity ??= root.identity
        if (record.identity !== root.identity) return []
        const processes = ownedMemoryProcesses(root, snapshot.processes)
        return [{ record, root, processes }]
      })
      const covered = new Set(candidates.map(({ record }) => record.owner))
      const uniqueProcesses = new Map(
        candidates.flatMap((candidate) =>
          candidate.processes.map((row) => [row.pid, row] as const),
        ),
      )
      const rss = [...uniqueProcesses.values()].reduce((sum, row) => sum + row.rss, 0)
      this.status = {
        ...this.status,
        mode: 'sampled',
        detail:
          'Samples owned process trees every 5 seconds. No hard memory limit. Shared and external providers are excluded.',
        runs: [...this.owners.values()].map((owner) => ({
          taskId: owner.taskId,
          runId: owner.runId,
          mode: covered.has(owner) ? 'sampled' : 'unavailable',
        })),
        ownedRuns: covered.size,
        uncoveredRuns: [...this.owners.values()].filter((owner) => !covered.has(owner)).length,
        budgetBytes: limits.budget,
        headroomBytes: limits.headroom,
        availableBytes: snapshot.available,
        ownedRssBytes: rss,
        sampledAt: new Date(at).toISOString(),
      }
      const pressure = snapshot.available < limits.headroom && snapshot.pressure !== false
      if (!pressure) {
        this.stoppedUnderPressure = false
        this.stopFailure = undefined
        this.idleReleased = false
      }
      if (this.stoppedUnderPressure) {
        this.status.mode = this.stopFailure ? 'unavailable' : 'sampled'
        this.status.detail =
          this.stopFailure ??
          'A memory stop was attempted. Further automatic stops wait for machine pressure to clear.'
        return
      }
      if (pressure && !this.idleReleased) {
        this.idleReleased = true
        await this.releaseIdle()
        this.dangerousSince = undefined
        return
      }
      const danger = pressure && rss > limits.budget
      if (!danger) {
        this.dangerousSince = undefined
        return
      }
      if (this.dangerousSince === undefined) {
        this.dangerousSince = at
        return
      }
      if (at - this.dangerousSince < 10000) return
      const ownerProcesses = new Map<MemoryOwner, Map<string, MemoryProcess>>()
      for (const candidate of candidates) {
        const owner = candidate.record.owner
        const processes = ownerProcesses.get(owner) ?? new Map<string, MemoryProcess>()
        for (const row of candidate.processes) processes.set(`${row.pid}:${row.identity}`, row)
        ownerProcesses.set(owner, processes)
      }
      const ownerRss = new Map(
        [...ownerProcesses].map(([owner, processes]) => [
          owner,
          [...processes.values()].reduce((sum, row) => sum + row.rss, 0),
        ]),
      )
      const victim = candidates.sort(
        (a, b) => ownerRss.get(b.record.owner)! - ownerRss.get(a.record.owner)!,
      )[0]
      // Do not stop a tiny owned run to address unrelated machine pressure.
      if (
        !victim ||
        ownerRss.get(victim.record.owner)! < Math.min(256 * 1024 ** 2, snapshot.total * 0.05)
      )
        return
      const { record, root } = victim
      const ownedTrees = candidates.filter((candidate) => candidate.record.owner === record.owner)
      const fresh = await this.read()
      if (
        this.disposed ||
        this.owned.get(record.child) !== record ||
        !record.owner.current() ||
        record.child.exitCode !== null ||
        record.child.signalCode !== null ||
        !fresh.processes.some(
          (row) => row.pid === root.pid && row.identity === root.identity && row.group === root.pid,
        )
      )
        return
      const currentLimits = memoryBudget(fresh.total)
      const freshPids = new Set(uniqueProcesses.keys())
      const freshRss = fresh.processes
        .filter(
          (row) =>
            freshPids.has(row.pid) && uniqueProcesses.get(row.pid)?.identity === row.identity,
        )
        .reduce((sum, row) => sum + row.rss, 0)
      if (
        fresh.available >= currentLimits.headroom ||
        fresh.pressure === false ||
        freshRss <= currentLimits.budget
      ) {
        this.dangerousSince = undefined
        return
      }
      // Mark first: persistence/cancellation failures must never trigger repeated signals.
      for (const tree of ownedTrees) tree.record.stopped = true
      this.stoppedUnderPressure = true
      this.dangerousSince = undefined
      this.status.lastStop = {
        taskId: record.owner.taskId,
        runId: record.owner.runId,
        at: new Date(at).toISOString(),
        reason: memoryStoppedReason,
      }
      const failures: unknown[] = []
      try {
        record.owner.stop(new MemoryPressureStop())
      } catch (error) {
        failures.push(error)
      }
      // The regular cancellation path handles approvals, native sessions and queue state.
      // Direct cleanup also handles a provider that does not respond to cancellation.
      const stopped = await Promise.allSettled(
        ownedTrees.map(async (tree) => {
          if (
            !fresh.processes.some(
              (row) => row.pid === tree.root.pid && row.identity === tree.root.identity,
            )
          )
            return
          await this.stopTree(tree.record.child, tree.processes)
        }),
      )
      for (const result of stopped) if (result.status === 'rejected') failures.push(result.reason)
      if (failures.length === 1) throw failures[0]
      if (failures.length)
        throw new AggregateError(
          failures,
          'Memory protection could not confirm all owned process trees stopped',
        )
    } catch (error) {
      this.dangerousSince = undefined
      this.lastSample = undefined
      this.idleReleased = false
      this.status.mode = 'unavailable'
      this.status.detail =
        error instanceof Error ? error.message : 'Memory protection is unavailable'
      this.status.ownedRuns = 0
      this.status.uncoveredRuns = this.owners.size
      this.status.runs = [...this.owners.values()].map((owner) => ({
        taskId: owner.taskId,
        runId: owner.runId,
        mode: 'unavailable',
      }))
      if (this.stoppedUnderPressure) this.stopFailure = this.status.detail
    }
  }
  private async stopTree(child: ChildProcess, tracked: MemoryProcess[]) {
    // Never signal a PID obtained only from a sample. Dedicated launcher cleanup owns
    // the process group. Escaped descendants are observed and reported, not guessed safe.
    await this.shutdown(child)
    const fresh = await this.read()
    const survivors = tracked.filter((old) =>
      fresh.processes.some(
        (row) => row.pid === old.pid && row.identity === old.identity && row.rss > 0,
      ),
    )
    if (survivors.length)
      throw new Error(
        'Memory stop left owned descendants outside the process group. Further automatic stops wait for memory pressure to clear.',
      )
  }
  dispose() {
    this.disposed = true
    clearTimeout(this.timer)
    this.timer = undefined
    this.owners.clear()
    this.owned.clear()
    return this.sampling ?? Promise.resolve()
  }
}
