import { open, stat } from 'node:fs/promises'
import { arch, platform, release } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  MAX_PROBLEM_REPORT_BYTES,
  PROBLEM_REPORT_ATTACHMENT_NAME,
  PROBLEM_REPORT_REPOSITORY,
  RUNTIME_PROTOCOL_VERSION,
  type ProblemReportPreview,
  type ProblemReportRequest,
} from '@dovo/protocol'
import type { Services } from '../services.js'
import { runtimeDiagnostics } from '../http/diagnostics.js'
import { desktopAppUpdateInfo } from '../http/desktop-updates.js'
import { runtimeBuild } from '../agent-tools/product-help.js'
import { readLastCrash } from '../storage/last-crash.js'
import { LOG_NAMES } from '../storage/log-rotation.js'
import { environmentSecrets, redactionCount, redactReportText } from './report-redaction.js'

/** Each log contributes at most this many of its newest bytes and lines. */
const LOG_TAIL_BYTES = 16 * 1024
const LOG_TAIL_LINES = 150
const CLIENT_ERROR_CHARS = 500
/** Room for headings and the truncation note inside the attachment limit. */
const RESERVED_BYTES = 1024

export type ProblemReportSources = {
  /** Runtime log directory. Defaults to the database directory. */
  logDirectory?: string
  now?: Date
}

/** Values this runtime knows are secret: its credential environment and live pairing state. */
export function problemReportSecrets(s: Services) {
  return [...environmentSecrets(), ...s.pairing.activeSecrets()]
}

/** Build the redacted first message and diagnostics attachment for a problem report. */
export async function problemReportPreview(
  s: Services,
  input: ProblemReportRequest,
  sources: ProblemReportSources = {},
): Promise<ProblemReportPreview> {
  const secrets = problemReportSecrets(s)
  const sections: string[] = []
  const build = runtimeBuild()
  if (input.include.versions) sections.push(versionSection(input, build))
  if (input.include.diagnostics) sections.push(await healthSection(s, sources.now))
  if (input.include.clientErrors) sections.push(clientErrorSection(input))
  const header = [
    '# Dovo problem report',
    '',
    `Created: ${(sources.now ?? new Date()).toISOString()}`,
    'Dovo removed credentials, tokens, cookies, environment values and home-directory user names before attaching this file.',
  ].join('\n')
  let attachment: ProblemReportPreview['attachment']
  if (sections.length) {
    let text = redactReportText([header, ...sections].join('\n\n'), secrets)
    if (input.include.diagnostics) {
      const budget = MAX_PROBLEM_REPORT_BYTES - bytes(text) - RESERVED_BYTES
      const logs = await logSection(
        sources.logDirectory ??
          (s.db.name === ':memory:' ? undefined : dirname(resolve(s.db.name))),
        budget,
        secrets,
      )
      text = `${text}\n\n${logs}`
    }
    text = fitBytes(text, MAX_PROBLEM_REPORT_BYTES)
    attachment = { name: PROBLEM_REPORT_ATTACHMENT_NAME, text, bytes: bytes(text) }
  }
  const message = problemReportMessage(input, !!attachment, secrets)
  return {
    message,
    ...(attachment ? { attachment } : {}),
    redactions: redactionCount(message) + (attachment ? redactionCount(attachment.text) : 0),
  }
}

/** The triage playbook sent as the first message. The agent reads, investigates and drafts;
 * filing an issue stays with the person. */
export function problemReportMessage(
  input: Pick<ProblemReportRequest, 'description' | 'expected' | 'include'>,
  attached: boolean,
  secrets: readonly string[] = [],
) {
  // The commit is part of the versions section; leaving versions out leaves it out too.
  const commit = input.include.versions ? runtimeBuild().commit : undefined
  const repository = `https://github.com/${PROBLEM_REPORT_REPOSITORY}`
  const fetch = commit
    ? [
        `2. Fetch the Dovo source for commit ${commit} from ${repository} into a new temporary directory. Create the directory with mktemp -d, then run:`,
        `   git init <dir> && git -C <dir> fetch --depth 1 ${repository} ${commit} && git -C <dir> checkout FETCH_HEAD`,
        '   If GitHub does not have that commit, use the matching release tag or main, and say so in the draft.',
      ]
    : [
        `2. This report has no source commit. Fetch main from ${repository} into a new temporary directory with a shallow clone, and say in the draft that the commit is unknown.`,
      ]
  return redactReportText(
    [
      'I want to report a problem in Dovo Studio. Help me triage it and draft a GitHub issue. Do not file the issue yourself.',
      '',
      'What happened:',
      input.description.trim(),
      '',
      'What I expected:',
      input.expected?.trim() || 'Not stated.',
      '',
      attached
        ? `Diagnostics: ${PROBLEM_REPORT_ATTACHMENT_NAME} is attached. Dovo removed credentials, tokens, cookies, environment values and home-directory user names before attaching it.`
        : 'Diagnostics: I chose not to include any.',
      '',
      'Triage playbook:',
      attached
        ? `1. Read ${PROBLEM_REPORT_ATTACHMENT_NAME}. Note the versions, source commit, warnings, errors and log lines that relate to the problem.`
        : '1. Ask me for versions or error messages only if you need them.',
      ...fetch,
      '   Treat this checkout as read-only. Do not edit, commit or push in it. Delete it when you finish.',
      '3. Find the likely cause. Cite files and line numbers in the fetched source. Keep facts separate from guesses. If evidence is missing, tell me what to check or how to reproduce the problem.',
      '4. Draft an issue with a title, a short summary, steps to reproduce, the expected result, the actual result, the environment (versions and commit), evidence (short log excerpts) and the likely cause.',
      `5. Show the draft in one fenced markdown block so I can copy it. Then give me a link that opens a new issue with the title and body filled in: ${repository}/issues/new?title=<URL-encoded title>&body=<URL-encoded body>. Keep the link shorter than 7,000 characters. Shorten the body in the link if necessary.`,
      '',
      'Rules:',
      '- Do not create the issue, comment on GitHub, push, open a pull request or change any repository. I review and file the issue myself.',
      '- Do not change files outside the temporary directory, and do not change Dovo settings.',
      '- Before you put text into the draft, remove personal data and secrets from it.',
    ].join('\n'),
    secrets,
  )
}

function versionSection(input: ProblemReportRequest, build: ReturnType<typeof runtimeBuild>) {
  const desktop = desktopAppUpdateInfo()
  const client = input.client
  const clientParts = [
    client.appVersion && `version ${client.appVersion}`,
    client.build && `build ${client.build}`,
    client.channel && `${client.channel} channel`,
    client.platform && `on ${client.platform}`,
    client.commit && `commit ${client.commit}`,
  ].filter(Boolean)
  return [
    '## Versions',
    '',
    `- Runtime version: ${build.version}`,
    `- Source commit: ${build.commit ?? 'not recorded'}`,
    `- Build: ${build.development ? 'source checkout (may include local changes)' : 'packaged build'}`,
    `- Runtime distribution: ${
      process.env.DOVO_RELEASE_DISTRIBUTION === 'desktop'
        ? 'desktop'
        : process.env.DOVO_SERVER_DISTRIBUTION === 'archive'
          ? 'archive'
          : 'source'
    }`,
    `- Runtime protocol: ${RUNTIME_PROTOCOL_VERSION}`,
    ...(desktop ? [`- Desktop app on the runtime computer: ${desktop.version}`] : []),
    `- Node.js: ${process.version}`,
    `- Operating system: ${platform()} ${release()} (${arch()})`,
    `- Reporting client: ${client.surface}${clientParts.length ? `, ${clientParts.join(', ')}` : ''}`,
  ].join('\n')
}

async function healthSection(s: Services, now = new Date()) {
  const health = await runtimeDiagnostics(s, now.getTime())
  const summary = {
    ready: health.ready,
    checkedAt: health.checkedAt,
    warnings: health.warnings.slice(0, 30),
    roots: { database: health.roots.database, worktrees: health.roots.worktrees },
    storage: health.storage,
    schedulers: {
      tasks: health.schedulers.tasks,
      jobs: health.schedulers.jobs,
      errors: health.schedulers.errors.slice(0, 20).map((item) => item.error),
    },
    replication: (health.replication ?? []).map((item) => ({
      channel: item.channel,
      error: item.error,
      peerErrors: item.peers.flatMap((peer) => (peer.error ? [peer.error] : [])).slice(0, 10),
    })),
    queues: health.queues,
    // Thread titles stay out; the state and duration describe the load.
    running: health.operations
      .slice(0, 20)
      .map((item) => ({ state: item.state, durationMs: item.durationMs })),
    uncertain: {
      count: health.uncertain.count,
      kinds: health.uncertain.actions.slice(0, 20).map((item) => item.kind),
    },
    backups: { active: health.backups.active, failure: health.backups.failure ?? null },
    memory: health.memory && {
      rssBytes: health.memory.rssBytes,
      heapUsedBytes: health.memory.heapUsedBytes,
      heapLimitBytes: health.memory.heapLimitBytes,
      eventLoopUtilization: health.memory.eventLoopUtilization,
      protection: health.memory.protection && {
        mode: health.memory.protection.mode,
        detail: health.memory.protection.detail,
        lastStop: health.memory.protection.lastStop?.reason,
      },
      spikes: health.memory.spikes.slice(0, 3).map((spike) => ({
        at: spike.at,
        growthBytes: spike.growthBytes,
        suspects: spike.suspects.slice(0, 5).map((suspect) => suspect.name),
      })),
    },
    lastCrash: readLastCrash(s.db.name) ?? null,
  }
  return ['## Runtime health', '', fence(JSON.stringify(summary, null, 2), 'json')].join('\n')
}

function clientErrorSection(input: ProblemReportRequest) {
  const lines = input.clientErrors.map(
    (error) =>
      `- ${error.at}${error.source ? ` (${error.source})` : ''}: ${error.message
        .replace(/\s+/g, ' ')
        .slice(0, CLIENT_ERROR_CHARS)}`,
  )
  return ['## Recent client errors', '', ...(lines.length ? lines : ['None recorded.'])].join('\n')
}

async function logSection(
  directory: string | undefined,
  budget: number,
  secrets: readonly string[],
) {
  const heading = '## Recent runtime logs'
  if (!directory) return `${heading}\n\nThis runtime does not write log files.`
  const tails: { name: string; lines: string[] }[] = []
  for (const name of LOG_NAMES) {
    // Redact the whole tail first: a private key or other value can span several lines.
    const lines = redactReportText(await readTail(join(directory, name)), secrets)
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .slice(-LOG_TAIL_LINES)
    if (lines.length) tails.push({ name, lines })
  }
  if (!tails.length)
    return `${heading}\n\nNo log files were found. Runtimes started by the desktop app or a terminal may log only to that process output.`
  const share = Math.max(0, Math.floor(budget / tails.length) - 128)
  const parts = [heading]
  for (const tail of tails) {
    // Keep the newest redacted lines that fit this log's share.
    const kept: string[] = []
    let used = 0
    for (const line of [...tail.lines].reverse()) {
      const size = bytes(line) + 1
      if (used + size > share) break
      kept.unshift(line)
      used += size
    }
    parts.push(
      `### ${tail.name} (newest ${kept.length} lines)`,
      kept.length ? fence(kept.join('\n'), 'text') : 'No lines fit the size limit.',
    )
  }
  return parts.join('\n\n')
}

/** The newest bytes of a log, without the first line when the read starts mid-way. */
async function readTail(path: string) {
  const info = await stat(path).catch(() => undefined)
  if (!info?.isFile() || !info.size) return ''
  const handle = await open(path, 'r')
  try {
    const length = Math.min(LOG_TAIL_BYTES, info.size)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, info.size - length)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    // The first line may start mid-way when the file is longer than the tail.
    return info.size > length ? text.slice(text.indexOf('\n') + 1) : text
  } finally {
    await handle.close()
  }
}

/** A fence longer than any backtick run in the text, so log content cannot close it. */
function fence(text: string, language: string) {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length))
  const marks = '`'.repeat(longest + 1)
  return `${marks}${language}\n${text}\n${marks}`
}

const bytes = (text: string) => Buffer.byteLength(text, 'utf8')

function fitBytes(text: string, limit: number) {
  if (bytes(text) <= limit) return text
  const note = '\n\n[Dovo shortened this file to stay within the size limit.]'
  const encoded = Buffer.from(text, 'utf8')
  let end = limit - bytes(note)
  // Never cut a multi-byte character in half.
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end--
  return encoded.subarray(0, end).toString('utf8') + note
}
