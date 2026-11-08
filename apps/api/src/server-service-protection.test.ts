import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  CHILD_OOM_SCORE_ENV,
  disableProtection,
  dropInPath,
  enableProtection,
  inspectProtection,
  protectionPlan,
  protectionReportText,
  protectionStatus,
  releaseChildOomProtection,
  systemProtectionHost,
  type ProtectionHost,
} from './server-service-protection'

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  return { ...fs, writeFileSync: vi.fn<typeof fs.writeFileSync>(fs.writeFileSync) }
})

const service = {
  name: 'dovo-server-abc',
  path: '/home/user/.config/systemd/user/dovo-server-abc.service',
}
const ours = dropInPath(service)
const cgroup = 'user.slice/user-1000.slice/user@1000.service/app.slice/dovo-server-abc.service'

/** An in-memory systemd user manager; it records commands and never touches the host. */
function fakeHost(options: {
  files?: Record<string, string>
  managerScore?: string
  defaultScore?: string
  reloadFails?: boolean
  userManager?: boolean
  dropIns?: string[]
  /** Paths whose read fails with this errno instead of returning contents. */
  unreadable?: Record<string, string>
}) {
  const files = new Map(
    Object.entries({
      '/proc/900/oom_score_adj': options.managerScore ?? '100',
      '/proc/1234/oom_score_adj': '200',
      '/proc/self/cgroup': `0::/${cgroup}\n`,
      [`/sys/fs/cgroup/${cgroup}/cgroup.procs`]: '1234\n',
      ...options.files,
    }),
  )
  const commands: string[] = []
  const host: ProtectionHost = {
    uid: 1000,
    output: async (command, args) => {
      const line = [command, ...args].join(' ')
      commands.push(line)
      if (options.userManager === false && args[0] === '--user') throw new Error('no bus')
      if (line === 'systemctl --user daemon-reload') {
        if (options.reloadFails) throw new Error('systemctl --user daemon-reload exited with 1')
        return ''
      }
      if (line === 'systemctl show user@1000.service --property=MainPID --value') return '900'
      if (line.startsWith('systemctl --user show --property=DefaultOOMScoreAdjust')) {
        if (options.defaultScore === undefined) throw new Error('unknown property')
        return options.defaultScore
      }
      if (line === 'systemctl is-active systemd-oomd.service') throw new Error('inactive')
      if (line.startsWith('systemctl --user show dovo-server-abc.service'))
        return [
          'ActiveState=active',
          'OOMPolicy=stop',
          'OOMScoreAdjust=200',
          'MemoryLow=0',
          'MainPID=1234',
          `ControlGroup=/${cgroup}`,
          `DropInPaths=${[...(options.dropIns ?? []), ...(files.has(ours) ? [ours] : [])].join(' ')}`,
        ].join('\n')
      throw new Error(`unexpected command ${line}`)
    },
    readFile: (path) => {
      const code = options.unreadable?.[path]
      if (code) throw Object.assign(new Error(`${code}: ${path}`), { code })
      return files.get(path)
    },
    writeFile: (path, contents) => void files.set(path, contents),
    removeFile: (path) => void files.delete(path),
    removeEmptyDirectory: (path) => {
      if (![...files.keys()].some((file) => file.startsWith(`${path}/`))) files.delete(path)
    },
  }
  return { host, files, commands }
}
const writes = (commands: string[]) =>
  commands.filter((line) => !line.includes(' show ') && !line.includes('is-active'))

describe('service protection', () => {
  it('previews and reports status without writing files or reloading systemd', async () => {
    const { host, files, commands } = fakeHost({ defaultScore: '200' })
    const before = new Map(files)
    const plan = protectionPlan(await inspectProtection(service, host))
    expect(plan.contents).toContain('OOMPolicy=continue')
    expect(plan.contents).toContain('OOMScoreAdjust=100')
    expect(plan.contents).toContain(`Environment=${CHILD_OOM_SCORE_ENV}=200`)
    expect(plan.contents).not.toContain('MemoryLow')
    expect(plan.notes.join('\n')).toContain('not a guarantee')
    const status = await protectionStatus(service, host)
    expect(status.enabled).toBe(false)
    expect(status.unprotectedAncestor).toBe('user.slice')
    expect(files).toEqual(before)
    expect(writes(commands)).toEqual([])
  })

  it.each(['legacy', 'unreadable'])(
    'does not lower scores without usable unified cgroups: %s',
    async (mode) => {
      const { host } = fakeHost({
        defaultScore: '200',
        ...(mode === 'legacy'
          ? { files: { '/proc/self/cgroup': '4:memory:/user.slice\n' } }
          : { unreadable: { [`/sys/fs/cgroup/${cgroup}/cgroup.procs`]: 'EACCES' } }),
      })
      const plan = protectionPlan(await inspectProtection(service, host))
      expect(plan.contents).toContain('OOMPolicy=continue')
      expect(plan.contents).not.toContain('OOMScoreAdjust')
      expect(plan.contents).not.toContain(CHILD_OOM_SCORE_ENV)
      expect(plan.notes.join(' ')).toContain('unified cgroup')
    },
  )

  it('enables and disables one owned drop-in, leaving other drop-ins and directories intact', async () => {
    const neighbour = join(dirname(ours), '50-owner.conf')
    const { host, files, commands } = fakeHost({
      defaultScore: '200',
      files: { [neighbour]: '[Service]\nNice=5\n' },
      dropIns: [neighbour],
    })
    const enabled = await enableProtection(service, host, { memoryLow: '256M' })
    expect(files.get(ours)).toBe(enabled.contents)
    expect(enabled.contents).toContain('MemoryLow=256M')
    expect(enabled.notes.join('\n')).toContain('user.slice')
    expect(writes(commands)).toEqual(['systemctl --user daemon-reload'])
    const status = await protectionStatus(service, host)
    expect(status.enabled).toBe(true)
    expect(protectionReportText(status)).toContain('Protection: enabled')
    expect(protectionReportText(enabled)).toContain(`Wrote ${ours}`)
    expect(status.notes.join('\n')).toContain('50-owner.conf')
    // Re-enabling keeps the original child score even once the manager default is unknown.
    const again = fakeHost({ files: Object.fromEntries(files) })
    expect((await enableProtection(service, again.host)).contents).toContain(
      `${CHILD_OOM_SCORE_ENV}=200`,
    )
    expect(await disableProtection(service, host)).toMatchObject({ removed: true })
    expect(files.has(ours)).toBe(false)
    expect(files.get(neighbour)).toBe('[Service]\nNice=5\n')
    expect(await disableProtection(service, host)).toEqual({ removed: false, path: ours })
  })

  it('refuses to replace or remove a drop-in that Dovo did not write', async () => {
    const { host, files, commands } = fakeHost({ files: { [ours]: '[Service]\nNice=1\n' } })
    await expect(enableProtection(service, host)).rejects.toThrow('not written by Dovo')
    await expect(disableProtection(service, host)).rejects.toThrow('not written by Dovo')
    expect(files.get(ours)).toBe('[Service]\nNice=1\n')
    expect(writes(commands)).toEqual([])
  })

  it('treats an unreadable drop-in as a failure, never as absent', async () => {
    const { host, files, commands } = fakeHost({
      defaultScore: '200',
      unreadable: { [ours]: 'EACCES' },
    })
    await expect(enableProtection(service, host)).rejects.toThrow(
      `Could not read ${ours} (EACCES), so nothing was changed.`,
    )
    await expect(disableProtection(service, host)).rejects.toThrow('EACCES')
    await expect(protectionStatus(service, host)).rejects.toThrow('EACCES')
    expect(files.has(ours)).toBe(false)
    expect(writes(commands)).toEqual([])
  })

  it('reports unreadable kernel values as unknown instead of guessing', async () => {
    const { host } = fakeHost({
      defaultScore: '200',
      unreadable: {
        '/proc/900/oom_score_adj': 'EACCES',
        '/sys/fs/cgroup/user.slice/memory.low': 'EACCES',
      },
    })
    const inspection = await inspectProtection(service, host)
    expect(inspection.managerOomScore).toBeUndefined()
    expect(inspection.unprotectedAncestor).toBeUndefined()
    const plan = protectionPlan(inspection)
    expect(plan.contents).not.toContain('OOMScoreAdjust')
    expect(plan.notes.join('\n')).toContain('SSH, Tailscale, NetBird')
  })

  it('reports a rollback that could not finish', async () => {
    const { host } = fakeHost({ defaultScore: '200', reloadFails: true })
    host.removeFile = () => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    }
    await expect(enableProtection(service, host)).rejects.toThrow('rollback did not finish')
  })

  it('rolls back to the previous files when systemd rejects the reload', async () => {
    const fresh = fakeHost({ defaultScore: '200', reloadFails: true })
    await expect(enableProtection(service, fresh.host)).rejects.toThrow(
      'previous files were restored',
    )
    expect(fresh.files.has(ours)).toBe(false)
    const previous = (await enableProtection(service, fakeHost({ defaultScore: '200' }).host))
      .contents
    const replaced = fakeHost({ files: { [ours]: previous }, reloadFails: true })
    await expect(enableProtection(service, replaced.host, { memoryLow: '1G' })).rejects.toThrow(
      'previous files were restored',
    )
    expect(replaced.files.get(ours)).toBe(previous)
  })

  it('never lowers the score below what an unprivileged service may request', async () => {
    const equal = protectionPlan(
      await inspectProtection(service, fakeHost({ managerScore: '200', defaultScore: '200' }).host),
    )
    expect(equal.contents).not.toContain('OOMScoreAdjust')
    expect(equal.notes.join('\n')).toContain('administrator')
    const unknown = protectionPlan(
      await inspectProtection(service, fakeHost({ managerScore: 'garbage' }).host),
    )
    expect(unknown.contents).toContain('OOMPolicy=continue')
    expect(unknown.contents).not.toContain('OOMScoreAdjust')
    expect(() => protectionPlan(unknownInspection(), { memoryLow: '1G; rm' })).toThrow(
      '--memory-low',
    )
  })

  it('reports a missing user manager instead of guessing', async () => {
    const { host } = fakeHost({ userManager: false })
    await expect(protectionStatus(service, host)).rejects.toThrow('systemctl --user')
  })
})

function unknownInspection() {
  return {
    dropIn: { path: ours, state: 'absent' as const },
    otherDropIns: [],
    service: { active: false },
    childScoreReleaseSupported: false,
  }
}

describe('systemProtectionHost', () => {
  it('preserves the previous file when a replacement write fails partway through', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dovo-protect-write-'))
    const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
    try {
      const target = join(root, 'owned.conf'),
        host = systemProtectionHost()
      host.writeFile(target, 'previous complete settings')
      vi.mocked(writeFileSync).mockImplementationOnce((file, content, options) => {
        actual.writeFileSync(
          file,
          typeof content === 'string' ? content.slice(0, 8) : content,
          options,
        )
        throw Object.assign(new Error('disk full'), { code: 'ENOSPC' })
      })
      expect(() => host.writeFile(target, 'replacement settings')).toThrow('disk full')
      expect(readFileSync(target, 'utf8')).toBe('previous complete settings')
      expect(readdirSync(root)).toEqual(['owned.conf'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns undefined only for missing files and throws other read failures', () => {
    const root = mkdtempSync(join(tmpdir(), 'dovo-protect-host-'))
    try {
      const host = systemProtectionHost()
      expect(host.readFile(join(root, 'absent.conf'))).toBeUndefined()
      expect(host.readFile(join(root, 'absent', 'nested.conf'))).toBeUndefined()
      // A directory stands in for permission failures, which root would bypass.
      mkdirSync(join(root, 'directory.conf'))
      expect(() => host.readFile(join(root, 'directory.conf'))).toThrow('EISDIR')
      host.writeFile(join(root, 'unit.d', 'a.conf'), 'x')
      host.writeFile(join(root, 'unit.d', 'b.conf'), 'y')
      host.removeFile(join(root, 'unit.d', 'a.conf'))
      host.removeEmptyDirectory(join(root, 'unit.d'))
      expect(host.readFile(join(root, 'unit.d', 'b.conf'))).toBe('y')
      host.removeFile(join(root, 'unit.d', 'b.conf'))
      host.removeEmptyDirectory(join(root, 'unit.d'))
      host.removeEmptyDirectory(join(root, 'unit.d'))
      expect(host.readFile(join(root, 'unit.d', 'b.conf'))).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('releaseChildOomProtection', () => {
  let root: string | undefined
  afterEach(() => {
    vi.useRealTimers()
    if (root) rmSync(root, { recursive: true, force: true })
  })
  it('raises only other processes in the service cgroup back to the child score', () => {
    vi.useFakeTimers()
    root = mkdtempSync(join(tmpdir(), 'dovo-oom-'))
    const proc = join(root, 'proc')
    const cgroups = join(root, 'cgroup')
    const write = (path: string, contents: string) => {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, contents)
    }
    write(join(proc, 'self', 'cgroup'), `0::/${cgroup}\n`)
    write(join(cgroups, cgroup, 'cgroup.procs'), '10\n11\n12\n13\n')
    for (const [pid, value] of [
      ['10', '100'], // supervisor
      ['11', '100'], // runtime
      ['12', '100'], // agent that inherited the protected score
      ['13', '500'], // tool that is already more killable
      ['99', '100'], // unrelated process outside the cgroup
    ])
      write(join(proc, pid, 'oom_score_adj'), value)
    const stop = releaseChildOomProtection(200, () => [10, 11], 2_000, proc, cgroups)
    vi.advanceTimersByTime(2_000)
    const read = (pid: string) => readFileSync(join(proc, pid, 'oom_score_adj'), 'utf8')
    expect(['10', '11', '12', '13', '99'].map(read)).toEqual(['100', '100', '200', '500', '100'])
    stop()
    writeFileSync(join(proc, '12', 'oom_score_adj'), '100')
    vi.advanceTimersByTime(10_000)
    expect(read('12')).toBe('100')
  })
  it('abandons inherited protection when cgroup membership cannot release children', () => {
    root = mkdtempSync(join(tmpdir(), 'dovo-oom-'))
    mkdirSync(join(root, 'self'), { recursive: true })
    writeFileSync(join(root, 'self', 'cgroup'), '4:memory:/user.slice\n')
    vi.useFakeTimers()
    mkdirSync(join(root, '10'), { recursive: true })
    writeFileSync(join(root, '10', 'oom_score_adj'), '100')
    const protectedPids = vi.fn<() => number[]>(() => [10])
    const stop = releaseChildOomProtection(200, protectedPids, 2_000, root, root)
    vi.advanceTimersByTime(10_000)
    expect(readFileSync(join(root, '10', 'oom_score_adj'), 'utf8')).toBe('200')
    expect(protectedPids).toHaveBeenCalledTimes(1)
    stop()
  })
})
