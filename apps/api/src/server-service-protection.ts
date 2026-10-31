import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * Opt-in memory-pressure settings for the Linux user service, applied as one drop-in that
 * Dovo owns. Nothing here runs unless the owner invokes `service protect enable`; disable
 * removes only that drop-in. Everything works as an unprivileged systemd user manager, so it
 * never uses sudo or edits system units, other users' units or other drop-ins.
 *
 * - `OOMPolicy=continue`: by default, a kernel OOM kill of any process in the service (usually
 *   one agent or tool) stops the whole unit, which ends the runtime and every other agent.
 * - `OOMScoreAdjust`: lowered only to the user manager's own score, the floor an unprivileged
 *   service may request. Every process the runtime starts would inherit it, so the service
 *   supervisor returns all other processes in the cgroup to the score they would have had.
 * - `MemoryLow`: only when the owner chooses a size. It covers the whole service cgroup,
 *   agents included, and protects nothing unless every ancestor cgroup grants protection too.
 *
 * None of this guarantees the runtime survives: systemd-oomd and the kernel can still kill it.
 */
export const PROTECTION_DROP_IN = '90-dovo-protect.conf'
export const CHILD_OOM_SCORE_ENV = 'DOVO_SERVICE_CHILD_OOM_SCORE_ADJ'
const MARKER = '# Managed by Dovo (server service protect). Remove with: service protect disable'

export type ProtectionHost = {
  uid: number
  /** Resolves with trimmed stdout; rejects when the command cannot run or exits non-zero. */
  output(command: string, args: string[]): Promise<string>
  /** Undefined only when the file does not exist; any other failure throws. */
  readFile(path: string): string | undefined
  writeFile(path: string, contents: string): void
  removeFile(path: string): void
  /** Removes the directory only if it is empty. */
  removeEmptyDirectory(path: string): void
}
export type ProtectedService = { name: string; path: string }
export type ProtectionOptions = { memoryLow?: string }

export const systemProtectionHost = (): ProtectionHost => ({
  uid: process.getuid?.() ?? 0,
  output: (command, args) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10_000,
        killSignal: 'SIGKILL',
      })
      let text = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (text += chunk))
      child.once('error', reject)
      child.once('exit', (code) =>
        code === 0
          ? resolve(text.trim())
          : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)),
      )
    }),
  readFile: (path) => {
    try {
      return readFileSync(path, 'utf8')
    } catch (error) {
      if (missing(error)) return undefined
      throw error
    }
  },
  writeFile: (path, contents) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' })
      renameSync(temporary, path)
    } catch (error) {
      try {
        rmSync(temporary, { force: true })
      } catch {
        /* An inert temporary file may remain. */
      }
      throw error
    }
  },
  removeFile: (path) => rmSync(path, { force: true }),
  removeEmptyDirectory: (path) => {
    try {
      if (readdirSync(path).length === 0) rmdirSync(path)
    } catch (error) {
      // Gone already, or another file appeared in the meantime.
      if (!missing(error) && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
    }
  },
})
const missing = (error: unknown) =>
  ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException | undefined)?.code ?? '')
/** A failure to read the drop-in must never look like its absence, which would allow a write. */
function readDropIn(host: ProtectionHost, path: string) {
  try {
    return host.readFile(path)
  } catch (error) {
    throw new Error(
      `Could not read ${path} (${(error as NodeJS.ErrnoException).code ?? (error instanceof Error ? error.message : String(error))}), so nothing was changed.`,
      { cause: error },
    )
  }
}
/** Kernel values are informational: unreadable is unknown, never a default. */
function probe(host: ProtectionHost, path: string) {
  try {
    return { value: host.readFile(path) }
  } catch {
    return undefined
  }
}

const unitName = (service: ProtectedService) => `${service.name}.service`
export const dropInPath = (service: ProtectedService) =>
  join(dirname(service.path), `${unitName(service)}.d`, PROTECTION_DROP_IN)
const score = (value: string | undefined) => {
  const parsed = Number(value?.trim())
  return value?.trim() && Number.isInteger(parsed) && parsed >= -1000 && parsed <= 1000
    ? parsed
    : undefined
}
const properties = (text: string) =>
  new Map(
    text
      .split('\n')
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
  )
const optional = (promise: Promise<string>) => promise.catch(() => undefined)

export type ProtectionInspection = {
  dropIn: { path: string; state: 'absent' | 'owned' | 'foreign'; contents?: string }
  /** Drop-ins from other tools or the owner, which systemd also applies. */
  otherDropIns: string[]
  service: {
    active: boolean
    oomPolicy?: string
    oomScoreAdjust?: number
    memoryLow?: string
    supervisorOomScore?: number
  }
  /** The user manager's score: the lowest an unprivileged service may request. */
  managerOomScore?: number
  /** The score the manager gives services that do not set one. */
  defaultOomScore?: number
  /** First ancestor cgroup that grants no memory protection, so MemoryLow cannot reach. */
  unprotectedAncestor?: string
  oomd?: boolean
  childScoreReleaseSupported: boolean
}

export async function inspectProtection(
  service: ProtectedService,
  host: ProtectionHost,
): Promise<ProtectionInspection> {
  const path = dropInPath(service)
  const contents = readDropIn(host, path)
  const shown = properties(
    (await optional(
      host.output('systemctl', [
        '--user',
        'show',
        unitName(service),
        '--property=ActiveState,OOMPolicy,OOMScoreAdjust,MemoryLow,MainPID,ControlGroup,DropInPaths',
      ]),
    )) ?? '',
  )
  if (!shown.size)
    throw new Error(
      'The systemd user manager did not answer. Run this as the service owner in a login session (systemctl --user must work).',
    )
  const managerPid = Number(
    await optional(
      host.output('systemctl', [
        'show',
        `user@${host.uid}.service`,
        '--property=MainPID',
        '--value',
      ]),
    ),
  )
  const mainPid = Number(shown.get('MainPID') ?? 0)
  const controlGroup = (shown.get('ControlGroup') ?? '').split('/').filter(Boolean)
  let unprotectedAncestor: string | undefined
  // The service's own cgroup is excluded: its MemoryLow is what this drop-in may set.
  ancestors: for (let depth = 1; depth < controlGroup.length; depth++) {
    const directory = join('/sys/fs/cgroup', ...controlGroup.slice(0, depth))
    const values = ['memory.low', 'memory.min'].map((file) => probe(host, join(directory, file)))
    // An unreadable ancestor leaves the answer unknown rather than naming the wrong one.
    if (values.some((read) => read === undefined)) break ancestors
    if (values.every((read) => ['', '0', undefined].includes(read!.value?.trim()))) {
      unprotectedAncestor = controlGroup[depth - 1]
      break
    }
  }
  return {
    dropIn: {
      path,
      state: contents === undefined ? 'absent' : contents.startsWith(MARKER) ? 'owned' : 'foreign',
      ...(contents === undefined ? {} : { contents }),
    },
    childScoreReleaseSupported:
      /^0::\//m.test(probe(host, '/proc/self/cgroup')?.value ?? '') &&
      controlGroup.length > 0 &&
      probe(host, join('/sys/fs/cgroup', ...controlGroup, 'cgroup.procs'))?.value !== undefined,
    otherDropIns: (shown.get('DropInPaths') ?? '')
      .split(/\s+/)
      .filter((entry) => entry && entry !== path),
    service: {
      active: shown.get('ActiveState') === 'active',
      oomPolicy: shown.get('OOMPolicy') || undefined,
      oomScoreAdjust: score(shown.get('OOMScoreAdjust')),
      memoryLow: shown.get('MemoryLow') || undefined,
      supervisorOomScore:
        mainPid > 0 ? score(probe(host, `/proc/${mainPid}/oom_score_adj`)?.value) : undefined,
    },
    managerOomScore:
      managerPid > 0 ? score(probe(host, `/proc/${managerPid}/oom_score_adj`)?.value) : undefined,
    defaultOomScore: score(
      await optional(
        host.output('systemctl', ['--user', 'show', '--property=DefaultOOMScoreAdjust', '--value']),
      ),
    ),
    unprotectedAncestor,
    oomd:
      (await optional(host.output('systemctl', ['is-active', 'systemd-oomd.service']))) ===
      'active',
  }
}

export type ProtectionPlan = { path: string; contents: string; notes: string[] }
const memorySize = /^\d+(?:\.\d+)?[KMGT]?$|^\d+(?:\.\d+)?%$/
export function protectionPlan(
  inspection: ProtectionInspection,
  options: ProtectionOptions = {},
): ProtectionPlan {
  if (options.memoryLow !== undefined && !memorySize.test(options.memoryLow))
    throw new Error('--memory-low must be a systemd size such as 512M, 2G or 10%.')
  const lines = ['OOMPolicy=continue']
  const notes = [
    'OOMPolicy=continue: when the kernel kills one agent or tool for memory, the runtime and other agents keep running instead of the whole service stopping.',
  ]
  // A prior enable already lowered the service, so its recorded child score is the original one.
  const recorded = score(
    new RegExp(`^Environment=${CHILD_OOM_SCORE_ENV}=(-?\\d+)$`, 'm').exec(
      inspection.dropIn.state === 'owned' ? (inspection.dropIn.contents ?? '') : '',
    )?.[1],
  )
  const childScore = inspection.defaultOomScore ?? recorded ?? inspection.service.oomScoreAdjust
  const floor = inspection.managerOomScore
  if (!inspection.childScoreReleaseSupported)
    notes.push(
      'OOM score unchanged: readable unified cgroup membership is required to return agent and tool scores to normal.',
    )
  else if (floor === undefined || childScore === undefined)
    notes.push('OOM score unchanged: the user manager or default service score could not be read.')
  else if (floor >= childScore)
    notes.push(
      `OOM score unchanged: services already run at the user manager's score (${floor}); lowering it further needs administrator changes Dovo does not make.`,
    )
  else {
    lines.push(`OOMScoreAdjust=${floor}`, `Environment=${CHILD_OOM_SCORE_ENV}=${childScore}`)
    notes.push(
      `OOMScoreAdjust=${floor}: the supervisor and runtime become less likely OOM victims than other user services (${childScore}).`,
      `Agents, terminals and tools started by the runtime are returned to ${childScore} within about 2 seconds of starting, limiting how long they inherit the lower score.`,
    )
  }
  if (options.memoryLow !== undefined) {
    lines.push(`MemoryLow=${options.memoryLow}`)
    notes.push(
      `MemoryLow=${options.memoryLow} covers the whole service, including agents' memory.${inspection.unprotectedAncestor ? ` It has no effect until an administrator grants protection to ${inspection.unprotectedAncestor} and the other ancestors.` : ''}`,
    )
  } else
    notes.push(
      'MemoryLow unset: it would also shelter agents, and needs ancestor cgroups that only an administrator can configure. Choose a size with --memory-low if you want it.',
    )
  notes.push(
    'SSH, Tailscale, NetBird and other system services are not changed or protected; that needs administrator configuration outside this user service.',
  )
  if (inspection.oomd)
    notes.push(
      'systemd-oomd is active. It acts on whole cgroups under pressure and ignores user-service preferences, so it can still stop this service.',
    )
  notes.push(
    'Changes take full effect at the next service restart. This lowers the chance of losing the runtime under memory pressure; it is not a guarantee.',
  )
  return {
    path: inspection.dropIn.path,
    contents: [MARKER, '[Service]', ...lines, ''].join('\n'),
    notes,
  }
}

const reload = (host: ProtectionHost) => host.output('systemctl', ['--user', 'daemon-reload'])
const assertOwned = (inspection: ProtectionInspection) => {
  if (inspection.dropIn.state === 'foreign')
    throw new Error(
      `${inspection.dropIn.path} was not written by Dovo, so it was left unchanged. Move or remove it yourself first.`,
    )
}

export async function enableProtection(
  service: ProtectedService,
  host: ProtectionHost,
  options: ProtectionOptions = {},
) {
  const inspection = await inspectProtection(service, host)
  assertOwned(inspection)
  const plan = protectionPlan(inspection, options)
  host.writeFile(plan.path, plan.contents)
  try {
    await reload(host)
  } catch (error) {
    // Leave systemd's view and the files matching: restore what was there before.
    let restored = false
    let reloaded = false
    try {
      if (inspection.dropIn.contents !== undefined)
        host.writeFile(plan.path, inspection.dropIn.contents)
      else {
        host.removeFile(plan.path)
        host.removeEmptyDirectory(dirname(plan.path))
      }
      restored = true
      await reload(host)
      reloaded = true
    } catch {
      // Reported below.
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      !restored
        ? `systemd did not reload the protection settings and the rollback did not finish. Check ${plan.path}, then run service protect disable. ${reason}`
        : reloaded
          ? `systemd did not reload the protection settings, so the previous files were restored. ${reason}`
          : `systemd did not reload the protection settings. The previous files were restored; run systemctl --user daemon-reload once systemd responds. ${reason}`,
      { cause: error },
    )
  }
  return { enabled: true, ...plan }
}

export async function disableProtection(service: ProtectedService, host: ProtectionHost) {
  const path = dropInPath(service)
  const contents = readDropIn(host, path)
  if (contents === undefined) return { removed: false, path }
  if (!contents.startsWith(MARKER))
    throw new Error(`${path} was not written by Dovo, so it was left unchanged.`)
  host.removeFile(path)
  await reload(host)
  // Other tools' drop-ins in the same directory stay; only an empty directory is removed.
  host.removeEmptyDirectory(dirname(path))
  return {
    removed: true,
    path,
    note: 'Restart the service to return its OOM score to the default.',
  }
}

export async function protectionStatus(service: ProtectedService, host: ProtectionHost) {
  const inspection = await inspectProtection(service, host)
  const notes: string[] = []
  if (inspection.dropIn.state === 'foreign')
    notes.push(`${inspection.dropIn.path} exists but was not written by Dovo.`)
  if (inspection.otherDropIns.length)
    notes.push(
      `Other drop-ins also apply and may override these settings: ${inspection.otherDropIns.join(', ')}`,
    )
  if (
    inspection.dropIn.state === 'owned' &&
    inspection.service.supervisorOomScore !== undefined &&
    inspection.service.oomScoreAdjust !== undefined &&
    inspection.service.supervisorOomScore !== inspection.service.oomScoreAdjust
  )
    notes.push('The running service predates the current settings. Restart it to apply them.')
  if (inspection.service.memoryLow && inspection.unprotectedAncestor)
    notes.push(
      `MemoryLow has no effect: ancestor ${inspection.unprotectedAncestor} grants no memory protection.`,
    )
  return { enabled: inspection.dropIn.state === 'owned', ...inspection, notes }
}

const known = (value: string | number | undefined, fallback = 'unknown') =>
  value === undefined ? fallback : String(value)
export function protectionReportText(
  report:
    | ({ preview: true } & ProtectionPlan)
    | Awaited<ReturnType<typeof enableProtection>>
    | Awaited<ReturnType<typeof disableProtection>>
    | Awaited<ReturnType<typeof protectionStatus>>,
) {
  if ('preview' in report)
    return [
      `Would write ${report.path}:`,
      report.contents,
      ...report.notes.map((n) => `- ${n}`),
    ].join('\n')
  if ('contents' in report)
    return [`Wrote ${report.path}:`, report.contents, ...report.notes.map((n) => `- ${n}`)].join(
      '\n',
    )
  if ('removed' in report)
    return 'note' in report
      ? `Removed ${report.path}. ${report.note}`
      : 'Service protection is not enabled; nothing changed.'
  const { service } = report
  return [
    `Protection: ${report.enabled ? 'enabled' : 'not enabled'} (${report.dropIn.path})`,
    `Service: OOMPolicy=${known(service.oomPolicy)} OOMScoreAdjust=${known(service.oomScoreAdjust)} MemoryLow=${known(service.memoryLow)}`,
    `Running supervisor OOM score: ${known(service.supervisorOomScore, 'not running')} · user manager: ${known(report.managerOomScore)} · service default: ${known(report.defaultOomScore)}`,
    ...report.notes.map((note) => `- ${note}`),
  ].join('\n')
}

/**
 * Keeps the service's lower OOM score on the supervisor and runtime only. Linux copies the
 * score into every child, so other processes in the service's own cgroup are raised back to
 * `childScore`. Raising a score never needs privileges. Only this cgroup is read.
 */
export function releaseChildOomProtection(
  childScore: number,
  protectedPids: () => number[],
  intervalMs = 2_000,
  proc = '/proc',
  cgroupRoot = '/sys/fs/cgroup',
) {
  const membership = /^0::(\/.*)$/m.exec(readText(`${proc}/self/cgroup`) ?? '')?.[1]
  const restoreScore = (pid: number) => {
    const path = `${proc}/${pid}/oom_score_adj`
    const current = score(readText(path))
    if (current === undefined || current >= childScore) return
    try {
      writeFileSync(path, String(childScore))
    } catch {
      /* Process exited or is inaccessible. */
    }
  }
  // If host capabilities changed after enable, drop our inherited protection before
  // agents launch. Keeping a protected runtime without being able to release its
  // children would shelter every provider and tool indefinitely.
  const abandon = () => {
    for (const pid of protectedPids()) restoreScore(pid)
  }
  if (!membership) {
    abandon()
    return () => {}
  }
  const procs = join(cgroupRoot, membership, 'cgroup.procs')
  if (readText(procs) === undefined) {
    abandon()
    return () => {}
  }
  const release = () => {
    const keep = new Set(protectedPids())
    const members = readText(procs)
    if (members === undefined) {
      abandon()
      return
    }
    for (const pid of members.split('\n').filter(Boolean).map(Number)) {
      if (!keep.has(pid)) restoreScore(pid)
    }
  }
  const timer = setInterval(release, intervalMs)
  timer.unref()
  return () => clearInterval(timer)
}
function readText(path: string) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}
