import { afterEach, expect, it, vi } from 'vite-plus/test'
const state = vi.hoisted(() => ({
  files: new Map<string, string>(),
  level: '2',
  free: '10',
  commands: [] as string[],
}))
vi.mock('node:os', () => ({ totalmem: () => 8 * 1024 ** 3 }))
vi.mock('node:fs/promises', () => ({
  readFile: async (path: string) => {
    const value = state.files.get(path)
    if (value === undefined) throw Object.assign(new Error('Missing file'), { code: 'ENOENT' })
    return value
  },
}))
vi.mock('node:child_process', () => ({
  execFile: (
    file: string,
    args: string[],
    _options: unknown,
    callback: (error: Error | null, stdout: string) => void,
  ) => {
    state.commands.push(`${file} ${args.join(' ')}`)
    callback(
      null,
      file.endsWith('/ps')
        ? '100 1 100 2048 Fri Nov 13 10:00:00 2026'
        : file.endsWith('/sysctl')
          ? state.level
          : `System-wide memory free percentage: ${state.free}%`,
    )
  },
}))
import { readProcessMemory } from './process-memory.js'
afterEach(() => {
  state.files.clear()
  state.commands = []
  state.level = '2'
  state.free = '10'
})
it('uses read-only macOS kernel pressure and reclaimable memory queries', async () => {
  const reading = await readProcessMemory('darwin')
  expect(reading.pressure).toBe(true)
  expect(reading.available).toBe(8 * 1024 ** 3 * 0.1)
  expect(state.commands).toContain('/usr/bin/memory_pressure -Q')
  expect(state.commands).toContain('/usr/sbin/sysctl -n kern.memorystatus_vm_pressure_level')
  state.level = '1'
  expect((await readProcessMemory('darwin')).pressure).toBe(false)
})
it('reports missing or malformed macOS pressure as unavailable', async () => {
  state.level = 'unavailable'
  await expect(readProcessMemory('darwin')).rejects.toThrow('kernel memory pressure is unavailable')
  state.level = '4'
  state.free = 'unavailable'
  await expect(readProcessMemory('darwin')).rejects.toThrow('memory pressure is unavailable')
})
it.each(['max', String(4 * 1024 ** 3)])(
  'honors an ancestor Linux cgroup limit (%s)',
  async (max) => {
    state.files.set('/proc/meminfo', 'MemAvailable: 4194304 kB\n')
    state.files.set('/proc/self/cgroup', '0::/dovo/agent\n')
    state.files.set('/sys/fs/cgroup/dovo/agent/memory.max', max)
    state.files.set('/sys/fs/cgroup/dovo/agent/memory.current', String(3.5 * 1024 ** 3))
    state.files.set('/sys/fs/cgroup/dovo/agent/memory.stat', `inactive_file ${1.5 * 1024 ** 3}\n`)
    state.files.set('/sys/fs/cgroup/dovo/memory.max', String(2 * 1024 ** 3))
    state.files.set('/sys/fs/cgroup/dovo/memory.current', String(1.5 * 1024 ** 3))
    state.files.set('/sys/fs/cgroup/dovo/memory.stat', `inactive_file ${0.25 * 1024 ** 3}\n`)
    const reading = await readProcessMemory('linux')
    expect(reading.total).toBe(2 * 1024 ** 3)
    expect(reading.available).toBe(0.75 * 1024 ** 3)
  },
)
it.each([
  [0, 0, 2000],
  [1900, 0, 100],
  [1900, 1500, 1600],
  [1900, 4000, 2000],
  [3000, 200, 0],
])(
  'includes reclaimable cgroup file cache and bounds available memory (%i, %i)',
  async (current, cache, available) => {
    state.files.set('/proc/meminfo', 'MemAvailable: 4194304 kB\n')
    state.files.set('/proc/self/cgroup', '0::/\n')
    state.files.set('/sys/fs/cgroup/memory.max', '2000')
    state.files.set('/sys/fs/cgroup/memory.current', String(current))
    state.files.set(
      '/sys/fs/cgroup/memory.stat',
      `anon 100\ninactive_file ${cache}\nactive_file 50\n`,
    )
    expect((await readProcessMemory('linux')).available).toBe(available)
  },
)
it.each([
  undefined,
  '',
  'active_file 100\n',
  'inactive_file\n',
  'inactive_file -1\n',
  'inactive_file 1.5\n',
  'inactive_file 1e3\n',
  'inactive_file NaN\n',
  'inactive_file Infinity\n',
  'inactive_file 9007199254740992\n',
  'inactive_file 10\ninactive_file 20\n',
])('fails safely when required cgroup cache stats are missing or invalid (%s)', async (stat) => {
  state.files.set('/proc/meminfo', 'MemAvailable: 4194304 kB\n')
  state.files.set('/proc/self/cgroup', '0::/\n')
  state.files.set('/sys/fs/cgroup/memory.max', '2000')
  state.files.set('/sys/fs/cgroup/memory.current', '1900')
  if (stat !== undefined) state.files.set('/sys/fs/cgroup/memory.stat', stat)
  await expect(readProcessMemory('linux')).rejects.toThrow(
    stat === undefined ? 'Missing file' : 'Cgroup memory inactive_file is unavailable',
  )
})
it.each(['', '-1', '1.5', '1e3', 'Infinity', '9007199254740992'])(
  'rejects invalid cgroup usage and limits (%s)',
  async (invalid) => {
    state.files.set('/proc/meminfo', 'MemAvailable: 4194304 kB\n')
    state.files.set('/proc/self/cgroup', '0::/\n')
    state.files.set('/sys/fs/cgroup/memory.max', invalid)
    await expect(readProcessMemory('linux')).rejects.toThrow('Cgroup memory limit is unavailable')
    state.files.set('/sys/fs/cgroup/memory.max', '2000')
    state.files.set('/sys/fs/cgroup/memory.current', invalid)
    await expect(readProcessMemory('linux')).rejects.toThrow('Cgroup memory usage is unavailable')
  },
)
it('rejects missing Linux available memory and malformed cgroup readings', async () => {
  state.files.set('/proc/meminfo', 'MemFree: 4194304 kB\n')
  await expect(readProcessMemory('linux')).rejects.toThrow('available memory is unavailable')
  state.files.set('/proc/meminfo', 'MemAvailable: 4194304 kB\n')
  state.files.set('/proc/self/cgroup', '0::/\n')
  state.files.set('/sys/fs/cgroup/memory.max', 'invalid')
  await expect(readProcessMemory('linux')).rejects.toThrow('Cgroup memory limit is unavailable')
})
