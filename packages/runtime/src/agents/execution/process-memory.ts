import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { totalmem } from 'node:os'

export type MemoryProcess = {
  pid: number
  parent: number
  group: number
  rss: number
  /** Kernel start ticks on Linux; ps start time on macOS. Never a command line. */
  identity: string
}
export type ProcessMemory = {
  total: number
  available: number
  /** macOS kernel pressure signal; Linux uses available-memory headroom. */
  pressure?: boolean
  processes: MemoryProcess[]
}
const GiB = 1024 ** 3
function cgroupMemoryBytes(value: string, field: string) {
  const trimmed = value.trim()
  const bytes = Number(trimmed)
  if (!/^\d+$/.test(trimmed) || !Number.isSafeInteger(bytes))
    throw new Error(`Cgroup memory ${field} is unavailable`)
  return bytes
}
export function memoryBudget(total: number) {
  return {
    budget: Math.max(total - 6 * GiB, total * 0.5),
    headroom: Math.min(4 * GiB, total * 0.2),
  }
}
function command(file: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      file,
      args,
      { timeout: 2000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C' } },
      (error, stdout) => (error ? reject(error) : resolve(stdout)),
    )
  })
}
export function parseMemoryProcesses(output: string): MemoryProcess[] {
  const rows = output.trim().split('\n').filter(Boolean)
  if (rows.length > 32768) throw new Error('Process memory snapshot exceeded its limit')
  return rows.map((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line)
    if (!match) throw new Error('Process memory snapshot is unavailable')
    return {
      pid: Number(match[1]),
      parent: Number(match[2]),
      group: Number(match[3]),
      rss: Number(match[4]) * 1024,
      identity: match[5]!,
    }
  })
}
export async function readProcessMemory(platform = process.platform): Promise<ProcessMemory> {
  if (platform !== 'linux' && platform !== 'darwin')
    throw new Error('Automatic memory enforcement is unavailable on this runtime platform')
  const processes = parseMemoryProcesses(
    await command('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,rss=,lstart=']),
  )
  let total = totalmem()
  let available: number
  let pressure: boolean | undefined
  if (platform === 'linux') {
    const info = await readFile('/proc/meminfo', 'utf8')
    const match = /^MemAvailable:\s+(\d+) kB$/m.exec(info)
    if (!match) throw new Error('Linux available memory is unavailable')
    available = Number(match[1]) * 1024
    // Respect readable cgroup v2 limits on this process and its ancestors.
    const groups = await readFile('/proc/self/cgroup', 'utf8')
    const path = /^0::(\/.*)$/m.exec(groups)?.[1]
    if (path && !path.split('/').includes('..')) {
      const parts = path.split('/').filter(Boolean)
      if (parts.length > 32) throw new Error('Cgroup path exceeded its limit')
      for (let depth = parts.length; depth >= 0; depth--) {
        const directory = ['/sys/fs/cgroup', ...parts.slice(0, depth)].join('/')
        const max = await readFile(`${directory}/memory.max`, 'utf8').catch((error: unknown) => {
          if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 'max'
          throw error
        })
        if (max.trim() === 'max') continue
        const limit = cgroupMemoryBytes(max, 'limit')
        if (!limit) throw new Error('Cgroup memory limit is unavailable')
        const current = cgroupMemoryBytes(
          await readFile(`${directory}/memory.current`, 'utf8'),
          'usage',
        )
        const stat = await readFile(`${directory}/memory.stat`, 'utf8')
        const inactiveLines = stat.split('\n').filter((line) => /^inactive_file(?:\s|$)/.test(line))
        const inactiveMatch =
          inactiveLines.length === 1
            ? /^inactive_file[ \t]+(\d+)[ \t]*$/.exec(inactiveLines[0]!)
            : null
        if (!inactiveMatch) throw new Error('Cgroup memory inactive_file is unavailable')
        const inactiveFile = cgroupMemoryBytes(inactiveMatch[1]!, 'inactive_file')
        total = Math.min(total, limit)
        // Inactive file pages can be reclaimed. Read each ancestor's own cache and usage.
        available = Math.min(available, limit, Math.max(0, limit - current + inactiveFile))
      }
    }
    // ps start times have one-second precision. Use kernel ticks for Linux PID identity.
    const byPid = new Map(processes.map((row) => [row.pid, row]))
    for (let offset = 0; offset < processes.length; offset += 64)
      await Promise.all(
        processes.slice(offset, offset + 64).map(async (row) => {
          try {
            const stat = await readFile(`/proc/${row.pid}/stat`, 'utf8')
            const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
            row.identity = fields[19]!
            if (!/^\d+$/.test(row.identity)) throw new Error('Invalid process identity')
          } catch {
            byPid.delete(row.pid)
          }
        }),
      )
    processes.splice(0, processes.length, ...byPid.values())
  } else {
    // Unlike os.freemem(), memory_pressure includes memory the OS can reclaim.
    // -Q only queries; it does not generate pressure.
    const level = (
      await command('/usr/sbin/sysctl', ['-n', 'kern.memorystatus_vm_pressure_level'])
    ).trim()
    if (!['1', '2', '4'].includes(level))
      throw new Error('macOS kernel memory pressure is unavailable')
    pressure = level !== '1'
    const output = await command('/usr/bin/memory_pressure', ['-Q'])
    const match = /System-wide memory free percentage:\s*(\d+)%/.exec(output)
    if (!match) throw new Error('macOS memory pressure is unavailable')
    available = (total * Number(match[1])) / 100
  }
  if (!(total > 0 && available >= 0 && available <= total))
    throw new Error('Machine memory readings are invalid')
  return { total, available, pressure, processes }
}

/** Includes descendants that create their own process group, plus surviving group members. */
export function ownedMemoryProcesses(root: MemoryProcess, processes: MemoryProcess[]) {
  const owned = new Set([root.pid])
  for (const row of processes) if (row.group === root.pid) owned.add(row.pid)
  let changed = true
  while (changed) {
    changed = false
    for (const row of processes)
      if (!owned.has(row.pid) && owned.has(row.parent)) {
        owned.add(row.pid)
        changed = true
      }
  }
  return processes.filter((row) => owned.has(row.pid))
}
